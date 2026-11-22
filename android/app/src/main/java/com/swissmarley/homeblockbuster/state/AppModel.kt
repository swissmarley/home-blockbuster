package com.swissmarley.homeblockbuster.state

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.swissmarley.homeblockbuster.data.ApiClient
import com.swissmarley.homeblockbuster.data.ApiException
import com.swissmarley.homeblockbuster.data.AppPreferences
import com.swissmarley.homeblockbuster.data.ContinueItem
import com.swissmarley.homeblockbuster.data.HbJson
import com.swissmarley.homeblockbuster.data.HealthInfo
import com.swissmarley.homeblockbuster.data.ProfileDTO
import com.swissmarley.homeblockbuster.data.ProfileState
import com.swissmarley.homeblockbuster.data.ProgressEntry
import com.swissmarley.homeblockbuster.data.SecureStore
import com.swissmarley.homeblockbuster.data.ServerConnection
import com.swissmarley.homeblockbuster.data.TitleSummary
import com.swissmarley.homeblockbuster.player.PreviewCenter
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer
import java.util.UUID

data class PlayRequest(
    val fileId: String,
    val titleId: String,
    /** Ignore the saved position. */
    val fromStart: Boolean = false,
    val id: String = UUID.randomUUID().toString(),
)

enum class Phase { SERVERS, CONNECTING, LOGIN, PROFILES, BROWSING }

class AppModel(context: Context) {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val prefs = context.getSharedPreferences("app", Context.MODE_PRIVATE)
    val store = SecureStore(context)
    lateinit var previews: PreviewCenter

    // region Saved data

    var servers by mutableStateOf<List<ServerConnection>>(emptyList())
        private set
    var preferences by mutableStateOf(AppPreferences())
        private set

    fun updatePreferences(change: (AppPreferences) -> AppPreferences) {
        preferences = change(preferences)
        prefs.edit().putString(PREFS_KEY, HbJson.encodeToString(AppPreferences.serializer(), preferences)).apply()
    }

    // endregion

    // region Session

    var phase by mutableStateOf(Phase.SERVERS)
        private set
    var current by mutableStateOf<ServerConnection?>(null)
        private set
    var client by mutableStateOf<ApiClient?>(null)
        private set
    var authRequired by mutableStateOf(false)
        private set
    var connectError by mutableStateOf<String?>(null)

    var profiles by mutableStateOf<List<ProfileDTO>>(emptyList())
        private set
    var profile by mutableStateOf<ProfileDTO?>(null)
        private set

    var titles by mutableStateOf<List<TitleSummary>>(emptyList())
        private set
    var titleMap by mutableStateOf<Map<String, TitleSummary>>(emptyMap())
        private set
    var state by mutableStateOf(ProfileState.EMPTY)
        private set
    var continueItems by mutableStateOf<List<ContinueItem>>(emptyList())
        private set
    var libraryLoading by mutableStateOf(false)
        private set
    var libraryError by mutableStateOf<String?>(null)
    /** Bumped whenever the library is reloaded, so screens can refresh details. */
    var libraryVersion by mutableIntStateOf(0)
        private set

    var playRequest by mutableStateOf<PlayRequest?>(null)
    var toast by mutableStateOf<String?>(null)
        private set
    private var toastJob: Job? = null

    fun showToast(message: String) {
        toast = message
        toastJob?.cancel()
        toastJob = scope.launch {
            delay(3000)
            toast = null
        }
    }

    // endregion

    init {
        prefs.getString(SERVERS_KEY, null)?.let { raw ->
            runCatching { HbJson.decodeFromString(ListSerializer(ServerConnection.serializer()), raw) }.getOrNull()?.let { servers = it }
        }
        prefs.getString(PREFS_KEY, null)?.let { raw ->
            runCatching { HbJson.decodeFromString(AppPreferences.serializer(), raw) }.getOrNull()?.let { preferences = it }
        }
    }

    private var restored = false

    /** Reopen the server used last time (the app is usually used at one place at a time). */
    fun restore() {
        if (restored) return
        restored = true
        if (phase != Phase.SERVERS || current != null) return
        val id = prefs.getString(LAST_SERVER_KEY, null) ?: return
        val server = servers.firstOrNull { it.id == id } ?: return
        scope.launch { connect(server, silent = true) }
    }

    // region Servers

    val sortedServers: List<ServerConnection>
        get() = servers.sortedByDescending { it.lastUsedAt ?: it.createdAt }

    fun saveServer(server: ServerConnection) {
        val i = servers.indexOfFirst { it.id == server.id }
        servers = if (i >= 0) {
            if (servers[i].url != server.url) store.set(server.id, null)
            if (current?.id == server.id) current = server
            servers.toMutableList().also { it[i] = server }
        } else {
            servers + server
        }
        persistServers()
    }

    fun deleteServer(server: ServerConnection) {
        servers = servers.filter { it.id != server.id }
        store.set(server.id, null)
        if (current?.id == server.id) disconnect()
        persistServers()
    }

    private fun persistServers() {
        prefs.edit().putString(SERVERS_KEY, HbJson.encodeToString(ListSerializer(ServerConnection.serializer()), servers)).apply()
    }

    private fun updateCurrent(change: (ServerConnection) -> ServerConnection) {
        val server = current ?: return
        val i = servers.indexOfFirst { it.id == server.id }
        if (i < 0) return
        val updated = change(server)
        servers = servers.toMutableList().also { it[i] = updated }
        current = updated
        persistServers()
    }

    /** Check an address before saving it. Returns the server's health info. */
    suspend fun probe(url: String): HealthInfo {
        val health = ApiClient(url, "probe", null).health()
        if (!health.ok) throw ApiException(0, "The server didn't answer like a Home Blockbuster server.")
        return health
    }

    // endregion

    // region Connecting

    suspend fun connect(server: ServerConnection, silent: Boolean = false) {
        disconnect(keepError = false)
        current = server
        phase = Phase.CONNECTING
        connectError = null
        val c = ApiClient(server.url, server.id, store)
        c.onUnauthorized = { scope.launch { sessionExpired() } }
        client = c
        try {
            val health = c.health()
            val auth = c.authStatus()
            if (client !== c) return
            authRequired = auth.required
            prefs.edit().putString(LAST_SERVER_KEY, server.id).apply()
            updateCurrent { it.copy(lastUsedAt = System.currentTimeMillis(), version = health.version) }
            if (auth.required && !auth.authenticated) {
                c.token = null
                phase = Phase.LOGIN
                return
            }
            loadProfiles()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (client !== c) return
            current = null
            client = null
            phase = Phase.SERVERS
            connectError = if (silent) "Couldn't reach “${server.name}”. ${e.message}" else e.message
        }
    }

    suspend fun login(password: String) {
        val c = client ?: return
        c.login(password)
        loadProfiles()
    }

    private suspend fun loadProfiles() {
        val c = client ?: return
        val list = c.profiles()
        profiles = list
        val server = current
        val remembered = server?.takeIf { it.rememberProfile }?.lastProfileId?.let { id -> list.firstOrNull { it.id == id } }
        if (remembered != null) select(remembered) else phase = Phase.PROFILES
    }

    suspend fun reloadProfiles() {
        val c = client ?: return
        val list = runCatching { c.profiles() }.getOrNull() ?: return
        profiles = list
        profile?.let { p -> list.firstOrNull { it.id == p.id }?.let { profile = it } }
    }

    private fun sessionExpired() {
        if (!authRequired || phase == Phase.LOGIN || phase == Phase.SERVERS) return
        client?.token = null
        playRequest = null
        profile = null
        phase = Phase.LOGIN
    }

    suspend fun signOut() {
        client?.logout()
        if (authRequired) {
            profile = null
            phase = Phase.LOGIN
        } else {
            disconnect()
        }
    }

    /** Back to the server list. */
    fun disconnect(keepError: Boolean = true) {
        prefs.edit().remove(LAST_SERVER_KEY).apply()
        client = null
        current = null
        profile = null
        profiles = emptyList()
        titles = emptyList()
        titleMap = emptyMap()
        state = ProfileState.EMPTY
        continueItems = emptyList()
        playRequest = null
        if (!keepError) connectError = null
        phase = Phase.SERVERS
    }

    // endregion

    // region Profiles

    suspend fun select(p: ProfileDTO) {
        profile = p
        updateCurrent { it.copy(lastProfileId = p.id) }
        state = ProfileState.EMPTY
        continueItems = emptyList()
        titles = emptyList()
        titleMap = emptyMap()
        phase = Phase.BROWSING
        reloadLibrary()
    }

    fun switchProfile() {
        profile = null
        playRequest = null
        phase = Phase.PROFILES
        scope.launch { reloadProfiles() }
    }

    var rememberProfile: Boolean
        get() = current?.rememberProfile ?: false
        set(value) = updateCurrent { it.copy(rememberProfile = value) }

    suspend fun createProfile(name: String, avatar: String, kids: Boolean): ProfileDTO {
        val c = client ?: throw ApiException.UNREACHABLE
        val p = c.createProfile(name, avatar, kids)
        profiles = profiles + p
        return p
    }

    suspend fun updateProfile(id: String, update: ApiClient.ProfileUpdate) {
        val c = client ?: throw ApiException.UNREACHABLE
        val p = c.updateProfile(id, update)
        profiles = profiles.map { if (it.id == id) p else it }
        if (profile?.id == id) {
            val kidsChanged = profile?.kids != p.kids
            profile = p
            if (kidsChanged) reloadLibrary()
        }
    }

    suspend fun deleteProfile(id: String) {
        val c = client ?: throw ApiException.UNREACHABLE
        c.deleteProfile(id)
        profiles = profiles.filter { it.id != id }
        if (profile?.id == id) switchProfile()
    }

    // endregion

    // region Library

    suspend fun reloadLibrary() {
        val c = client ?: return
        val p = profile ?: return
        libraryLoading = true
        libraryError = null
        try {
            coroutineScope {
                val t = async { c.titles(p.id) }
                val s = async { c.profileState(p.id) }
                val cw = async { c.continueWatching(p.id) }
                val (titlesResult, stateResult, continueResult) = Triple(t.await(), s.await(), cw.await())
                if (profile?.id != p.id) return@coroutineScope
                titles = titlesResult
                titleMap = titlesResult.associateBy { it.id }
                state = stateResult
                continueItems = continueResult
                libraryVersion++
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            libraryError = e.message
        } finally {
            libraryLoading = false
        }
    }

    suspend fun refreshProfileState() {
        val c = client ?: return
        val p = profile ?: return
        coroutineScope {
            val s = async { runCatching { c.profileState(p.id) }.getOrNull() }
            val cw = async { runCatching { c.continueWatching(p.id) }.getOrNull() }
            s.await()?.let { state = it }
            cw.await()?.let { continueItems = it }
        }
    }

    fun isInList(titleId: String): Boolean = titleId in state.myList

    fun toggleList(titleId: String) {
        val c = client ?: return
        val p = profile ?: return
        val adding = !isInList(titleId)
        // Optimistic update.
        state = state.copy(myList = if (adding) listOf(titleId) + state.myList else state.myList - titleId)
        scope.launch {
            try {
                state = if (adding) c.addToList(p.id, titleId) else c.removeFromList(p.id, titleId)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                showToast(e.message ?: "Something went wrong.")
                refreshProfileState()
            }
        }
    }

    fun rating(titleId: String): Int = state.ratings[titleId] ?: 0

    fun rate(titleId: String, value: Int) {
        val c = client ?: return
        val p = profile ?: return
        val next = if (rating(titleId) == value) 0 else value
        state = state.copy(ratings = if (next == 0) state.ratings - titleId else state.ratings + (titleId to next))
        scope.launch {
            try {
                state = c.rate(p.id, titleId, next)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                showToast(e.message ?: "Something went wrong.")
            }
        }
    }

    fun hideFromContinue(titleId: String) {
        val c = client ?: return
        val p = profile ?: return
        continueItems = continueItems.filter { it.titleId != titleId }
        scope.launch { runCatching { c.hideContinue(p.id, titleId) }.getOrNull()?.let { state = it } }
    }

    fun progress(fileId: String): ProgressEntry? = state.progress[fileId]

    /** Resume where Continue Watching points, else the default file. */
    fun playTarget(title: TitleSummary): String? =
        continueItems.firstOrNull { it.titleId == title.id }?.fileId ?: title.playFileId

    // endregion

    // region Playback

    fun play(fileId: String, titleId: String, fromStart: Boolean = false) {
        playRequest = PlayRequest(fileId, titleId, fromStart)
    }

    fun playerClosed() {
        playRequest = null
        scope.launch { refreshProfileState() }
    }

    // endregion

    private companion object {
        const val SERVERS_KEY = "servers.v1"
        const val PREFS_KEY = "preferences.v1"
        const val LAST_SERVER_KEY = "lastServer.v1"
    }
}

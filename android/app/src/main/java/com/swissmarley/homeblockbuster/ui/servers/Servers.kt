package com.swissmarley.homeblockbuster.ui.servers

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.swissmarley.homeblockbuster.data.ServerConnection
import com.swissmarley.homeblockbuster.state.AppModel
import com.swissmarley.homeblockbuster.ui.components.LogoMark
import com.swissmarley.homeblockbuster.ui.components.PrimaryButton
import com.swissmarley.homeblockbuster.ui.components.SecondaryButton
import com.swissmarley.homeblockbuster.ui.components.Wordmark
import com.swissmarley.homeblockbuster.ui.theme.Hb
import com.swissmarley.homeblockbuster.util.Format
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.net.URI

/** Saved Home Blockbuster instances: pick one to connect, or add a new one. */
@Composable
fun ServerList(app: AppModel) {
    var adding by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<ServerConnection?>(null) }

    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Column(
            Modifier
                .widthIn(max = 560.dp)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .systemBarsPadding()
                .padding(horizontal = 20.dp)
                .padding(bottom = 40.dp),
            verticalArrangement = Arrangement.spacedBy(28.dp),
        ) {
            Column(
                Modifier.fillMaxWidth().padding(top = 36.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                LogoMark(Modifier.size(64.dp))
                Wordmark(30)
                Text(
                    "Your movies and shows, from any Home Blockbuster server.",
                    color = Hb.secondaryText, fontSize = 14.sp, textAlign = TextAlign.Center,
                )
            }

            app.connectError?.let { error ->
                Row(
                    Modifier.fillMaxWidth().background(Hb.red.copy(alpha = 0.22f), RoundedCornerShape(10.dp)).padding(14.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Icon(Icons.Filled.Warning, null, tint = Color.White)
                    Text(error, color = Color.White, fontSize = 14.sp)
                }
            }

            if (app.servers.isEmpty()) {
                Column(
                    Modifier.fillMaxWidth().background(Hb.surface.copy(alpha = 0.6f), RoundedCornerShape(16.dp)).padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    Icon(Icons.Filled.Dns, null, tint = Hb.secondaryText, modifier = Modifier.size(42.dp))
                    Text("Add your first server", fontSize = 20.sp, fontWeight = FontWeight.Bold)
                    Text(
                        "Enter the address of a Home Blockbuster server, for example 192.168.1.20:8585 at home. " +
                            "You can save as many servers as you like — at home, at a friend's place — and switch between them any time.",
                        color = Hb.secondaryText, fontSize = 14.sp, textAlign = TextAlign.Center,
                    )
                    PrimaryButton("Add Server", Modifier.fillMaxWidth(), Icons.Filled.Add, fill = Hb.red, foreground = Color.White) { adding = true }
                }
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Your servers", color = Hb.secondaryText, fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
                    for (server in app.sortedServers) {
                        ServerRow(server, onConnect = { app.scope.launch { app.connect(server) } }, onEdit = { editing = server })
                    }
                }
                SecondaryButton("Add Server", Modifier.fillMaxWidth(), Icons.Filled.Add) { adding = true }
            }
        }
    }

    if (adding) ServerEditSheet(app, null) { adding = false }
    editing?.let { server -> ServerEditSheet(app, server) { editing = null } }
}

@Composable
private fun ServerRow(server: ServerConnection, onConnect: () -> Unit, onEdit: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().background(Hb.surface, RoundedCornerShape(14.dp)).padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            Modifier.weight(1f).clickable(onClick = onConnect),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Box(Modifier.size(46.dp).background(Hb.surfaceHigh, RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
                val lower = server.name.lowercase()
                val icon = when {
                    "home" in lower || "casa" in lower || "zuhause" in lower -> Icons.Filled.Home
                    server.isHttps -> Icons.Filled.Security
                    else -> Icons.Filled.Dns
                }
                Icon(icon, null, tint = Color.White)
            }
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(server.name, color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
                Text(server.displayHost, color = Hb.secondaryText, fontSize = 14.sp)
                server.lastUsedAt?.let { Text("Last used ${Format.relative(it)}", color = Hb.tertiaryText, fontSize = 12.sp) }
            }
        }
        IconButton(onClick = onEdit) { Icon(Icons.Filled.MoreVert, "Edit ${server.name}", tint = Hb.secondaryText) }
    }
}

/** Add or edit a saved server. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ServerEditSheet(app: AppModel, server: ServerConnection?, onDismiss: () -> Unit) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf(server?.name ?: "") }
    var address by remember { mutableStateOf(server?.url ?: "") }
    var rememberProfile by remember { mutableStateOf(server?.rememberProfile ?: false) }
    var checking by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }
    val focus = remember { FocusRequester() }

    fun close() {
        scope.launch { sheet.hide() }.invokeOnCompletion { onDismiss() }
    }

    fun save() {
        val url = ServerConnection.normalize(address)
        if (url == null) {
            error = "That doesn't look like a valid address."
            return
        }
        checking = true
        error = null
        scope.launch {
            try {
                val health = app.probe(url)
                val host = runCatching { URI(url).host }.getOrNull() ?: url
                val trimmed = name.trim()
                val saved = (server ?: ServerConnection(name = "", url = url)).copy(
                    name = trimmed.ifEmpty { if (app.servers.isEmpty()) "Home" else host },
                    url = url,
                    rememberProfile = rememberProfile,
                    version = health.version,
                )
                app.saveServer(saved)
                close()
                if (server == null) app.scope.launch { app.connect(saved) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = e.message
            } finally {
                checking = false
            }
        }
    }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = Hb.background) {
        Column(
            Modifier.fillMaxWidth().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = { close() }) { Text("Cancel", color = Hb.secondaryText) }
                Text(
                    if (server == null) "Add Server" else "Edit Server",
                    Modifier.weight(1f), textAlign = TextAlign.Center, fontWeight = FontWeight.SemiBold, fontSize = 17.sp,
                )
                TextButton(onClick = { save() }, enabled = address.isNotBlank() && !checking) {
                    Text(if (checking) "Checking…" else "Save", color = if (address.isNotBlank()) Hb.red else Hb.tertiaryText, fontWeight = FontWeight.Bold)
                }
            }
            OutlinedTextField(
                value = address,
                onValueChange = { address = it },
                label = { Text("Address") },
                placeholder = { Text("192.168.1.20:8585") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next, autoCorrectEnabled = false),
                modifier = Modifier.fillMaxWidth().focusRequester(focus),
            )
            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                label = { Text("Name") },
                placeholder = { Text("Home") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { save() }),
                modifier = Modifier.fillMaxWidth(),
            )
            Text(
                "The address you open Home Blockbuster with in a browser, like 192.168.1.20:8585 or nas.local:8585. " +
                    "If you leave out the port, 8585 is used. For HTTPS with the installer's private certificate, " +
                    "install home-blockbuster-root-ca.crt on this phone first (Settings → Security → Encryption & credentials → Install a certificate → CA certificate).",
                color = Hb.tertiaryText, fontSize = 12.sp,
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Open last profile automatically", fontSize = 16.sp)
                    Text("Skips “Who's watching?” on this server.", color = Hb.tertiaryText, fontSize = 12.sp)
                }
                Switch(rememberProfile, { rememberProfile = it }, colors = SwitchDefaults.colors(checkedTrackColor = Hb.red))
            }
            error?.let {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Filled.Warning, null, tint = Hb.red)
                    Text(it, color = Hb.red, fontSize = 14.sp)
                }
            }
            if (server != null) {
                Spacer(Modifier.size(4.dp))
                TextButton(onClick = { confirmDelete = true }, modifier = Modifier.fillMaxWidth()) {
                    Text("Remove Server", color = Hb.red)
                }
            }
        }
    }

    LaunchedEffect(Unit) { if (server == null) runCatching { focus.requestFocus() } }

    if (confirmDelete && server != null) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("Remove ${server.name}?") },
            text = { Text("You'll need to sign in again if you add it back.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmDelete = false
                    app.deleteServer(server)
                    close()
                }) { Text("Remove", color = Hb.red) }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Cancel", color = Color.White) } },
        )
    }
}

@Composable
fun LoginScreen(app: AppModel) {
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val focus = remember { FocusRequester() }

    fun submit() {
        if (password.isEmpty() || busy) return
        busy = true
        error = null
        app.scope.launch {
            try {
                app.login(password)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = e.message
            } finally {
                busy = false
            }
        }
    }

    Box(Modifier.fillMaxSize().systemBarsPadding().imePadding(), contentAlignment = Alignment.Center) {
        Column(
            Modifier.widthIn(max = 460.dp).fillMaxSize().padding(horizontal = 28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(22.dp),
        ) {
            Spacer(Modifier.weight(1f))
            LogoMark(Modifier.size(64.dp))
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Sign in", fontSize = 32.sp, fontWeight = FontWeight.Bold)
                app.current?.let { Text("${it.name} · ${it.displayHost}", color = Hb.secondaryText, fontSize = 14.sp) }
            }
            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                label = { Text("Password") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Go),
                keyboardActions = KeyboardActions(onGo = { submit() }),
                modifier = Modifier.fillMaxWidth().focusRequester(focus),
            )
            error?.let { Text(it, color = Hb.red, fontSize = 14.sp) }
            PrimaryButton(
                "Sign In", Modifier.fillMaxWidth(), fill = Hb.red, foreground = Color.White,
                enabled = password.isNotEmpty(), busy = busy,
            ) { submit() }
            Text(
                "This server is protected with a password. This device stays signed in for 30 days.",
                color = Hb.tertiaryText, fontSize = 12.sp, textAlign = TextAlign.Center,
            )
            Spacer(Modifier.weight(1f))
            TextButton(onClick = { app.disconnect(keepError = false) }) { Text("Choose another server", color = Hb.secondaryText) }
        }
    }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
}

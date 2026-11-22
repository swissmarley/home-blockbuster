package com.swissmarley.homeblockbuster.ui.profiles

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.PersonOutline
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.swissmarley.homeblockbuster.data.ApiClient
import com.swissmarley.homeblockbuster.data.ProfileDTO
import com.swissmarley.homeblockbuster.state.AppModel
import com.swissmarley.homeblockbuster.ui.components.Avatar
import com.swissmarley.homeblockbuster.ui.components.Avatars
import com.swissmarley.homeblockbuster.ui.components.EmptyState
import com.swissmarley.homeblockbuster.ui.components.LogoMark
import com.swissmarley.homeblockbuster.ui.theme.Hb
import com.swissmarley.homeblockbuster.util.Format
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** "Who's watching?" */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun ProfilePicker(app: AppModel) {
    var managing by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<ProfileDTO?>(null) }
    var creating by remember { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    Column(Modifier.fillMaxSize().systemBarsPadding()) {
        Box(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp)) {
            TextButton(onClick = { app.disconnect(keepError = false) }, modifier = Modifier.align(Alignment.CenterStart)) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Hb.secondaryText)
                Text(" ${app.current?.name ?: "Servers"}", color = Hb.secondaryText)
            }
            LogoMark(Modifier.size(30.dp).align(Alignment.Center))
        }
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = {
                refreshing = true
                scope.launch { app.reloadProfiles(); refreshing = false }
            },
            modifier = Modifier.fillMaxSize(),
        ) {
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(30.dp),
            ) {
                Text(
                    if (managing) "Manage Profiles" else "Who's watching?",
                    fontSize = 28.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 40.dp),
                )
                if (app.profiles.isEmpty()) {
                    EmptyState(Icons.Filled.PersonOutline, "No profiles yet", "Create a profile to start watching.")
                }
                FlowRow(
                    Modifier.widthIn(max = 700.dp).padding(horizontal = 24.dp),
                    horizontalArrangement = Arrangement.spacedBy(22.dp, Alignment.CenterHorizontally),
                    verticalArrangement = Arrangement.spacedBy(26.dp),
                ) {
                    for (profile in app.profiles) {
                        Column(
                            Modifier.width(104.dp).clip(RoundedCornerShape(8.dp)).clickable {
                                if (managing) editing = profile else app.scope.launch { app.select(profile) }
                            },
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Box(Modifier.size(104.dp), contentAlignment = Alignment.Center) {
                                Avatar(profile.avatar, Modifier.size(104.dp))
                                if (managing) {
                                    Box(Modifier.size(104.dp).background(Color.Black.copy(alpha = 0.5f), RoundedCornerShape(6.dp)))
                                    Icon(Icons.Filled.Edit, "Edit ${profile.name}", tint = Color.White, modifier = Modifier.size(30.dp))
                                }
                            }
                            Text(profile.name, color = Hb.secondaryText, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                    if (app.profiles.size < 5) {
                        Column(
                            Modifier.width(104.dp).clip(RoundedCornerShape(8.dp)).clickable { creating = true },
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Box(
                                Modifier.size(104.dp).border(2.dp, Hb.tertiaryText, RoundedCornerShape(6.dp)),
                                contentAlignment = Alignment.Center,
                            ) {
                                Icon(Icons.Filled.Add, null, tint = Hb.secondaryText, modifier = Modifier.size(40.dp))
                            }
                            Text("Add Profile", color = Hb.secondaryText, fontSize = 14.sp)
                        }
                    }
                }
                Text(
                    if (managing) "Done" else "Manage Profiles",
                    color = if (managing) Color.Black else Hb.secondaryText,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 17.sp,
                    modifier = Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .then(
                            if (managing) Modifier.background(Color.White)
                            else Modifier.border(1.dp, Hb.tertiaryText, RoundedCornerShape(4.dp))
                        )
                        .clickable { managing = !managing }
                        .padding(horizontal = 22.dp, vertical = 10.dp),
                )
            }
        }
    }

    editing?.let { p -> ProfileEditSheet(app, p) { editing = null } }
    if (creating) ProfileEditSheet(app, null) { creating = false }
}

/** Create a profile, or change a profile's settings (saved on the server, so they follow you to every device). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileEditSheet(app: AppModel, profile: ProfileDTO?, onDismiss: () -> Unit) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf(profile?.name ?: "") }
    var avatar by remember {
        mutableStateOf(profile?.avatar ?: Avatars.all.firstOrNull { id -> app.profiles.none { it.avatar == id } } ?: "smile-blue")
    }
    var kids by remember { mutableStateOf(profile?.kids ?: false) }
    var autoplayNext by remember { mutableStateOf(profile?.autoplayNext ?: true) }
    var autoplayPreviews by remember { mutableStateOf(profile?.autoplayPreviews ?: true) }
    var subtitleLang by remember { mutableStateOf(profile?.subtitleLang) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }
    var langMenu by remember { mutableStateOf(false) }

    fun close() {
        scope.launch { sheet.hide() }.invokeOnCompletion { onDismiss() }
    }

    fun save() {
        val trimmed = name.trim()
        saving = true
        error = null
        app.scope.launch {
            try {
                val id = profile?.id ?: app.createProfile(trimmed, avatar, kids).id
                app.updateProfile(id, ApiClient.ProfileUpdate(trimmed, avatar, kids, autoplayNext, autoplayPreviews, subtitleLang))
                close()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = e.message
            } finally {
                saving = false
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
                    if (profile == null) "Add Profile" else "Edit Profile",
                    Modifier.weight(1f), textAlign = TextAlign.Center, fontWeight = FontWeight.SemiBold, fontSize = 17.sp,
                )
                TextButton(onClick = { save() }, enabled = name.isNotBlank() && !saving) {
                    Text(if (saving) "Saving…" else "Save", color = if (name.isNotBlank()) Hb.red else Hb.tertiaryText, fontWeight = FontWeight.Bold)
                }
            }
            Avatar(avatar, Modifier.size(96.dp).align(Alignment.CenterHorizontally))
            LazyRow(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                items(Avatars.all) { id ->
                    Avatar(
                        id,
                        Modifier
                            .size(54.dp)
                            .then(if (avatar == id) Modifier.border(3.dp, Color.White, RoundedCornerShape(6.dp)) else Modifier)
                            .clickable { avatar = id },
                    )
                }
            }
            OutlinedTextField(
                value = name, onValueChange = { name = it }, label = { Text("Name") }, singleLine = true,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words),
                modifier = Modifier.fillMaxWidth(),
            )
            ToggleRow("Kids profile", "Only shows titles rated for children.", kids) { kids = it }
            Text("PLAYBACK", color = Hb.secondaryText, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 8.dp))
            ToggleRow("Autoplay next episode", null, autoplayNext) { autoplayNext = it }
            ToggleRow("Autoplay previews", null, autoplayPreviews) { autoplayPreviews = it }
            Box {
                Row(
                    Modifier.fillMaxWidth().clickable { langMenu = true }.padding(vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("Subtitles", Modifier.weight(1f), fontSize = 16.sp)
                    Text(Format.languages.firstOrNull { it.first == subtitleLang }?.second ?: "Off", color = Hb.secondaryText)
                }
                DropdownMenu(expanded = langMenu, onDismissRequest = { langMenu = false }) {
                    DropdownMenuItem(text = { Text("Off") }, onClick = { subtitleLang = null; langMenu = false })
                    for ((code, label) in Format.languages) {
                        DropdownMenuItem(text = { Text(label) }, onClick = { subtitleLang = code; langMenu = false })
                    }
                }
            }
            error?.let { Text(it, color = Hb.red, fontSize = 14.sp) }
            if (profile != null && app.profiles.size > 1) {
                TextButton(onClick = { confirmDelete = true }, modifier = Modifier.fillMaxWidth()) { Text("Delete Profile", color = Hb.red) }
                Text(
                    "Deleting a profile removes its My List, ratings and watch history on this server.",
                    color = Hb.tertiaryText, fontSize = 12.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }

    if (confirmDelete && profile != null) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("Delete ${profile.name}?") },
            confirmButton = {
                TextButton(onClick = {
                    confirmDelete = false
                    app.scope.launch {
                        try {
                            app.deleteProfile(profile.id)
                            close()
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            error = e.message
                        }
                    }
                }) { Text("Delete Profile", color = Hb.red) }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Cancel", color = Color.White) } },
        )
    }
}

@Composable
fun ToggleRow(title: String, footer: String?, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().clickable { onChange(!checked) }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, fontSize = 16.sp)
            if (footer != null) Text(footer, color = Hb.tertiaryText, fontSize = 12.sp)
        }
        Switch(checked, onChange, colors = SwitchDefaults.colors(checkedTrackColor = Hb.red))
    }
}

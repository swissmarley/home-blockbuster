package com.swissmarley.homeblockbuster.ui.settings

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.FlashOn
import androidx.compose.material.icons.filled.HighQuality
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Subtitles
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material.icons.filled.VerifiedUser
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.swissmarley.homeblockbuster.BuildConfig
import com.swissmarley.homeblockbuster.data.AppPreferences
import com.swissmarley.homeblockbuster.data.ProfileDTO
import com.swissmarley.homeblockbuster.state.AppModel
import com.swissmarley.homeblockbuster.ui.components.Avatar
import com.swissmarley.homeblockbuster.ui.profiles.ProfileEditSheet
import com.swissmarley.homeblockbuster.ui.theme.Hb
import com.swissmarley.homeblockbuster.util.Format
import kotlinx.coroutines.launch

/** Profile, server and app settings. */
@Composable
fun SettingsScreen(app: AppModel) {
    var editing by remember { mutableStateOf<ProfileDTO?>(null) }
    var confirmSignOut by remember { mutableStateOf(false) }
    val context = LocalContext.current

    Column(Modifier.fillMaxSize().statusBarsPadding().verticalScroll(rememberScrollState()).padding(bottom = 24.dp)) {
        Text("Profile & Settings", fontSize = 30.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(start = 16.dp, top = 12.dp, bottom = 4.dp))

        app.profile?.let { profile ->
            Section("Profile", "Profile settings are saved on the server, so they're the same on every device.") {
                Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    Avatar(profile.avatar, Modifier.size(56.dp))
                    Column {
                        Text(profile.name, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                        Text(if (profile.kids) "Kids profile" else "Profile", color = Hb.secondaryText, fontSize = 14.sp)
                    }
                }
                Divider()
                ActionRow(Icons.Filled.Tune, "Edit Profile & Playback Settings") { editing = profile }
                Divider()
                ActionRow(Icons.Filled.People, "Switch Profile") { app.switchProfile() }
                Divider()
                SwitchRow(Icons.Filled.VerifiedUser, "Open this profile automatically", app.rememberProfile) { app.rememberProfile = it }
            }
            Section("Your profile on this server") {
                ValueRow("Autoplay next episode", if (profile.autoplayNext) "On" else "Off")
                Divider()
                ValueRow("Subtitles", profile.subtitleLang?.let { code -> Format.languages.firstOrNull { it.first == code }?.second } ?: "Off")
                Divider()
                ValueRow("My List", "${app.state.myList.size} titles")
            }
        }

        Section(
            "This phone",
            "Quality applies when the server converts a video. “Always convert” helps with files that stutter or don't play directly.",
        ) {
            PickerRow(
                Icons.Filled.HighQuality, "Streaming quality", app.preferences.quality.label,
                AppPreferences.Quality.entries.map { it.label to { app.updatePreferences { p -> p.copy(quality = it) } } },
            )
            Divider()
            SwitchRow(Icons.Filled.FlashOn, "Always convert on server", app.preferences.alwaysConvert) { on ->
                app.updatePreferences { it.copy(alwaysConvert = on) }
            }
            Divider()
            val sizes = listOf("Small" to 0.8, "Medium" to 1.0, "Large" to 1.3, "Extra Large" to 1.6)
            PickerRow(
                Icons.Filled.Subtitles, "Subtitle size",
                sizes.firstOrNull { it.second == app.preferences.subtitleSize }?.first ?: "Medium",
                sizes.map { (label, value) -> label to { app.updatePreferences { it.copy(subtitleSize = value) } } },
            )
        }

        app.current?.let { server ->
            Section("Server", "Libraries, metadata and the server password are managed from the web app in a browser.") {
                ValueRow("Server", server.name)
                Divider()
                ValueRow("Address", server.displayHost)
                server.version?.let { Divider(); ValueRow("Version", it) }
                Divider()
                ValueRow("Library", "${app.titles.size} titles")
                Divider()
                ActionRow(Icons.Filled.Dns, "Switch Server") { app.disconnect(keepError = false) }
                Divider()
                ActionRow(Icons.Filled.Refresh, "Refresh Library") { app.scope.launch { app.reloadLibrary() } }
                if (app.authRequired) {
                    Divider()
                    ActionRow(Icons.AutoMirrored.Filled.Logout, "Sign Out of ${server.name}", destructive = true) { confirmSignOut = true }
                }
            }
        }

        Section(null, "Home Blockbuster is an independent open-source project, not affiliated with Netflix or Blockbuster.") {
            ValueRow("App version", BuildConfig.VERSION_NAME)
            Divider()
            ActionRow(Icons.Filled.Code, "Home Blockbuster on GitHub") {
                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://github.com/swissmarley/home-blockbuster")))
            }
        }
    }

    editing?.let { p -> ProfileEditSheet(app, p) { editing = null } }

    if (confirmSignOut) {
        AlertDialog(
            onDismissRequest = { confirmSignOut = false },
            title = { Text("Sign out of this server?") },
            confirmButton = {
                TextButton(onClick = {
                    confirmSignOut = false
                    app.scope.launch { app.signOut() }
                }) { Text("Sign Out", color = Hb.red) }
            },
            dismissButton = { TextButton(onClick = { confirmSignOut = false }) { Text("Cancel", color = Color.White) } },
        )
    }
}

@Composable
private fun Section(header: String?, footer: String? = null, content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.padding(horizontal = 16.dp).padding(top = 22.dp)) {
        header?.let { Text(it.uppercase(), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Hb.secondaryText, modifier = Modifier.padding(start = 4.dp, bottom = 6.dp)) }
        Column(Modifier.fillMaxWidth().background(Hb.surface, RoundedCornerShape(12.dp)), content = content)
        footer?.let { Text(it, fontSize = 12.sp, color = Hb.tertiaryText, modifier = Modifier.padding(start = 4.dp, top = 6.dp, end = 4.dp)) }
    }
}

@Composable
private fun Divider() = HorizontalDivider(Modifier.padding(start = 14.dp), color = Color.White.copy(alpha = 0.08f))

@Composable
private fun ValueRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 13.dp)) {
        Text(label, Modifier.weight(1f), fontSize = 16.sp)
        Text(value, color = Hb.secondaryText, fontSize = 16.sp)
    }
}

@Composable
private fun ActionRow(icon: ImageVector, label: String, destructive: Boolean = false, onClick: () -> Unit) {
    val color = if (destructive) Hb.red else Color.White
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(icon, null, tint = if (destructive) Hb.red else Hb.secondaryText, modifier = Modifier.size(22.dp))
        Text(label, color = color, fontSize = 16.sp)
    }
}

@Composable
private fun SwitchRow(icon: ImageVector, label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable { onChange(!checked) }.padding(horizontal = 14.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(icon, null, tint = Hb.secondaryText, modifier = Modifier.size(22.dp))
        Text(label, Modifier.weight(1f), fontSize = 16.sp)
        Switch(checked, onChange, colors = SwitchDefaults.colors(checkedTrackColor = Hb.red))
    }
}

@Composable
private fun PickerRow(icon: ImageVector, label: String, value: String, options: List<Pair<String, () -> Unit>>) {
    var open by remember { mutableStateOf(false) }
    Box {
        Row(
            Modifier.fillMaxWidth().clickable { open = true }.padding(horizontal = 14.dp, vertical = 13.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Icon(icon, null, tint = Hb.secondaryText, modifier = Modifier.size(22.dp))
            Text(label, Modifier.weight(1f), fontSize = 16.sp)
            Text(value, color = Hb.secondaryText, fontSize = 15.sp)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            for ((text, action) in options) {
                DropdownMenuItem(text = { Text(text) }, onClick = { open = false; action() })
            }
        }
    }
}

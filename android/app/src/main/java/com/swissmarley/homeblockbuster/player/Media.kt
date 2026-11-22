package com.swissmarley.homeblockbuster.player

import android.content.Context
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.source.MediaSource
import com.swissmarley.homeblockbuster.data.ApiClient

/** Builds ExoPlayer sources that carry the server's session cookie. */
@OptIn(UnstableApi::class)
object Media {
    fun source(context: Context, client: ApiClient, url: String, hls: Boolean): MediaSource {
        val data = OkHttpDataSource.Factory(ApiClient.mediaHttp).setDefaultRequestProperties(client.authHeaders)
        val item = MediaItem.Builder()
            .setUri(url)
            .apply {
                if (hls) {
                    setMimeType(MimeTypes.APPLICATION_M3U8)
                    // The server's conversion is a growing EVENT playlist. Keep it at normal speed from the start
                    // instead of letting ExoPlayer chase the "live" edge.
                    setLiveConfiguration(
                        MediaItem.LiveConfiguration.Builder()
                            .setMinPlaybackSpeed(1f)
                            .setMaxPlaybackSpeed(1f)
                            .build()
                    )
                }
            }
            .build()
        return DefaultMediaSourceFactory(context).setDataSourceFactory(data).createMediaSource(item)
    }

    fun newSession(length: Int): String = java.util.UUID.randomUUID().toString().replace("-", "").take(length)
}

package com.swissmarley.homeblockbuster

import android.app.Application
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.disk.DiskCache
import coil3.disk.directory
import coil3.memory.MemoryCache
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.request.crossfade
import com.swissmarley.homeblockbuster.data.ApiClient
import com.swissmarley.homeblockbuster.player.PreviewCenter
import com.swissmarley.homeblockbuster.state.AppModel
import okhttp3.Interceptor

class HomeBlockbusterApp : Application(), SingletonImageLoader.Factory {
    lateinit var model: AppModel
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this
        model = AppModel(this)
        model.previews = PreviewCenter(this, model)
    }

    /** Artwork is served by the connected server and needs its session cookie, like every API call. */
    override fun newImageLoader(context: PlatformContext): ImageLoader {
        val auth = Interceptor { chain ->
            val request = chain.request()
            val client = model.client
            if (client != null && request.url.toString().startsWith(client.baseUrl)) {
                val builder = request.newBuilder()
                client.authHeaders.forEach { (k, v) -> builder.header(k, v) }
                chain.proceed(builder.build())
            } else {
                chain.proceed(request)
            }
        }
        val http = ApiClient.http.newBuilder().addInterceptor(auth).build()
        return ImageLoader.Builder(context)
            .components { add(OkHttpNetworkFetcherFactory(callFactory = { http })) }
            .memoryCache { MemoryCache.Builder().maxSizePercent(context, 0.25).build() }
            .diskCache { DiskCache.Builder().directory(context.cacheDir.resolve("artwork")).maxSizeBytes(300L shl 20).build() }
            .crossfade(200)
            .build()
    }

    companion object {
        lateinit var instance: HomeBlockbusterApp
            private set
    }
}

package com.swissmarley.homeblockbuster.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Stores each server's session token encrypted with a key that never leaves this device's keystore. */
class SecureStore(context: Context) {
    private val prefs = context.getSharedPreferences("sessions", Context.MODE_PRIVATE)

    private val key: SecretKey? by lazy {
        runCatching {
            val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            (ks.getKey(ALIAS, null) as? SecretKey) ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
                init(
                    KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .build()
                )
                generateKey()
            }
        }.getOrNull()
    }

    @Synchronized
    fun set(account: String, value: String?) {
        val k = key
        if (value == null || k == null) {
            prefs.edit().remove(account).apply()
            return
        }
        runCatching {
            val cipher = Cipher.getInstance(TRANSFORM).apply { init(Cipher.ENCRYPT_MODE, k) }
            val sealed = cipher.iv + cipher.doFinal(value.toByteArray())
            prefs.edit().putString(account, Base64.encodeToString(sealed, Base64.NO_WRAP)).apply()
        }
    }

    @Synchronized
    fun get(account: String): String? {
        val k = key ?: return null
        val raw = prefs.getString(account, null) ?: return null
        return runCatching {
            val sealed = Base64.decode(raw, Base64.NO_WRAP)
            val cipher = Cipher.getInstance(TRANSFORM)
            cipher.init(Cipher.DECRYPT_MODE, k, GCMParameterSpec(128, sealed, 0, 12))
            String(cipher.doFinal(sealed, 12, sealed.size - 12))
        }.getOrNull()
    }

    private companion object {
        const val ALIAS = "hb-session-key"
        const val TRANSFORM = "AES/GCM/NoPadding"
    }
}

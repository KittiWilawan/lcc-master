package com.looklancare.app.monitoring

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import android.util.Base64
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Device-scoped event permission only; never stores an account password or refresh token. */
class MonitorCredentialStore(context: Context) {
  companion object { private val guard = Any() }
  private val alias = context.packageName + ".monitor-device"
  private val file = AtomicFile(File(context.noBackupFilesDir, "monitor-credential.json"))
  private fun key(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey(alias, null) as? SecretKey)?.let { return it }
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
      init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
    }.generateKey()
  }
  fun read(): JSONObject? = synchronized(guard) {
    if (!file.baseFile.exists()) return@synchronized null
    try {
      val envelope = JSONObject(file.openRead().bufferedReader().use { it.readText() })
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(envelope.getString("iv"), Base64.NO_WRAP)))
      JSONObject(String(cipher.doFinal(Base64.decode(envelope.getString("body"), Base64.NO_WRAP)), Charsets.UTF_8))
    } catch (_: Exception) { null }
  }
  fun write(value: JSONObject) = synchronized(guard) {
    require(java.net.URI(value.getString("endpoint")).scheme == "https")
    require(value.getString("token").isNotBlank())
    val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
    val envelope = JSONObject().put("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
      .put("body", Base64.encodeToString(cipher.doFinal(value.toString().toByteArray(Charsets.UTF_8)), Base64.NO_WRAP))
    val stream = file.startWrite()
    try { stream.write(envelope.toString().toByteArray()); file.finishWrite(stream) }
    catch (error: Exception) { file.failWrite(stream); throw error }
  }
  fun clear() = synchronized(guard) { file.delete(); KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(alias) } }
}

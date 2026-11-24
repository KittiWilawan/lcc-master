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

/** Encrypted, no-backup gallery, scoped to one account and family. No photos retained. */
class IdentityGalleryStore(context: Context) {
  companion object { private val guard = Any() }
  private val alias = context.packageName + ".monitor-identity"
  private val file = AtomicFile(File(context.noBackupFilesDir, "monitor-identity.json"))
  private fun key(): SecretKey {
    val keys = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (keys.getKey(alias, null) as? SecretKey)?.let { return it }
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
      init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
    }.generateKey()
  }
  fun read(): JSONObject? = synchronized(guard) {
    if (!file.baseFile.exists()) return@synchronized null
    runCatching {
      val value = JSONObject(file.openRead().bufferedReader().use { it.readText() })
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(value.getString("iv"), Base64.NO_WRAP)))
      JSONObject(String(cipher.doFinal(Base64.decode(value.getString("body"), Base64.NO_WRAP)), Charsets.UTF_8))
    }.getOrNull()
  }
  fun write(value: JSONObject) = synchronized(guard) {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
    val valueBytes = value.toString().toByteArray(Charsets.UTF_8)
    val encrypted = try { cipher.doFinal(valueBytes) } finally { valueBytes.fill(0) }
    val envelope = JSONObject().put("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
      .put("body", Base64.encodeToString(encrypted, Base64.NO_WRAP))
    val stream = file.startWrite()
    try { stream.write(envelope.toString().toByteArray()); file.finishWrite(stream) }
    catch (failure: Exception) { file.failWrite(stream); throw failure }
  }
  fun clear() = synchronized(guard) {
    file.delete(); KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(alias) }
  }
  fun writeIf(value: JSONObject, permitted: () -> Boolean): Boolean = synchronized(guard) {
    if (!permitted()) return@synchronized false
    write(value); true
  }
}

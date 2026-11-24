package com.looklancare.app.monitoring

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Camera URLs may contain credentials: persist only under Keystore encryption and outside backup. */
class MonitorSessionStore(private val context: Context) {
  companion object { private val guard = Any() }
  private val alias = context.packageName + ".monitor-session"
  private val file = AtomicFile(File(context.noBackupFilesDir, "monitor-session.json"))
  private val settings = JSONObject(context.assets.open("monitoring/restart.json").bufferedReader().use { it.readText() })
  private val maxTargets = JSONObject(context.assets.open("monitoring/identity.json").bufferedReader().use { it.readText() }).getInt("maxMembers")
  private fun key(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey(alias, null) as? SecretKey)?.let { return it }
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
      init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
    }.generateKey()
  }
  private fun read(): JSONObject? {
    return runCatching {
      val envelope = JSONObject(file.openRead().bufferedReader().use { it.readText() })
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(envelope.getString("iv"), Base64.NO_WRAP)))
      JSONObject(String(cipher.doFinal(Base64.decode(envelope.getString("body"), Base64.NO_WRAP)), Charsets.UTF_8))
    }.getOrNull()
  }
  private fun write(value: JSONObject) {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
    val envelope = JSONObject().put("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
      .put("body", Base64.encodeToString(cipher.doFinal(value.toString().toByteArray(Charsets.UTF_8)), Base64.NO_WRAP))
    val stream = file.startWrite()
    try { stream.write(envelope.toString().toByteArray()); file.finishWrite(stream) }
    catch (error: Exception) { file.failWrite(stream); throw error }
  }
  fun save(cameras: JSONArray) = synchronized(guard) {
    validate(cameras, MonitoringConfig.load(context).int("maxCameras"))
    require(cameras.length() > 0)
    val revision = java.util.UUID.randomUUID().toString()
    write(JSONObject().put("desired", true).put("cameras", cameras).put("revision", revision).put("savedAt", System.currentTimeMillis()).put("recoveryState", "configured"))
    revision
  }
  fun isCurrent(revision: String): Boolean = synchronized(guard) { read()?.optString("revision") == revision }
  fun forRestore(now: Long = System.currentTimeMillis()): JSONArray? = synchronized(guard) {
    val saved = read() ?: return@synchronized null
    val cameras = saved.optJSONArray("cameras") ?: return@synchronized null
    val credential = MonitorCredentialStore(context).read()
    val scopes = runCatching {
      validate(cameras, MonitoringConfig.load(context).int("maxCameras"))
      val camera = cameras.getJSONObject(0)
      val source = MonitorScope(camera.getString("userId"), camera.getString("familyId"))
      val permission = credential?.let { MonitorScope(it.getString("userId"), it.getString("familyId")) }
      val expires = credential?.let { java.time.Instant.parse(it.getString("expiresAt")).toEpochMilli() } ?: 0
      Triple(source, permission, expires)
    }.getOrNull() ?: return@synchronized null
    if (MonitoringRestorePolicy.allowed(saved.optBoolean("desired"), settings.getBoolean("autoRestoreEnabled"), scopes.first, scopes.second, scopes.third, now)) cameras else null
  }
  fun status(): JSONObject = synchronized(guard) {
    val saved = read()
    JSONObject().put("desired", saved?.optBoolean("desired") ?: false).put("canRestore", forRestore() != null)
      .put("userId", saved?.optJSONArray("cameras")?.optJSONObject(0)?.optString("userId") ?: JSONObject.NULL)
      .put("recoveryState", saved?.optString("recoveryState") ?: "disabled")
  }
  fun markRecovery(state: String) = synchronized(guard) {
    require(state.isNotBlank())
    read()?.let { saved ->
      if (saved.optString("recoveryState") != state) {
        write(saved.put("recoveryState", state).put("lastRecoveryAt", System.currentTimeMillis()))
      }
    }
  }
  fun clear() = synchronized(guard) { file.delete(); KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(alias) } }
  fun validate(cameras: JSONArray, maximum: Int) {
    require(cameras.length() <= maximum)
    var scope: MonitorScope? = null
    for (index in 0 until cameras.length()) {
      val camera = cameras.getJSONObject(index)
      require(camera.getString("id").isNotBlank() && camera.getString("name").isNotBlank())
      val current = MonitorScope(camera.getString("userId"), camera.getString("familyId"))
      require(CameraMonitoringTargets.read(camera).memberIds.size <= maxTargets)
      require(scope == null || current == scope); scope = current
      val uri = java.net.URI(camera.getString("url"))
      require((uri.scheme == "http" || uri.scheme == "https") && !uri.host.isNullOrBlank())
    }
  }
}

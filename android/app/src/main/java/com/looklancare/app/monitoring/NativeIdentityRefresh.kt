package com.looklancare.app.monitoring

import android.content.Context
import android.util.Base64
import org.json.JSONObject
import org.json.JSONArray
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URI
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Refresh consenting gallery while JS is suspended. Private device scope gates every write. */
class NativeIdentityRefresh(private val context: Context, private val targeted: () -> Boolean) : AutoCloseable {
  private val settings = JSONObject(context.assets.open("monitoring/identity.json").bufferedReader().use { it.readText() })
  private val cloud = JSONObject(context.assets.open("monitoring/cloud.json").bufferedReader().use { it.readText() })
  private val credentials = MonitorCredentialStore(context)
  private val gallery = IdentityGalleryStore(context)
  private val executor = Executors.newSingleThreadScheduledExecutor()
  private val closed = AtomicBoolean(false)
  init { schedule(0) }
  private fun schedule(delay: Long) {
    if (!closed.get()) runCatching { executor.schedule({ refresh(); schedule(settings.getLong("backgroundRefreshMs")) }, delay, TimeUnit.MILLISECONDS) }
  }
  private fun current(token: String) = !closed.get() && credentials.read()?.optString("token") == token && targeted()
  private fun refresh() {
    if (closed.get() || !targeted()) return
    val credential = credentials.read() ?: return
    val token = credential.getString("token")
    try {
      val existing = gallery.read()
      if (existing?.optString("userId") == credential.getString("userId") && existing.optString("familyId") == credential.getString("familyId") &&
        existing.optLong("expiresAt") - System.currentTimeMillis() > settings.getLong("galleryRenewBeforeMs")) return
      val endpoint = URI(credential.getString("endpoint"))
      val bytes = request(endpoint, settings.getInt("maxResponseBytes"), token)
      val payload = JSONObject(bytes.toString(Charsets.UTF_8))
      require(payload.getString("userId") == credential.getString("userId") && payload.getString("familyId") == credential.getString("familyId"))
      if (existing?.optString("revision") == payload.getString("revision") &&
        existing.optString("userId") == payload.getString("userId") && existing.optString("familyId") == payload.getString("familyId")) {
        existing.put("expiresAt", System.currentTimeMillis() + settings.getLong("galleryTtlMs"))
        gallery.writeIf(existing) { current(token) }; return
      }
      val profiles = payload.getJSONArray("members")
      for (i in 0 until profiles.length()) {
        val profile = profiles.getJSONObject(i); val urls = profile.getJSONArray("photos"); val images = JSONArray()
        require(urls.length() <= settings.getInt("maxReferences"))
        for (j in 0 until urls.length()) {
          if (!current(token)) return
          val uri = URI(urls.getString(j))
          require(uri.scheme == "https" && uri.host == endpoint.host) { "Reference origin changed" }
          val photo = request(uri, settings.getInt("maxReferenceBytes"), null)
          try { images.put(Base64.encodeToString(photo, Base64.NO_WRAP)) } finally { photo.fill(0) }
        }
        profile.put("photos", images)
      }
      if (!current(token)) return
      val prepared = IdentityGalleryInstaller.prepare(context, payload)
      gallery.writeIf(prepared) { current(token) }
    } catch (_: Exception) { /* Expired gallery is never used; retain detection with unknown identity. */ }
  }
  private fun request(uri: URI, maximum: Int, token: String?): ByteArray {
    val connection = uri.toURL().openConnection() as HttpURLConnection
    connection.instanceFollowRedirects = false
    connection.connectTimeout = cloud.getInt("requestTimeoutMs"); connection.readTimeout = cloud.getInt("requestTimeoutMs")
    try {
      if (token != null) {
        connection.requestMethod = "POST"; connection.doOutput = true
        connection.setRequestProperty("Content-Type", "application/json"); connection.setRequestProperty("x-device-token", token)
        connection.outputStream.use { it.write(JSONObject().put("action", "identity-references").toString().toByteArray()) }
      }
      check(connection.responseCode in 200..299)
      require(connection.contentLengthLong <= maximum)
      val output = ByteArrayOutputStream()
      connection.inputStream.use { input ->
        val buffer = ByteArray(minOf(maximum, 8192))
        while (true) {
          if (closed.get()) error("Refresh stopped")
          val size = input.read(buffer); if (size < 0) break
          require(output.size() + size <= maximum)
          output.write(buffer, 0, size)
        }
      }
      return output.toByteArray()
    } finally { connection.disconnect() }
  }
  override fun close() { closed.set(true); executor.shutdownNow() }
}

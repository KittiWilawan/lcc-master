package com.looklancare.app.monitoring

import android.content.Context
import android.util.Base64
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URI
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.atomic.AtomicBoolean

/** Delivers the durable evidence queue without depending on the React Native thread. */
class NativeEventDelivery(context: Context, private val events: CameraEventStore) : AutoCloseable {
  private val credentials = MonitorCredentialStore(context)
  private val config = JSONObject(context.assets.open("monitoring/cloud.json").bufferedReader().use { it.readText() })
  private val executor = Executors.newSingleThreadScheduledExecutor()
  private val closed = AtomicBoolean(false)
  private var retryMs = config.getLong("retryInitialMs")
  private var scheduled: ScheduledFuture<*>? = null
  init { schedule(retryMs) }
  @Synchronized private fun schedule(delayMs: Long) {
    if (closed.get()) return
    scheduled?.cancel(false)
    scheduled = executor.schedule({ drain() }, delayMs, TimeUnit.MILLISECONDS)
  }
  fun requestDrain() { schedule(0) }
  private fun drain() {
    if (closed.get()) return
    var pending = false
    try {
      val credential = credentials.read()
      if (credential != null) {
        val queue = events.read()
        for (index in 0 until queue.length()) {
          if (closed.get()) return
          val event = queue.getJSONObject(index)
          if (event.optBoolean("remoteAccepted") || event.optString("familyId") != credential.getString("familyId") ||
            event.optString("userId") != credential.getString("userId")) continue
          pending = true
          if (credentials.read()?.optString("token") != credential.getString("token")) return
          val connection = URI(credential.getString("endpoint")).toURL().openConnection() as HttpURLConnection
          connection.connectTimeout = config.getInt("requestTimeoutMs"); connection.readTimeout = config.getInt("requestTimeoutMs")
          connection.instanceFollowRedirects = false; connection.requestMethod = "POST"; connection.doOutput = true
          connection.setRequestProperty("Content-Type", "application/json")
          connection.setRequestProperty("x-device-token", credential.getString("token"))
          val image = File(URI(event.getString("imageUri")))
          val body = JSONObject().put("action", "event").put("eventId", event.getString("id"))
            .put("cameraId", event.getString("cameraId")).put("createdAt", java.time.Instant.ofEpochMilli(event.getLong("createdAt")).toString())
            .put("details", event.getJSONObject("analysis").getString("reason"))
            .put("imageBase64", Base64.encodeToString(image.readBytes(), Base64.NO_WRAP))
          try {
            connection.outputStream.use { it.write(body.toString().toByteArray()) }
            val code = connection.responseCode
            if (code in 200..299) {
              val result = JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
              // Scope changes or logout must not update a new user's queue.
              if (credentials.read()?.optString("token") == credential.getString("token")) events.updateDelivery(event.getString("id"), result)
              if (result.optBoolean("remoteAccepted")) pending = false
            } else events.updateDelivery(event.getString("id"), JSONObject().put("state", if (code == 401 || code == 403) "authorization_required" else "delivery_unavailable"))
          } finally { connection.disconnect() }
        }
      }
    } catch (_: Exception) { pending = true }
    retryMs = if (pending) (retryMs * 2).coerceAtMost(config.getLong("retryMaxMs")) else config.getLong("retryInitialMs")
    schedule(retryMs)
  }
  override fun close() { closed.set(true); executor.shutdownNow() }
}

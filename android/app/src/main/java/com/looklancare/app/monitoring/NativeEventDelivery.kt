package com.looklancare.app.monitoring

import android.content.Context
import android.util.Base64
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.util.concurrent.atomic.AtomicBoolean

/** Delivers the durable evidence queue without depending on the React Native thread. */
class NativeEventDelivery(context: Context, private val events: CameraEventStore) : AutoCloseable {
  private val network = context.getSystemService(android.net.ConnectivityManager::class.java)
  private val networkCallback = object : android.net.ConnectivityManager.NetworkCallback() {
    override fun onAvailable(network: android.net.Network) { requestDrain() }
  }
  private val credentials = MonitorCredentialStore(context)
  private val config = JSONObject(context.assets.open("monitoring/cloud.json").bufferedReader().use { it.readText() })
  private val closed = AtomicBoolean(false)
  private var retryMs = config.getLong("retryInitialMs")
  private val scheduler = DeliveryScheduler(config.getLong("retryMaxMs"), ::drain)
  init { runCatching { network.registerDefaultNetworkCallback(networkCallback) }; requestDrain() }
  fun requestDrain() = scheduler.request()
  private fun drain(): Long {
    if (closed.get()) return retryMs
      val credential = credentials.read()
      if (credential != null) {
        val queue = events.forDelivery(System.currentTimeMillis(), config.getLong("retryMaxMs"))
        for (index in 0 until queue.length()) {
          if (closed.get()) return retryMs
          val event = queue.getJSONObject(index)
          if (event.optBoolean("deliveryComplete")) continue
          if (event.optString("familyId") != credential.getString("familyId") || event.optString("userId") != credential.getString("userId")) {
            events.markAttempt(event.getString("id"), config.getLong("retryMaxMs")); continue
          }
          if (credentials.read()?.optString("token") != credential.getString("token")) break
          events.markAttempt(event.getString("id"), retryMs)
          val connection = URI(credential.getString("endpoint")).toURL().openConnection() as HttpURLConnection
          connection.connectTimeout = config.getInt("requestTimeoutMs"); connection.readTimeout = config.getInt("requestTimeoutMs")
          connection.instanceFollowRedirects = false; connection.requestMethod = "POST"; connection.doOutput = true
          connection.setRequestProperty("Content-Type", "application/json")
          connection.setRequestProperty("x-device-token", credential.getString("token"))
          val body = JSONObject().put("action", "event").put("eventId", event.getString("id"))
            .put("cameraId", event.getString("cameraId")).put("createdAt", java.time.Instant.ofEpochMilli(event.getLong("createdAt")).toString())
            .put("details", event.getJSONObject("analysis").getString("reason"))
          if (!event.optBoolean("cloudSynced")) {
            val uri = event.optString("imageUri").takeIf { !event.isNull("imageUri") && it.isNotBlank() }
            val image = readDeliveryImage(uri, config.getInt("maxImageBytes"))
            if (image == null) body.put("evidenceState", "storage_pressure")
            else body.put("imageBase64", Base64.encodeToString(image, Base64.NO_WRAP))
          }
          val analysis = event.getJSONObject("analysis")
          if (!analysis.isNull("fallingMemberId") && analysis.optString("fallingMemberId").isNotBlank()) {
            body.put("memberId", analysis.getString("fallingMemberId")).put("identityState", analysis.optString("identityState"))
          }
          try {
            connection.outputStream.use { it.write(body.toString().toByteArray()) }
            val code = connection.responseCode
            if (code in 200..299) {
              val result = JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
              // Scope changes or logout must not update a new user's queue.
              if (credentials.read()?.optString("token") == credential.getString("token")) events.updateDelivery(event.getString("id"), result)
              // Ticket acceptance is not delivery confirmation; receipts need later polls.
            } else events.updateDelivery(event.getString("id"), JSONObject().put("state", if (code == 401 || code == 403) "authorization_required" else "delivery_unavailable"))
          } catch (_: Exception) {
            events.updateDelivery(event.getString("id"), JSONObject().put("state", "delivery_unavailable"))
          } finally { connection.disconnect() }
        }
      }
    val pending = events.health().pending > 0
    retryMs = if (pending) (retryMs * 2).coerceAtMost(config.getLong("retryMaxMs")) else config.getLong("retryInitialMs")
    return if (credentials.read() == null) retryMs else events.nextAttemptDelay(System.currentTimeMillis(), retryMs, config.getLong("retryMaxMs"))
  }
  override fun close() { closed.set(true); runCatching { network.unregisterNetworkCallback(networkCallback) }; scheduler.close() }
}

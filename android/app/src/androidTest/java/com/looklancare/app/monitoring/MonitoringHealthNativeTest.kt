package com.looklancare.app.monitoring

import android.app.NotificationManager
import android.content.Intent
import android.graphics.Bitmap
import android.os.Bundle
import android.os.PowerManager
import android.os.SystemClock
import androidx.test.platform.app.InstrumentationRegistry
import com.looklancare.app.MainActivity
import com.looklancare.app.MonitoringForegroundService
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.net.HttpURLConnection
import java.net.URI

/** Synthetic family only. OS notification controls are not remote caregiver delivery tests. */
class MonitoringHealthNativeTest {
  private val instrumentation = InstrumentationRegistry.getInstrumentation()
  private val context = instrumentation.targetContext
  private val runtime = MonitoringConfig.load(context)
  private val health = JSONObject(context.assets.open("monitoring/health.json").bufferedReader().use { it.readText() })
  private val notificationId = health.getInt("notificationId")
  private fun notifications() = context.getSystemService(NotificationManager::class.java).activeNotifications
  private fun report(value: JSONObject) { instrumentation.sendStatus(0, Bundle().apply { putString("healthResult", value.toString()) }) }
  private fun await(timeout: Long, predicate: () -> Boolean): Boolean {
    val deadline = SystemClock.elapsedRealtime() + timeout
    while (!predicate() && SystemClock.elapsedRealtime() < deadline) SystemClock.sleep(health.getLong("pollMs"))
    return predicate()
  }
  private fun launch() {
    instrumentation.runOnMainSync { context.startActivity(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    SystemClock.sleep(health.getLong("pollMs"))
  }
  private fun screenOff() {
    instrumentation.uiAutomation.executeShellCommand("input keyevent KEYCODE_SLEEP").close()
    SystemClock.sleep(health.getLong("pollMs"))
    assertFalse(context.getSystemService(PowerManager::class.java).isInteractive)
  }
  private fun request(base: String, path: String) {
    val connection = URI(base + path).toURL().openConnection() as HttpURLConnection
    connection.connectTimeout = runtime.int("connectTimeoutMs"); connection.readTimeout = runtime.int("readTimeoutMs"); connection.requestMethod = "POST"
    try { assertTrue(connection.responseCode in 200..299) } finally { connection.disconnect() }
  }
  @Test fun queuePressureAndDiscardAreReportedWithScreenOff() {
    launch()
    val store = CameraEventStore(context, runtime.int("maxPendingEvents")); store.clear()
    val camera = JSONObject().put("id", "health-queue-camera").put("name", "กล้องสมมติ")
      .put("familyId", "health-test-family").put("userId", "health-test-user").put("jpegQuality", runtime.int("jpegQuality"))
    val bitmap = Bitmap.createBitmap(4, 4, Bitmap.Config.ARGB_8888)
    val previousObserver = MonitoringState.observer
    MonitoringState.cameras[camera.getString("id")] = JSONObject().put("cameraId", camera.getString("id")).put("state", "ready")
    MonitoringState.observer = { throw IllegalStateException("Synthetic inactive JavaScript observer") }
    val worker = MonitoringHealthWorker(context, store) {
      val now = SystemClock.elapsedRealtime()
      listOf(CameraHealthInput(camera.getString("id"), now, "ready", now, now, now, false))
    }
    try {
      screenOff()
      val amount = kotlin.math.ceil(runtime.int("maxPendingEvents") * health.getDouble("queueNearFullRatio")).toInt()
      repeat(amount) { store.add(camera, JSONObject().put("reason", "ข้อมูลสมมติสำหรับทดสอบคิว"), bitmap, false) }
      assertTrue(await(health.getLong("problemDebounceMs") + health.getLong("pollMs") * 4) { notifications().any { it.id == notificationId } })
      val notification = notifications().first { it.id == notificationId }.notification
      assertEquals(android.app.Notification.VISIBILITY_PRIVATE, notification.visibility)
      assertEquals(health.getString("channelId"), notification.channelId)
      assertTrue(notification.extras.getCharSequence(android.app.Notification.EXTRA_BIG_TEXT).toString().contains("มีเหตุรอส่งจำนวนมาก"))
      repeat(runtime.int("maxPendingEvents") + 1 - amount) { store.add(camera, JSONObject().put("reason", "ทดสอบคิวเต็ม"), bitmap, false) }
      assertEquals(0, store.health().discarded)
      assertEquals(runtime.int("maxPendingEvents")+1, store.read().length())
      assertFalse(context.getSystemService(PowerManager::class.java).isInteractive)
      val result = JSONObject().put("test", "queue-screen-off").put("pending", store.health().pending).put("discarded", store.health().discarded)
        .put("osNotification", true).put("screenInteractive", false).put("notificationVisibility", notification.visibility)
      File(context.filesDir, "health-queue-result.json").writeText(result.toString(2)); report(result)
    } finally {
      worker.close(); store.clear(); bitmap.recycle()
      MonitoringState.cameras.remove(camera.getString("id")); MonitoringState.observer = previousObserver
      instrumentation.uiAutomation.executeShellCommand("input keyevent KEYCODE_WAKEUP").close()
    }
    assertFalse(notifications().any { it.id == notificationId })
  }
  @Test fun realStreamDisconnectAlertsAndStableRecoveryClearsTheWarning() {
    val base = InstrumentationRegistry.getArguments().getString("baseUrl") ?: error("baseUrl required")
    launch()
    val store = CameraEventStore(context, runtime.int("maxPendingEvents")); store.clear()
    val camera = JSONObject().put("id", "health-stream-camera").put("name", "กล้องสมมติ")
      .put("familyId", "health-test-family").put("userId", "health-test-user").put("url", base + "/live/live.m3u8")
    context.startForegroundService(Intent(context, MonitoringForegroundService::class.java).putExtra("cameras", JSONArray().put(camera).toString()))
    try {
      assertTrue(await(runtime.long("readTimeoutMs") * 4) { MonitoringState.cameras[camera.getString("id")]?.optString("state") == "ready" })
      screenOff(); request(base, "/pause")
      val pausedAt = SystemClock.elapsedRealtime()
      assertTrue(await(health.getLong("startupGraceMs") + runtime.long("readTimeoutMs") * 4) {
        notifications().any { it.id == notificationId }
      })
      val warningAfterMs = SystemClock.elapsedRealtime() - pausedAt
      val decorated = MonitoringState.decorated(checkNotNull(MonitoringState.cameras[camera.getString("id")]))
      assertTrue(decorated.getJSONArray("healthIssues").toString().contains(HealthIssue.CAMERA_UNAVAILABLE.name))
      assertEquals(0, store.read().length())
      assertFalse(context.getSystemService(PowerManager::class.java).isInteractive)
      request(base, "/resume"); val resumedAt = SystemClock.elapsedRealtime()
      assertTrue(await(runtime.long("retryMaxMs") + runtime.long("readTimeoutMs") * 3 + health.getLong("recoveryDebounceMs")) {
        MonitoringState.cameras[camera.getString("id")]?.optString("state") == "ready" && notifications().none { it.id == notificationId }
      })
      val result = JSONObject().put("test", "disconnect-screen-off").put("warningAfterMs", warningAfterMs)
        .put("recoveryAfterMs", SystemClock.elapsedRealtime() - resumedAt).put("warningCleared", true).put("falseFallEvents", store.read().length())
        .put("screenInteractive", context.getSystemService(PowerManager::class.java).isInteractive)
      File(context.filesDir, "health-stream-result.json").writeText(result.toString(2)); report(result)
      assertFalse(context.getSystemService(PowerManager::class.java).isInteractive)
    } finally {
      request(base, "/resume"); context.stopService(Intent(context, MonitoringForegroundService::class.java)); store.clear()
      instrumentation.uiAutomation.executeShellCommand("input keyevent KEYCODE_WAKEUP").close()
    }
  }
  @Test fun unchangedSnapshotWarnsWithoutClaimingThatTheCameraIsDisconnected() {
    val base = InstrumentationRegistry.getArguments().getString("baseUrl") ?: error("baseUrl required")
    launch()
    val store = CameraEventStore(context, runtime.int("maxPendingEvents")); store.clear()
    val camera = JSONObject().put("id", "health-static-camera").put("name", "กล้องสมมติ")
      .put("familyId", "health-test-family").put("userId", "health-test-user").put("url", base + "/static.jpg")
    context.startForegroundService(Intent(context, MonitoringForegroundService::class.java).putExtra("cameras", JSONArray().put(camera).toString()))
    try {
      assertTrue(await(runtime.long("readTimeoutMs") * 4) { MonitoringState.cameras[camera.getString("id")]?.has("lastFrameAt") == true })
      screenOff()
      assertTrue(await(health.getLong("unchangedContentMs") + health.getLong("problemDebounceMs") + health.getLong("pollMs") * 5) {
        notifications().any { it.id == notificationId }
      })
      val state = MonitoringState.decorated(checkNotNull(MonitoringState.cameras[camera.getString("id")]))
      val issues = state.getJSONArray("healthIssues").toString()
      assertTrue(issues.contains(HealthIssue.IMAGE_UNCHANGED.name)); assertFalse(issues.contains(HealthIssue.CAMERA_UNAVAILABLE.name))
      assertEquals(0, store.read().length()); assertFalse(context.getSystemService(PowerManager::class.java).isInteractive)
      val result = JSONObject().put("test", "unchanged-image-screen-off").put("issues", state.getJSONArray("healthIssues"))
        .put("osNotification", true).put("falseFallEvents", 0).put("screenInteractive", false)
      File(context.filesDir, "health-static-result.json").writeText(result.toString(2)); report(result)
    } finally {
      context.stopService(Intent(context, MonitoringForegroundService::class.java)); store.clear()
      instrumentation.uiAutomation.executeShellCommand("input keyevent KEYCODE_WAKEUP").close()
    }
  }
}

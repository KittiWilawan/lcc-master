package com.looklancare.app.monitoring

import android.content.Intent
import android.os.Bundle
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
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class CameraPipelineTest {
  private val instrumentation = InstrumentationRegistry.getInstrumentation()
  private val context = instrumentation.targetContext
  private val arguments = InstrumentationRegistry.getArguments()
  private val config = MonitoringConfig.load(context)
  private val baseUrl get() = arguments.getString("baseUrl") ?: error("baseUrl test argument required")
  private fun report(result: JSONObject) {
    instrumentation.sendStatus(0, Bundle().apply { putString("pipelineResult", result.toString()) })
  }
  private fun request(path: String, method: String = "GET"): String {
    val connection = URI(baseUrl + path).toURL().openConnection() as HttpURLConnection
    connection.connectTimeout = config.int("connectTimeoutMs"); connection.readTimeout = config.int("readTimeoutMs")
    connection.requestMethod = method
    return try { check(connection.responseCode in 200..299); connection.inputStream.bufferedReader().use { it.readText() } }
    finally { connection.disconnect() }
  }

  @Test fun classifierExportMatchesPython() {
    val forest = PoseForest(context.assets.open("monitoring/fall_forest.bin"))
    val parity = JSONObject(context.assets.open("monitoring/parity.json").bufferedReader().use { it.readText() })
    val features = parity.getJSONArray("features"); val expected = parity.getJSONArray("probabilities")
    var error = 0.0
    for (index in 0 until features.length()) {
      val row = features.getJSONArray(index)
      val actual = forest.predict(FloatArray(row.length()) { row.getDouble(it).toFloat() })
      error = maxOf(error, kotlin.math.abs(actual - expected.getDouble(index)))
    }
    report(JSONObject().put("test", "classifier-parity").put("cases", features.length()).put("maxError", error))
    assertTrue(error <= 1e-12)
  }

  @Test fun runtimeSequencesMatchTrainingFeatures() {
    val metadata = JSONObject(context.assets.open("monitoring/model.json").bufferedReader().use { it.readText() })
    val extractor = PoseFeatures(metadata.getInt("landmarkCount"), metadata.getDouble("visibilityThreshold").toFloat(),
      metadata.getDouble("normalizationMinScale").toFloat(), metadata.getString("featureVariant"))
    val forest = PoseForest(context.assets.open(metadata.getString("modelAsset")))
    val fixtures = JSONArray(request(arguments.getString("featureFixturePath") ?: error("featureFixturePath required")))
    var featureError = 0.0
    var probabilityError = 0.0
    for (index in 0 until fixtures.length()) {
      val fixture = fixtures.getJSONObject(index)
      val rows = fixture.getJSONArray("frames")
      val frames = List(rows.length()) { rowIndex ->
        val row = rows.getJSONArray(rowIndex)
        FloatArray(row.length()) { row.getDouble(it).toFloat() }
      }
      val actual = extractor.sequence(frames)
      val expected = fixture.getJSONArray("features")
      assertEquals(expected.length(), actual.size)
      actual.indices.forEach { feature -> featureError = maxOf(featureError, kotlin.math.abs(actual[feature] - expected.getDouble(feature))) }
      probabilityError = maxOf(probabilityError, kotlin.math.abs(forest.predict(actual) - fixture.getDouble("probability")))
    }
    report(JSONObject().put("test", "runtime-feature-parity").put("cases", fixtures.length())
      .put("maxFeatureError", featureError).put("maxProbabilityError", probabilityError))
    assertTrue(featureError <= 1e-5)
    assertTrue(probabilityError <= 1e-12)
  }

  @Test fun deviceCredentialIsEncryptedAndCleared() {
    val store = MonitorCredentialStore(context)
    val secret = "synthetic-device-token-for-test-only"
    try {
      store.write(JSONObject().put("endpoint", "https://test.invalid/events").put("token", secret)
        .put("deviceId", "synthetic-device").put("userId", "synthetic-user").put("familyId", "synthetic-family")
        .put("expiresAt", "2026-11-06T00:00:00Z"))
      assertEquals(secret, store.read()?.getString("token"))
      val persisted = File(context.noBackupFilesDir, "monitor-credential.json").readText()
      assertFalse(persisted.contains(secret))
      assertFalse(persisted.contains("synthetic-family"))
      store.clear(); assertNull(store.read())
      report(JSONObject().put("test", "device-credential-encryption").put("encrypted", true).put("cleared", true))
    } finally { store.clear() }
  }

  @Test fun hlsDecodingAndLocalAiOnLabelledClips() {
    val cases = JSONArray(request("/cases"))
    val results = JSONArray()
    val analyzer = LocalPoseAnalyzer(context, config)
    try {
      for (index in 0 until cases.length()) {
        val case = cases.getJSONObject(index)
        analyzer.prepare(case.getString("id"))
        val done = CountDownLatch(1)
        val frames = AtomicInteger(0)
        val falls = AtomicInteger(0)
        val states = mutableListOf<String>()
        val timings = mutableListOf<Long>()
        val inferenceErrors = mutableListOf<String>()
        val trace = JSONArray()
        val captureTrace = arguments.getString("captureTrace")?.toBooleanStrictOrNull() == true
        val started = SystemClock.elapsedRealtime()
        var firstFrameMs = 0L
        var firstFallMs: Long? = null
        val inferenceThread = java.util.concurrent.Executors.newSingleThreadExecutor()
        val busy = java.util.concurrent.atomic.AtomicBoolean(false)
        val session = CameraStreamSession(context, baseUrl + case.getString("path"), config,
          { state -> synchronized(states) { states.add(state) }; if (state == "ended") done.countDown() },
          { bitmap, timestamp ->
            if (!busy.compareAndSet(false, true)) bitmap.recycle()
            else inferenceThread.execute {
              try {
                if (frames.get() == 0) firstFrameMs = SystemClock.elapsedRealtime() - started
                val begin = SystemClock.elapsedRealtime()
                val result = analyzer.analyze(case.getString("id"), bitmap, timestamp)
                val inferenceMs = SystemClock.elapsedRealtime() - begin
                timings.add(inferenceMs)
                if (captureTrace) trace.put(JSONObject().put("elapsedMs", SystemClock.elapsedRealtime() - started)
                  .put("timestamp", timestamp).put("inferenceMs", inferenceMs).put("analysis", result))
                frames.incrementAndGet()
                if (result.getString("status") == "fall") {
                  falls.incrementAndGet()
                  if (firstFallMs == null) {
                    firstFallMs = SystemClock.elapsedRealtime() - started
                    if (captureTrace) File(context.filesDir, "pipeline-${case.getString("id")}-fall.jpg").outputStream()
                      .use { bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, config.int("jpegQuality"), it) }
                  }
                }
                if (frames.get() == 1) {
                  val image = File(context.filesDir, "pipeline-${case.getString("id")}.jpg")
                  image.outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, config.int("jpegQuality"), it) }
                }
              } catch (error: Exception) { inferenceErrors.add(error.javaClass.simpleName) }
              finally { bitmap.recycle(); busy.set(false) }
            }
          })
        done.await(case.getLong("durationMs") + config.long("readTimeoutMs"), TimeUnit.MILLISECONDS)
        session.close(); inferenceThread.shutdown(); inferenceThread.awaitTermination(config.long("readTimeoutMs"), TimeUnit.MILLISECONDS)
        val sorted = timings.sorted()
        val summary = JSONObject().put("id", case.getString("id")).put("label", case.getString("label"))
          .put("frames", frames.get()).put("fallSamples", falls.get()).put("predictedFall", falls.get() > 0)
          .put("firstFrameMs", firstFrameMs).put("firstFallMs", firstFallMs ?: JSONObject.NULL)
          .put("inferenceMedianMs", if (sorted.isNotEmpty()) sorted[sorted.size / 2] else JSONObject.NULL)
          .put("inferenceMaxMs", sorted.lastOrNull() ?: JSONObject.NULL)
          .put("inferenceErrors", JSONArray(inferenceErrors.toList()))
          .put("states", JSONArray(states.toList()))
        results.put(summary); report(JSONObject().put("test", "hls-clip").put("result", summary))
        if (captureTrace) File(context.filesDir, "pipeline-${case.getString("id")}-trace.json").writeText(trace.toString(2))
        assertTrue("No decoded/inferred frames for ${case.getString("id")}", frames.get() > 0)
        assertTrue("Inference failed for ${case.getString("id")}: $inferenceErrors", inferenceErrors.isEmpty())
        analyzer.reset(case.getString("id"))
      }
    } finally { analyzer.close() }
    File(context.filesDir, "pipeline-clips.json").writeText(results.toString(2))
  }

  @Test fun streamRecoversAfterNetworkInterruption() {
    val frames = AtomicInteger(0)
    val first = CountDownLatch(1)
    val states = mutableListOf<String>()
    val session = CameraStreamSession(context, baseUrl + "/live/live.m3u8", config,
      { state -> synchronized(states) { states.add(state) } }, { bitmap, _ -> bitmap.recycle(); frames.incrementAndGet(); first.countDown() })
    try {
      assertTrue(first.await(config.long("readTimeoutMs") * 3, TimeUnit.MILLISECONDS))
      request("/pause", "POST")
      SystemClock.sleep(config.long("frameStaleMs") + config.long("watchdogIntervalMs") * 2)
      val before = frames.get(); val resumed = SystemClock.elapsedRealtime()
      request("/resume", "POST")
      while (frames.get() <= before && SystemClock.elapsedRealtime() - resumed < config.long("retryMaxMs") + config.long("readTimeoutMs")) SystemClock.sleep(config.long("frameIntervalMs"))
      val recoveryMs = SystemClock.elapsedRealtime() - resumed
      report(JSONObject().put("test", "stream-recovery").put("framesBeforeResume", before).put("framesAfterResume", frames.get())
        .put("recoveryMs", recoveryMs).put("states", JSONArray(states.toList())))
      assertTrue(frames.get() > before)
      assertTrue(states.contains("reconnecting"))
    } finally { request("/resume", "POST"); session.close() }
  }

  @Test fun closingOneCameraKeepsTheOtherDecoding() {
    val firstFrames = AtomicInteger(0)
    val secondFrames = AtomicInteger(0)
    val firstReady = CountDownLatch(1)
    val secondReady = CountDownLatch(1)
    val secondReconnects = AtomicInteger(0)
    val first = CameraStreamSession(context, baseUrl + "/live/live.m3u8", config, {}, { bitmap, _ ->
      bitmap.recycle(); firstFrames.incrementAndGet(); firstReady.countDown()
    })
    val second = CameraStreamSession(context, baseUrl + "/live/live.m3u8", config,
      { state -> if (state == "reconnecting") secondReconnects.incrementAndGet() }, { bitmap, _ ->
      bitmap.recycle(); secondFrames.incrementAndGet(); secondReady.countDown()
    })
    try {
      assertTrue("First camera never decoded", firstReady.await(config.long("readTimeoutMs") * 3, TimeUnit.MILLISECONDS))
      assertTrue("Second camera never decoded", secondReady.await(config.long("readTimeoutMs") * 3, TimeUnit.MILLISECONDS))
      val before = secondFrames.get()
      first.close()
      SystemClock.sleep(config.long("watchdogIntervalMs") * 2)
      val after = secondFrames.get()
      report(JSONObject().put("test", "two-camera-teardown").put("firstFrames", firstFrames.get())
        .put("secondFramesBeforeClose", before).put("secondFramesAfterClose", after).put("secondReconnects", secondReconnects.get()))
      assertTrue("Closing one camera stopped the other", after > before)
      assertEquals("Other camera should not need to reconnect", 0, secondReconnects.get())
    } finally { first.close(); second.close() }
  }

  @Test fun nativeMonitoringContinuesWhenScreenIsOff() {
    instrumentation.runOnMainSync {
      context.startActivity(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
    SystemClock.sleep(config.long("readTimeoutMs"))
    CameraEventStore(context, config.int("maxPendingEvents")).clear()
    val camera = JSONObject().put("id", "pipeline-background-camera").put("name", "กล้องทดสอบ")
      .put("familyId", "pipeline-test-family").put("userId", "pipeline-test-user").put("url", baseUrl + "/live/live.m3u8")
    val intent = Intent(context, MonitoringForegroundService::class.java).putExtra("cameras", JSONArray().put(camera).toString())
    context.startForegroundService(intent)
    val readyDeadline = SystemClock.elapsedRealtime() + config.long("readTimeoutMs") * 4
    while (MonitoringState.cameras[camera.getString("id")]?.optString("state") != "ready" && SystemClock.elapsedRealtime() < readyDeadline) SystemClock.sleep(config.long("frameIntervalMs"))
    assertEquals("ready", MonitoringState.cameras[camera.getString("id")]?.optString("state"))
    val duration = arguments.getString("screenOffMs")?.toLong() ?: error("screenOffMs test argument required")
    instrumentation.uiAutomation.executeShellCommand("input keyevent KEYCODE_SLEEP").close()
    SystemClock.sleep(config.long("watchdogIntervalMs"))
    val power = context.getSystemService(android.os.PowerManager::class.java)
    assertFalse("Screen must actually be off", power.isInteractive)
    val started = SystemClock.elapsedRealtime()
    val checkpoints = JSONArray()
    try {
      while (SystemClock.elapsedRealtime() - started < duration) {
        SystemClock.sleep(config.long("watchdogIntervalMs"))
        val state = MonitoringState.cameras[camera.getString("id")]
        if (state != null) checkpoints.put(JSONObject().put("elapsedMs", SystemClock.elapsedRealtime() - started)
          .put("state", state.getString("state")).put("lastFrameAt", state.optLong("lastFrameAt"))
          .put("lastAnalysisAt", state.optLong("lastAnalysisAt")).put("inferenceMs", state.optLong("inferenceMs")))
      }
      val state = MonitoringState.cameras[camera.getString("id")] ?: error("Monitoring stopped")
      val age = System.currentTimeMillis() - state.getLong("lastAnalysisAt")
      val summary = JSONObject().put("test", "screen-off").put("durationMs", duration).put("analysisAgeMs", age)
        .put("checkpoints", checkpoints.length()).put("screenInteractive", power.isInteractive).put("state", state.getString("state"))
      val unexpected = CameraEventStore(context, config.int("maxPendingEvents")).read().length()
      summary.put("unexpectedNormalEvents", unexpected)
      report(summary)
      assertFalse("Screen unexpectedly woke during test", power.isInteractive)
      assertEquals("False fall events during normal live clip", 0, unexpected)
      File(context.filesDir, "pipeline-screen-off-$duration.json").writeText(checkpoints.toString(2))
      assertEquals("ready", state.getString("state")); assertTrue(age <= config.long("frameStaleMs"))
      val fallPath = arguments.getString("fallPath")
      if (fallPath != null) {
        val store = CameraEventStore(context, config.int("maxPendingEvents")); store.clear()
        val switchAt = System.currentTimeMillis()
        camera.put("url", baseUrl + fallPath)
        context.startForegroundService(Intent(context, MonitoringForegroundService::class.java)
          .putExtra("cameras", JSONArray().put(camera).toString()))
        val deadline = SystemClock.elapsedRealtime() + config.long("readTimeoutMs") * 4
        val fallTrace = JSONArray()
        while (store.read().length() == 0 && SystemClock.elapsedRealtime() < deadline) {
          SystemClock.sleep(config.long("frameIntervalMs"))
          MonitoringState.cameras[camera.getString("id")]?.let { fallTrace.put(JSONObject(it.toString())) }
        }
        File(context.filesDir, "pipeline-screen-off-$duration-fall-trace.json").writeText(fallTrace.toString(2))
        summary.put("postFallState", MonitoringState.cameras[camera.getString("id")] ?: JSONObject.NULL)
        report(summary)
        File(context.filesDir, "pipeline-screen-off-$duration-result.json").writeText(summary.toString(2))
        val queued = store.read(); assertTrue("No fall event while screen was off", queued.length() > 0)
        val event = queued.getJSONObject(0)
        assertTrue(event.getLong("createdAt") >= switchAt)
        assertTrue("OS notification was not posted", event.getBoolean("notificationSent"))
        val notifications = context.getSystemService(android.app.NotificationManager::class.java).activeNotifications
        assertTrue(notifications.any { it.id == camera.getString("id").hashCode().and(Int.MAX_VALUE) })
        assertFalse(power.isInteractive)
        summary.put("fallAlertAfterScreenOff", true).put("eventAt", event.getLong("createdAt"))
          .put("clipStartToAlertMs", event.getLong("createdAt") - switchAt)
        report(summary)
      }
      File(context.filesDir, "pipeline-screen-off-$duration-result.json").writeText(summary.toString(2))
    } finally {
      instrumentation.uiAutomation.executeShellCommand("input keyevent KEYCODE_WAKEUP").close()
      context.stopService(Intent(context, MonitoringForegroundService::class.java))
    }
  }
}

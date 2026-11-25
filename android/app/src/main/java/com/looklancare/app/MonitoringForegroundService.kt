package com.looklancare.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.looklancare.app.monitoring.CameraEventStore
import com.looklancare.app.monitoring.CameraStreamSession
import com.looklancare.app.monitoring.LocalPoseAnalyzer
import com.looklancare.app.monitoring.MonitoringConfig
import com.looklancare.app.monitoring.MonitoringState
import com.looklancare.app.monitoring.NativeEventDelivery
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.io.ByteArrayOutputStream
import android.util.Base64

class MonitoringForegroundService : Service() {
  private lateinit var config: MonitoringConfig
  private lateinit var events: CameraEventStore
  private lateinit var savedSession: com.looklancare.app.monitoring.MonitorSessionStore
  private var delivery: NativeEventDelivery? = null
  private var identityRefresh: com.looklancare.app.monitoring.NativeIdentityRefresh? = null
  private var healthWorker: com.looklancare.app.monitoring.MonitoringHealthWorker? = null
  private val startedAt = ConcurrentHashMap<String, Long>()
  private val frameAt = ConcurrentHashMap<String, Long>()
  private val analysisAt = ConcurrentHashMap<String, Long>()
  private val contentAt = ConcurrentHashMap<String, Long>()
  private val saveFailures = ConcurrentHashMap.newKeySet<String>()
  private val main = Handler(Looper.getMainLooper())
  private val inference = Executors.newSingleThreadExecutor()
  private var analyzer: LocalPoseAnalyzer? = null
  private val sessions = mutableMapOf<String, CameraStreamSession>()
  private val sources = ConcurrentHashMap<String, JSONObject>()
  private val decoderStates = ConcurrentHashMap<String, String>()
  private val dispatchers = ConcurrentHashMap<String, com.looklancare.app.monitoring.CameraFrameDispatcher>()
  private var scope: String? = null
  private var wakeLock: PowerManager.WakeLock? = null
  @Volatile private var destroyed = false
  private val renewWakeLock = object : Runnable {
    override fun run() {
      if (destroyed) return
      wakeLock?.let { if (it.isHeld) it.release(); it.acquire(config.long("wakeLockTimeoutMs")) }
      main.postDelayed(this, config.long("wakeLockTimeoutMs") / 2)
    }
  }

  override fun onCreate() {
    super.onCreate()
    config = MonitoringConfig.load(this)
    savedSession = com.looklancare.app.monitoring.MonitorSessionStore(this)
    events = CameraEventStore(this, config.int("maxPendingEvents"))
    startHealthWorker()
    delivery = NativeEventDelivery(this, events)
    MonitoringState.deliveryRefresh = { delivery?.requestDrain() }
    identityRefresh = com.looklancare.app.monitoring.NativeIdentityRefresh(this) {
      !destroyed && sources.values.any { !com.looklancare.app.monitoring.CameraMonitoringTargets.read(it).allPeople }
    }
    createNotificationChannel()
    wakeLock = (getSystemService(POWER_SERVICE) as PowerManager)
      .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "$packageName:camera-monitoring").apply { setReferenceCounted(false) }
  }

  private fun startHealthWorker() {
    healthWorker = com.looklancare.app.monitoring.MonitoringHealthWorker(this, events) {
      sources.keys.map { id -> com.looklancare.app.monitoring.CameraHealthInput(id, startedAt[id] ?: SystemClock.elapsedRealtime(),
        MonitoringState.cameras[id]?.optString("state") ?: "connecting", frameAt[id] ?: 0, analysisAt[id] ?: 0,
        contentAt[id] ?: 0, id in saveFailures) }
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    startForeground(NOTIFICATION_ID, createNotification())
    val requested = intent?.getStringExtra("cameras")
    val revision = intent?.getStringExtra("monitorRevision")
    if (revision != null && !savedSession.isCurrent(revision)) {
      if (sessions.isEmpty()) stopSelf()
      return if (sessions.isEmpty()) START_NOT_STICKY else START_STICKY
    }
    val cameras = requested ?: savedSession.forRestore()?.toString()
    if (cameras.isNullOrBlank()) { MonitoringRestoreReceiver.notifyNeedsAppOpen(this, savedSession); stopSelf(); return START_NOT_STICKY }
    try {
      val sources = JSONArray(cameras)
      savedSession.validate(sources, config.int("maxCameras"))
      if (sources.length() == 0) { savedSession.clear(); stopSelf(); return START_NOT_STICKY }
      if (requested != null && revision == null) savedSession.save(sources)
      MonitoringState.configuredScope = com.looklancare.app.monitoring.MonitorScope(sources.getJSONObject(0).getString("userId"), sources.getJSONObject(0).getString("familyId"))
      applyCameras(sources)
      savedSession.markRecovery("starting")
    }
    catch (_: Exception) { stopSelf(); return START_NOT_STICKY }
    MonitoringState.running = sessions.isNotEmpty()
    main.removeCallbacks(renewWakeLock)
    main.post(renewWakeLock)
    getSharedPreferences(PREFERENCES_NAME, MODE_PRIVATE)
      .edit()
      .putBoolean(KEY_RUNNING, true)
      .apply()
    // System restart revalidates the encrypted scope and unexpired device permission.
    return START_STICKY
  }

  private fun applyCameras(cameras: JSONArray) {
    require(cameras.length() <= config.int("maxCameras"))
    val requested = mutableMapOf<String, JSONObject>()
    for (index in 0 until cameras.length()) {
      val camera = cameras.getJSONObject(index)
      val nextScope = camera.getString("userId") + ":" + camera.getString("familyId")
      if (scope != null && scope != nextScope) {
        healthWorker?.close(); healthWorker = null
        sessions.values.forEach { it.close() }; sessions.clear(); sources.clear(); decoderStates.clear(); dispatchers.values.forEach { it.close() }; dispatchers.clear()
        events.clear(); MonitoringState.cameras.clear()
        startedAt.clear(); frameAt.clear(); analysisAt.clear(); contentAt.clear(); saveFailures.clear(); MonitoringState.clearHealth()
        startHealthWorker()
        inference.execute { analyzer?.close(); analyzer = null }
      }
      scope = nextScope
      camera.put("jpegQuality", config.int("jpegQuality"))
      requested[camera.getString("id")] = camera
    }
    (sessions.keys - requested.keys).forEach { id ->
      sources.remove(id); sessions.remove(id)?.close(); dispatchers.remove(id)?.close(); MonitoringState.cameras.remove(id)
      decoderStates.remove(id)
      startedAt.remove(id); frameAt.remove(id); analysisAt.remove(id); contentAt.remove(id); saveFailures.remove(id)
      inference.execute { analyzer?.reset(id) }
    }
    requested.forEach { (id, camera) ->
      if (sources[id]?.toString() == camera.toString()) return@forEach
      sources[id] = camera
      startedAt[id] = SystemClock.elapsedRealtime(); frameAt.remove(id); analysisAt.remove(id); contentAt.remove(id); saveFailures.remove(id)
      MonitoringState.cameras.remove(id)
      decoderStates[id] = "connecting"
      sessions.remove(id)?.close()
      inference.execute {
        if (!destroyed && sources[id] === camera) {
          try {
            val detector = analyzer ?: LocalPoseAnalyzer(this, config).also { analyzer = it }
            detector.reset(id); detector.prepare(id)
          } catch (_: LinkageError) { if (sources[id] === camera) publish(camera, "ai_error") }
          catch (_: Exception) { if (sources[id] === camera) publish(camera, "ai_error") }
        }
      }
      dispatchers.remove(id)?.close()
      val dispatcher = com.looklancare.app.monitoring.CameraFrameDispatcher(inference,
        config.int("maxPendingFrames"), config.long("maxPendingFrameAgeMs")) { bitmap, timestamp ->
        processFrame(camera, bitmap, timestamp)
      }
      dispatchers[id] = dispatcher
      sessions[id] = CameraStreamSession(this, camera.getString("url"), config,
        { state ->
          if (sources[id] === camera) {
            decoderStates[id] = state
            publish(camera, state)
            if (state == "reconnecting") {
              dispatcher.clearPending()
              inference.execute { if (sources[id] === camera) analyzer?.reset(id) }
            }
          }
        }, { bitmap, timestamp ->
          if (destroyed || sources[id] !== camera) bitmap.recycle() else { frameAt[id] = timestamp; dispatcher.submit(bitmap, timestamp) }
        })
    }
  }

  private fun processFrame(camera: JSONObject, bitmap: android.graphics.Bitmap, timestamp: Long) {
    val id = camera.getString("id")
    try {
      if (destroyed || sources[id] !== camera || SystemClock.elapsedRealtime() - timestamp > config.long("maxPendingFrameAgeMs")) return
      val detector = analyzer ?: LocalPoseAnalyzer(this, config).also { analyzer = it }
      val started = SystemClock.elapsedRealtime()
      val result = detector.analyze(id, bitmap, timestamp, camera)
      val now = System.currentTimeMillis()
      val state = JSONObject().put("cameraId", id).put("state", if (decoderStates[id] == "ended") "ended" else if (result.optBoolean("frameStalled")) "reconnecting" else "ready").put("analysis", result)
        .put("lastFrameAt", now - (SystemClock.elapsedRealtime() - timestamp)).put("lastAnalysisAt", now)
        .put("inferenceMs", SystemClock.elapsedRealtime() - started).put("frameWidth", bitmap.width).put("frameHeight", bitmap.height)
      if (!destroyed && sources[id] === camera) {
        val firstAnalysis = !analysisAt.containsKey(id)
        analysisAt[id] = SystemClock.elapsedRealtime()
        if (firstAnalysis && sources.keys.all { analysisAt.containsKey(it) }) {
          savedSession.markRecovery("ready")
          val restart = JSONObject(assets.open("monitoring/restart.json").bufferedReader().use { it.readText() })
          NotificationManagerCompat.from(this).cancel(restart.getInt("notificationId"))
        }
        if (result.getJSONObject("diagnostics").optBoolean("distinctFrame")) contentAt[id] = timestamp
        if (MonitoringState.previews.contains(id)) {
          val bytes = ByteArrayOutputStream()
          bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, config.int("jpegQuality"), bytes)
          state.put("previewImage", "data:image/jpeg;base64," + Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP))
        }
        for (fall in com.looklancare.app.monitoring.PersonFallEvents.from(result)) {
          val notificationSent = notifyFall(fall.getString("eventId"))
          try {
            events.add(camera, fall, bitmap, notificationSent) { !destroyed && sources[id] === camera &&
              MonitoringState.configuredScope == com.looklancare.app.monitoring.MonitorScope(camera.getString("userId"), camera.getString("familyId")) }; saveFailures.remove(id)
            delivery?.requestDrain(); state.put("hasPendingEvent", true)
          } catch (_: Exception) { saveFailures.add(id) }
        }
        if (!destroyed && sources[id] === camera && MonitoringState.configuredScope == com.looklancare.app.monitoring.MonitorScope(camera.getString("userId"), camera.getString("familyId"))) MonitoringState.publish(id, state)
      }
    } catch (_: LinkageError) { if (!destroyed && sources[id] === camera) publish(camera, "ai_error") }
    catch (_: Exception) { if (!destroyed && sources[id] === camera) publish(camera, "ai_error") }
  }

  private fun publish(camera: JSONObject, state: String) {
    MonitoringState.publish(camera.getString("id"), JSONObject().put("cameraId", camera.getString("id")).put("state", state))
  }

  private fun notifyFall(eventId: String): Boolean {
    val manager = NotificationManagerCompat.from(this)
    if (!manager.areNotificationsEnabled()) return false
    return try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val channel = NotificationChannel("camera-fall-alerts", "เหตุที่สงสัยว่าอาจล้ม", NotificationManager.IMPORTANCE_HIGH)
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        if (getSystemService(NotificationManager::class.java).getNotificationChannel(channel.id)?.importance == NotificationManager.IMPORTANCE_NONE) return false
      }
      val intent = PendingIntent.getActivity(this, OPEN_APP_REQUEST_CODE, Intent(this, MainActivity::class.java)
        .apply { flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP }, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      val notification = NotificationCompat.Builder(this, "camera-fall-alerts").setSmallIcon(R.drawable.notification_icon)
        .setContentTitle("พบเหตุที่สงสัยว่าอาจล้ม").setContentText("เปิด LookLanCare เพื่อตรวจสอบภาพและช่วยเหลือ")
        .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setCategory(NotificationCompat.CATEGORY_ALARM)
        .setPriority(NotificationCompat.PRIORITY_HIGH).setContentIntent(intent).setAutoCancel(true).build()
      manager.notify(eventId, OPEN_APP_REQUEST_CODE, notification)
      true
    } catch (_: Exception) { false }
  }

  override fun onDestroy() {
    destroyed = true
    healthWorker?.close(); healthWorker = null
    delivery?.close(); delivery = null
    MonitoringState.deliveryRefresh = null
    identityRefresh?.close(); identityRefresh = null
    sources.clear(); decoderStates.clear(); sessions.values.forEach { it.close() }; sessions.clear()
    dispatchers.values.forEach { it.close() }; dispatchers.clear()
    startedAt.clear(); frameAt.clear(); analysisAt.clear(); contentAt.clear(); saveFailures.clear()
    MonitoringState.running = false; MonitoringState.cameras.clear()
    main.removeCallbacksAndMessages(null)
    wakeLock?.let { if (it.isHeld) it.release() }
    inference.execute { analyzer?.close(); analyzer = null }
    inference.shutdown()
    getSharedPreferences(PREFERENCES_NAME, MODE_PRIVATE)
      .edit()
      .putBoolean(KEY_RUNNING, false)
      .apply()
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val channel = NotificationChannel(
      CHANNEL_ID,
      "สถานะการเฝ้าระวัง",
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = "แสดงเมื่อ LookLanCare กำลังตรวจภาพกล้องเบื้องหลัง"
      setShowBadge(false)
    }
    getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
  }

  private fun createNotification(): Notification {
    val openAppIntent = Intent(this, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    val pendingIntent = PendingIntent.getActivity(
      this,
      OPEN_APP_REQUEST_CODE,
      openAppIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.notification_icon)
      .setContentTitle("LookLanCare กำลังเฝ้าระวัง")
      .setContentText("ตรวจจากกล้องที่ตั้งไว้ · เปิดแอปเพื่อดูสถานะภาพและ AI")
      .setContentIntent(pendingIntent)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .build()
  }

  companion object {
    const val PREFERENCES_NAME = "looklancare_monitoring"
    const val KEY_RUNNING = "is_running"
    private const val CHANNEL_ID = "looklancare-monitoring-status"
    private const val NOTIFICATION_ID = 4101
    private const val OPEN_APP_REQUEST_CODE = 4102
  }
}

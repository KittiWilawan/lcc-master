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
import java.util.concurrent.atomic.AtomicBoolean
import java.io.ByteArrayOutputStream
import android.util.Base64

class MonitoringForegroundService : Service() {
  private lateinit var config: MonitoringConfig
  private lateinit var events: CameraEventStore
  private var delivery: NativeEventDelivery? = null
  private val main = Handler(Looper.getMainLooper())
  private val inference = Executors.newSingleThreadExecutor()
  private var analyzer: LocalPoseAnalyzer? = null
  private val sessions = mutableMapOf<String, CameraStreamSession>()
  private val sources = ConcurrentHashMap<String, JSONObject>()
  private val decoderStates = ConcurrentHashMap<String, String>()
  private val busy = ConcurrentHashMap<String, AtomicBoolean>()
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
    events = CameraEventStore(this, config.int("maxPendingEvents"))
    delivery = NativeEventDelivery(this, events)
    createNotificationChannel()
    wakeLock = (getSystemService(POWER_SERVICE) as PowerManager)
      .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "$packageName:camera-monitoring").apply { setReferenceCounted(false) }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    startForeground(NOTIFICATION_ID, createNotification())
    val cameras = intent?.getStringExtra("cameras")
    if (cameras.isNullOrBlank()) { stopSelf(); return START_NOT_STICKY }
    try { applyCameras(JSONArray(cameras)) }
    catch (_: Exception) { stopSelf(); return START_NOT_STICKY }
    MonitoringState.running = sessions.isNotEmpty()
    main.removeCallbacks(renewWakeLock)
    main.post(renewWakeLock)
    getSharedPreferences(PREFERENCES_NAME, MODE_PRIVATE)
      .edit()
      .putBoolean(KEY_RUNNING, true)
      .apply()
    // Restart requires a live authenticated app to provide its camera scope.
    return START_NOT_STICKY
  }

  private fun applyCameras(cameras: JSONArray) {
    require(cameras.length() <= config.int("maxCameras"))
    val requested = mutableMapOf<String, JSONObject>()
    for (index in 0 until cameras.length()) {
      val camera = cameras.getJSONObject(index)
      val nextScope = camera.getString("userId") + ":" + camera.getString("familyId")
      if (scope != null && scope != nextScope) {
        sessions.values.forEach { it.close() }; sessions.clear(); sources.clear(); decoderStates.clear(); busy.clear()
        events.clear(); MonitoringState.cameras.clear()
        inference.execute { analyzer?.close(); analyzer = null }
      }
      scope = nextScope
      camera.put("jpegQuality", config.int("jpegQuality"))
      requested[camera.getString("id")] = camera
    }
    (sessions.keys - requested.keys).forEach { id ->
      sources.remove(id); sessions.remove(id)?.close(); busy.remove(id); MonitoringState.cameras.remove(id)
      decoderStates.remove(id)
      inference.execute { analyzer?.reset(id) }
    }
    requested.forEach { (id, camera) ->
      if (sources[id]?.toString() == camera.toString()) return@forEach
      sources[id] = camera
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
      val gate = AtomicBoolean(false); busy[id] = gate
      sessions[id] = CameraStreamSession(this, camera.getString("url"), config,
        { state ->
          if (sources[id] === camera) {
            decoderStates[id] = state
            publish(camera, state)
            if (state == "reconnecting") inference.execute { if (sources[id] === camera) analyzer?.reset(id) }
          }
        }, { bitmap, timestamp ->
          if (destroyed || sources[id] !== camera || !gate.compareAndSet(false, true)) bitmap.recycle()
          else {
            try {
              inference.execute {
                try {
                  if (!destroyed && sources[id] === camera && SystemClock.elapsedRealtime() - timestamp <= config.long("frameStaleMs")) {
                    val detector = analyzer ?: LocalPoseAnalyzer(this, config).also { analyzer = it }
                    val started = SystemClock.elapsedRealtime()
                    val result = detector.analyze(id, bitmap, timestamp)
                    val now = System.currentTimeMillis()
                    val state = JSONObject().put("cameraId", id).put("state", if (decoderStates[id] == "ended") "ended" else "ready").put("analysis", result)
                      .put("lastFrameAt", now - (SystemClock.elapsedRealtime() - timestamp)).put("lastAnalysisAt", now)
                      .put("inferenceMs", SystemClock.elapsedRealtime() - started).put("frameWidth", bitmap.width).put("frameHeight", bitmap.height)
                    if (!destroyed && sources[id] === camera) {
                      if (MonitoringState.previews.contains(id)) {
                        val bytes = ByteArrayOutputStream()
                        bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, config.int("jpegQuality"), bytes)
                        state.put("previewImage", "data:image/jpeg;base64," + Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP))
                      }
                      if (result.getBoolean("fallDetected")) {
                        val notificationSent = notifyFall(camera)
                        events.add(camera, result, bitmap, notificationSent)
                        delivery?.requestDrain()
                        state.put("hasPendingEvent", true)
                      }
                      MonitoringState.publish(id, state)
                    }
                  }
                } catch (_: LinkageError) { if (!destroyed && sources[id] === camera) publish(camera, "ai_error") }
                catch (_: Exception) { if (!destroyed && sources[id] === camera) publish(camera, "ai_error") }
                finally { bitmap.recycle(); gate.set(false) }
              }
            } catch (_: Exception) { bitmap.recycle(); gate.set(false) }
          }
        })
    }
  }

  private fun publish(camera: JSONObject, state: String) {
    MonitoringState.publish(camera.getString("id"), JSONObject().put("cameraId", camera.getString("id")).put("state", state))
  }

  private fun notifyFall(camera: JSONObject): Boolean {
    val manager = NotificationManagerCompat.from(this)
    if (!manager.areNotificationsEnabled()) return false
    return try {
      val channel = NotificationChannel("camera-fall-alerts", "เหตุที่สงสัยว่าอาจล้ม", NotificationManager.IMPORTANCE_HIGH)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && getSystemService(NotificationManager::class.java)
          .getNotificationChannel(channel.id)?.importance == NotificationManager.IMPORTANCE_NONE) return false
      val intent = PendingIntent.getActivity(this, OPEN_APP_REQUEST_CODE, Intent(this, MainActivity::class.java)
        .apply { flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP }, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      val notification = NotificationCompat.Builder(this, "camera-fall-alerts").setSmallIcon(R.drawable.notification_icon)
        .setContentTitle("พบเหตุที่สงสัยว่าอาจล้ม").setContentText("เปิด LookLanCare เพื่อตรวจสอบภาพและช่วยเหลือ")
        .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setCategory(NotificationCompat.CATEGORY_ALARM)
        .setPriority(NotificationCompat.PRIORITY_HIGH).setContentIntent(intent).setAutoCancel(true).build()
      manager.notify(camera.getString("id").hashCode().and(Int.MAX_VALUE), notification)
      true
    } catch (_: Exception) { false }
  }

  override fun onDestroy() {
    destroyed = true
    delivery?.close(); delivery = null
    sources.clear(); decoderStates.clear(); sessions.values.forEach { it.close() }; sessions.clear()
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

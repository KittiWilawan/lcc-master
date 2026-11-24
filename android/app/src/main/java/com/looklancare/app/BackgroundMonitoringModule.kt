package com.looklancare.app

import android.content.Intent
import android.os.Build
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.looklancare.app.monitoring.CameraEventStore
import com.looklancare.app.monitoring.CameraStreamSession
import com.looklancare.app.monitoring.MonitoringConfig
import com.looklancare.app.monitoring.MonitoringState
import com.looklancare.app.monitoring.MonitorCredentialStore
import org.json.JSONArray
import org.json.JSONObject
import android.os.Handler
import android.os.Looper
import java.util.concurrent.atomic.AtomicBoolean

class BackgroundMonitoringModule(
  private val context: ReactApplicationContext,
) : ReactContextBaseJavaModule(context) {
  private val probes = mutableSetOf<CameraStreamSession>()
  private val identityExecutor = java.util.concurrent.Executors.newSingleThreadExecutor()
  private val identityGuard = Any()
  private var identityGeneration = 0L
  init {
    MonitoringState.observer = { update ->
      if (context.hasActiveReactInstance()) context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit("CameraMonitorUpdate", update.toString())
    }
  }
  override fun getName(): String = "BackgroundMonitoring"

  @ReactMethod
  fun start(promise: Promise) {
    try {
      val intent = Intent(context, MonitoringForegroundService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("BACKGROUND_MONITORING_START_FAILED", error)
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    try {
      MonitoringState.configuredScope = null
      com.looklancare.app.monitoring.MonitorSessionStore(context).clear()
      context.stopService(Intent(context, MonitoringForegroundService::class.java))
      MonitorCredentialStore(context).clear()
      synchronized(identityGuard) { identityGeneration++; com.looklancare.app.monitoring.IdentityGalleryStore(context).clear() }
      CameraEventStore(context, MonitoringConfig.load(context).int("maxPendingEvents")).clear()
      context.getSharedPreferences(MonitoringForegroundService.PREFERENCES_NAME, android.content.Context.MODE_PRIVATE)
        .edit()
        .putBoolean(MonitoringForegroundService.KEY_RUNNING, false)
        .apply()
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("BACKGROUND_MONITORING_STOP_FAILED", error)
    }
  }

  @ReactMethod
  fun isRunning(promise: Promise) {
    promise.resolve(MonitoringState.running)
  }

  @ReactMethod fun configure(configuration: String, promise: Promise) {
    try {
      val sources = JSONArray(configuration)
      val config = MonitoringConfig.load(context)
      require(sources.length() <= config.int("maxCameras")) { "Too many cameras for this device configuration" }
      var scope: String? = null
      for (index in 0 until sources.length()) {
        val camera = sources.getJSONObject(index)
        require(camera.getString("id").isNotBlank() && camera.getString("familyId").isNotBlank() && camera.getString("userId").isNotBlank())
        val cameraScope = camera.getString("userId") + ":" + camera.getString("familyId")
        require(scope == null || scope == cameraScope)
        scope = cameraScope
        val uri = java.net.URI(camera.getString("url"))
        require(uri.scheme == "http" || uri.scheme == "https")
      }
      val saved = com.looklancare.app.monitoring.MonitorSessionStore(context)
      saved.validate(sources, config.int("maxCameras"))
      if (sources.length() == 0) { MonitoringState.configuredScope = null; saved.clear(); context.stopService(Intent(context, MonitoringForegroundService::class.java)) }
      else {
        val revision = saved.save(sources)
        MonitoringState.configuredScope = com.looklancare.app.monitoring.MonitorScope(sources.getJSONObject(0).getString("userId"), sources.getJSONObject(0).getString("familyId"))
        val intent = Intent(context, MonitoringForegroundService::class.java).putExtra("cameras", sources.toString()).putExtra("monitorRevision", revision)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent) else context.startService(intent)
      }
      promise.resolve(true)
    } catch (error: Exception) { promise.reject("MONITOR_CONFIG_INVALID", "ตั้งค่ากล้องไม่สำเร็จ กรุณาตรวจจำนวนกล้องและลิงก์", error) }
  }

  @ReactMethod fun getStates(promise: Promise) {
    promise.resolve(JSONArray(MonitoringState.cameras.values.map { MonitoringState.decorated(it) }).toString())
  }

  @ReactMethod fun configureDelivery(configuration: String, promise: Promise) {
    try { MonitorCredentialStore(context).write(JSONObject(configuration)); MonitoringState.deliveryRefresh?.invoke(); promise.resolve(true) }
    catch (_: Exception) { promise.reject("MONITOR_CREDENTIAL_FAILED", "ตั้งค่าการส่งแจ้งเตือนเบื้องหลังไม่สำเร็จ") }
  }

  @ReactMethod fun clearIdentityGallery(promise: Promise) {
    synchronized(identityGuard) { identityGeneration++; com.looklancare.app.monitoring.IdentityGalleryStore(context).clear() }
    promise.resolve(true)
  }
  @ReactMethod fun getIdentityGallery(promise: Promise) {
    val value = com.looklancare.app.monitoring.IdentityGalleryStore(context).read()
    // Metadata only: no face vectors or reference photos cross back to React Native.
    promise.resolve((value?.let { JSONObject().put("userId", it.getString("userId"))
      .put("familyId", it.getString("familyId")).put("revision", it.getString("revision"))
      .put("expiresAt", it.getLong("expiresAt")).put("memberIds", JSONArray(
        (0 until it.getJSONArray("members").length()).map { index -> it.getJSONArray("members").getJSONObject(index).getString("id") })) }
      ?: JSONObject()).toString())
  }
  @ReactMethod fun configureIdentityGallery(configuration: String, promise: Promise) {
    val generation = synchronized(identityGuard) { ++identityGeneration }
    identityExecutor.execute {
      try {
        val value = com.looklancare.app.monitoring.IdentityGalleryInstaller.prepare(context, JSONObject(configuration))
        synchronized(identityGuard) {
          if (generation != identityGeneration) { promise.resolve(false); return@execute }
          com.looklancare.app.monitoring.IdentityGalleryStore(context).write(value)
        }
        promise.resolve(true)
      } catch (_: Exception) { promise.reject("IDENTITY_REFERENCE_FAILED", "เตรียมใบหน้าไม่สำเร็จ กรุณาสแกนรูปอ้างอิงที่ชัดเจนใหม่") }
    }
  }

  @ReactMethod fun getDeliveryRegistration(promise: Promise) {
    val value = MonitorCredentialStore(context).read()
    // The bridge exposes only registration metadata, never the scoped secret.
    promise.resolve((value?.let { JSONObject().put("deviceId", it.getString("deviceId"))
      .put("userId", it.getString("userId")).put("familyId", it.getString("familyId"))
      .put("expiresAt", it.getString("expiresAt")) } ?: JSONObject()).toString())
  }

  @ReactMethod fun setPreviewEnabled(cameraId: String, enabled: Boolean) {
    if (enabled) MonitoringState.previews.add(cameraId) else MonitoringState.previews.remove(cameraId)
  }

  @ReactMethod fun getCapabilities(promise: Promise) {
    try {
      val config = MonitoringConfig.load(context)
      context.assets.open("monitoring/model.json").close()
      val manager = context.getSystemService(android.app.NotificationManager::class.java)
      val localNotificationsEnabled = androidx.core.app.NotificationManagerCompat.from(context).areNotificationsEnabled() &&
        (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || manager.getNotificationChannel("camera-fall-alerts")?.importance != android.app.NotificationManager.IMPORTANCE_NONE)
      val deliveryRegistration = MonitorCredentialStore(context).read()
      val deliveryValid = deliveryRegistration?.let { value ->
        runCatching { java.time.Instant.parse(value.getString("expiresAt")).toEpochMilli() > System.currentTimeMillis() }.getOrDefault(false)
      } ?: false
      promise.resolve(JSONObject().put("maxCameras", config.int("maxCameras"))
        .put("selectionPolicy", "verified_targets_only")
        .put("recovery", com.looklancare.app.monitoring.MonitorSessionStore(context).status())
        .put("frameIntervalMs", config.int("frameIntervalMs")).put("frameStaleMs", config.int("frameStaleMs"))
        .put("remotePushConfigured", context.resources.getIdentifier("google_app_id", "string", context.packageName) != 0)
        .put("remoteDeliveryConfigured", deliveryValid)
        .put("localNotificationsEnabled", localNotificationsEnabled).toString())
    } catch (error: Exception) { promise.reject("MONITOR_UNAVAILABLE", "ยังไม่มีโมเดลตรวจบนอุปกรณ์", error) }
  }

  @ReactMethod fun getPendingEvents(promise: Promise) {
    try { promise.resolve(CameraEventStore(context, MonitoringConfig.load(context).int("maxPendingEvents")).forApp().toString()) }
    catch (_: Exception) { promise.reject("MONITOR_QUEUE_READ_FAILED", "อ่านคิวเหตุไม่สำเร็จ กรุณาตรวจพื้นที่เครื่อง ข้อมูลเดิมยังไม่ถูกลบทิ้ง") }
  }

  @ReactMethod fun markEventLocallySaved(id: String, promise: Promise) {
    try { CameraEventStore(context, MonitoringConfig.load(context).int("maxPendingEvents")).markLocallySaved(id); promise.resolve(true) }
    catch (error: Exception) { promise.reject("MONITOR_EVENT_WRITE_FAILED", "บันทึกสถานะเหตุไม่สำเร็จ", error) }
  }

  @ReactMethod fun acknowledgeEvent(id: String, promise: Promise) {
    try { CameraEventStore(context, MonitoringConfig.load(context).int("maxPendingEvents")).acknowledge(id); promise.resolve(true) }
    catch (error: Exception) { promise.reject("MONITOR_EVENT_WRITE_FAILED", "บันทึกเหตุการณ์ไม่สำเร็จ", error) }
  }

  @ReactMethod fun testSource(url: String, promise: Promise) {
    val complete = AtomicBoolean(false)
    val main = Handler(Looper.getMainLooper())
    var probe: CameraStreamSession? = null
    val finish: (Boolean, String?) -> Unit = { success, explanation ->
      if (complete.compareAndSet(false, true)) {
        main.post {
          probe?.let { synchronized(probes) { probes.remove(it) }; it.close() }
          promise.resolve(JSONObject().put("success", success).put("message", explanation ?: if (success)
            "รับและถอดภาพจากลิงก์สำเร็จ พร้อมเริ่มตรวจบนอุปกรณ์" else "รับภาพไม่ได้ กรุณาตรวจ HLS และเครือข่าย หรืออัปเดต APK").toString())
        }
      }
    }
    try {
      val config = MonitoringConfig.load(context)
      probe = CameraStreamSession(context, url, config, {}, { bitmap, _ -> bitmap.recycle(); finish(true, null) },
        { message -> finish(false, message) })
      synchronized(probes) { probes.add(probe) }
      main.postDelayed({ finish(false, null) }, config.long("connectTimeoutMs") + config.long("readTimeoutMs"))
    } catch (_: Exception) { finish(false, null) }
  }

  @ReactMethod fun addListener(eventName: String) { }
  @ReactMethod fun removeListeners(count: Int) { }

  override fun invalidate() {
    synchronized(identityGuard) { identityGeneration++ }
    identityExecutor.shutdownNow()
    MonitoringState.observer = null
    MonitoringState.previews.clear()
    synchronized(probes) { probes.forEach { it.close() }; probes.clear() }
    super.invalidate()
  }
}

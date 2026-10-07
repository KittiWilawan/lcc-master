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
      context.stopService(Intent(context, MonitoringForegroundService::class.java))
      MonitorCredentialStore(context).clear()
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
      if (sources.length() == 0) context.stopService(Intent(context, MonitoringForegroundService::class.java))
      else {
        val intent = Intent(context, MonitoringForegroundService::class.java).putExtra("cameras", sources.toString())
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent) else context.startService(intent)
      }
      promise.resolve(true)
    } catch (error: Exception) { promise.reject("MONITOR_CONFIG_INVALID", "ตั้งค่ากล้องไม่สำเร็จ กรุณาตรวจจำนวนกล้องและลิงก์", error) }
  }

  @ReactMethod fun getStates(promise: Promise) {
    promise.resolve(JSONArray(MonitoringState.cameras.values.toList()).toString())
  }

  @ReactMethod fun configureDelivery(configuration: String, promise: Promise) {
    try { MonitorCredentialStore(context).write(JSONObject(configuration)); promise.resolve(true) }
    catch (_: Exception) { promise.reject("MONITOR_CREDENTIAL_FAILED", "ตั้งค่าการส่งแจ้งเตือนเบื้องหลังไม่สำเร็จ") }
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
        .put("frameIntervalMs", config.int("frameIntervalMs")).put("frameStaleMs", config.int("frameStaleMs"))
        .put("remotePushConfigured", context.resources.getIdentifier("google_app_id", "string", context.packageName) != 0)
        .put("remoteDeliveryConfigured", deliveryValid)
        .put("localNotificationsEnabled", localNotificationsEnabled).toString())
    } catch (error: Exception) { promise.reject("MONITOR_UNAVAILABLE", "ยังไม่มีโมเดลตรวจบนอุปกรณ์", error) }
  }

  @ReactMethod fun getPendingEvents(promise: Promise) {
    promise.resolve(CameraEventStore(context, MonitoringConfig.load(context).int("maxPendingEvents")).read().toString())
  }

  @ReactMethod fun acknowledgeEvent(id: String, promise: Promise) {
    try { CameraEventStore(context, MonitoringConfig.load(context).int("maxPendingEvents")).acknowledge(id); promise.resolve(true) }
    catch (error: Exception) { promise.reject("MONITOR_EVENT_WRITE_FAILED", "บันทึกเหตุการณ์ไม่สำเร็จ", error) }
  }

  @ReactMethod fun testSource(url: String, promise: Promise) {
    val complete = AtomicBoolean(false)
    val main = Handler(Looper.getMainLooper())
    var probe: CameraStreamSession? = null
    val finish: (Boolean) -> Unit = { success ->
      if (complete.compareAndSet(false, true)) {
        main.post {
          probe?.let { synchronized(probes) { probes.remove(it) }; it.close() }
          promise.resolve(JSONObject().put("success", success).put("message", if (success)
            "รับและถอดภาพจากลิงก์สำเร็จ พร้อมเริ่มตรวจบนอุปกรณ์" else "รับภาพไม่ได้ กรุณาตรวจ HLS และเครือข่าย หรืออัปเดต APK").toString())
        }
      }
    }
    try {
      val config = MonitoringConfig.load(context)
      probe = CameraStreamSession(context, url, config, {}) { bitmap, _ -> bitmap.recycle(); finish(true) }
      synchronized(probes) { probes.add(probe) }
      main.postDelayed({ finish(false) }, config.long("connectTimeoutMs") + config.long("readTimeoutMs"))
    } catch (_: Exception) { finish(false) }
  }

  @ReactMethod fun addListener(eventName: String) { }
  @ReactMethod fun removeListeners(count: Int) { }

  override fun invalidate() {
    MonitoringState.observer = null
    MonitoringState.previews.clear()
    synchronized(probes) { probes.forEach { it.close() }; probes.clear() }
    super.invalidate()
  }
}

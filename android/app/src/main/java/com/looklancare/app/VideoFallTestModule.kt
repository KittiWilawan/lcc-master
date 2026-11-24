package com.looklancare.app

import android.graphics.Bitmap
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.looklancare.app.monitoring.MonitoringConfig
import com.looklancare.app.monitoring.VideoFallTestRunner
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class VideoFallTestModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val executor = Executors.newSingleThreadExecutor()
  private val active = java.util.concurrent.atomic.AtomicReference<AtomicBoolean?>()
  override fun getName() = "VideoFallTest"

  @ReactMethod fun start(configuration: String, promise: Promise) {
    val cancelled = AtomicBoolean(false)
    if (!active.compareAndSet(null, cancelled)) {
      promise.reject("VIDEO_TEST_BUSY", "กำลังทดสอบคลิปอยู่ กรุณารอให้หยุดก่อน")
      return
    }
    try { executor.execute {
      try {
        val request = JSONObject(configuration)
        val quality = MonitoringConfig.load(context).int("jpegQuality")
        val result = VideoFallTestRunner(context).run(request, { cancelled.get() }) { frame, bitmap ->
          if (!cancelled.get() && context.hasActiveReactInstance()) {
            val bytes = ByteArrayOutputStream().use { output ->
              check(bitmap.compress(Bitmap.CompressFormat.JPEG, quality, output)); output.toByteArray()
            }
            frame.put("previewImage", "data:image/jpeg;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP))
              .put("frameWidth", bitmap.width).put("frameHeight", bitmap.height)
            context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("VideoFallTestFrame", frame.toString())
          }
        }
        active.compareAndSet(cancelled, null)
        promise.resolve(result.toString())
      } catch (_: java.util.concurrent.CancellationException) {
        active.compareAndSet(cancelled, null)
        promise.reject("VIDEO_TEST_CANCELLED", "หยุดทดสอบแล้ว")
      } catch (_: Exception) {
        active.compareAndSet(cancelled, null)
        promise.reject("VIDEO_TEST_FAILED", "อ่านหรือวิเคราะห์คลิปไม่สำเร็จ กรุณาใช้วิดีโอ MP4 ที่เปิดเล่นได้ ขนาดและความยาวไม่เกินกำหนด")
      } catch (_: LinkageError) {
        active.compareAndSet(cancelled, null)
        promise.reject("VIDEO_TEST_MODEL_UNAVAILABLE", "โมเดล AI บนเครื่องยังไม่พร้อม กรุณาติดตั้ง APK รุ่นล่าสุด")
      }
    } } catch (_: java.util.concurrent.RejectedExecutionException) {
      active.compareAndSet(cancelled, null)
      promise.reject("VIDEO_TEST_UNAVAILABLE", "กรุณาเปิดแอปใหม่แล้วลองอีกครั้ง")
    }
  }
  @ReactMethod fun cancel() { active.get()?.set(true) }
  @ReactMethod fun addListener(eventName: String) { }
  @ReactMethod fun removeListeners(count: Int) { }
  override fun invalidate() { cancel(); executor.shutdown(); super.invalidate() }
}

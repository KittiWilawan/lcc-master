package com.looklancare.app

import android.graphics.Rect
import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.looklancare.app.enrollment.FacePhotoInspector
import com.looklancare.app.enrollment.FaceVectors
import com.looklancare.app.monitoring.MonitoringIdentityAnalyzer
import com.facebook.react.bridge.ReadableArray
import com.looklancare.app.enrollment.FaceScanConfig
import com.looklancare.app.enrollment.PhotoQuality
import com.looklancare.app.imaging.BitmapFrames
import java.util.concurrent.Executors

class FaceEnrollmentModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val executor = Executors.newSingleThreadExecutor()
  private var inspector: FacePhotoInspector? = null
  override fun getName() = "FaceEnrollment"

  /** A one-pose retake must match each retained, already checked reference before replacing the draft. */
  @ReactMethod
  fun matchesRetainedReferences(candidate: String, retained: ReadableArray, promise: Promise) {
    executor.execute {
      try {
        val config = FaceScanConfig.load(context)
        val limit = config.camera.getInt("maxPhotoBytes")
        require(retained.size() in 1 until config.poses.size)
        MonitoringIdentityAnalyzer(context).use { analyzer ->
          fun vector(photo: String): DoubleArray {
            require(photo.isNotEmpty() && photo.length.toLong() <= (limit.toLong() + 2) / 3 * 4)
            val bytes = Base64.decode(photo, Base64.DEFAULT)
            val bitmap = try {
              require(bytes.size <= limit)
              BitmapFrames.decode(bytes, maxOf(config.camera.getInt("width"), config.camera.getInt("height")))
            } finally { bytes.fill(0) }
            return try { analyzer.reference(bitmap) } finally { bitmap.recycle() }
          }
          val sample = vector(candidate)
          try {
            val matched = (0 until retained.size()).all { index ->
              val reference = vector(requireNotNull(retained.getString(index)))
              try { (FaceVectors.cosine(sample, reference) ?: Double.NEGATIVE_INFINITY) >= analyzer.rules.threshold }
              finally { reference.fill(0.0) }
            }
            promise.resolve(matched)
          } finally { sample.fill(0.0) }
        }
      } catch (_: Exception) { promise.reject("REFERENCE_COMPARISON_FAILED", "เทียบใบหน้าไม่ได้ กรุณาถ่ายมุมนี้ใหม่ในที่สว่าง") }
    }
  }

  @ReactMethod
  fun inspectPhoto(base64: String, promise: Promise) {
    try {
      executor.execute {
        try {
          val detector = inspector ?: FacePhotoInspector(context).also { inspector = it }
          val limit = detector.config.getInt("maxInputBytes")
          require(base64.length.toLong() <= (limit.toLong() * 4 / 3) + 4) { "Image exceeds input limit" }
          val bytes = Base64.decode(base64, Base64.DEFAULT)
          require(bytes.size <= limit) { "Image exceeds input limit" }
          val bitmap = try { BitmapFrames.decode(bytes, detector.config.getInt("maxDimension")) }
            finally { bytes.fill(0) }
          try {
            val faces = Arguments.createArray()
            val detected = detector.inspect(bitmap)
            detected.forEach { face -> faces.pushMap(Arguments.createMap().apply {
              putDouble("left", face.left); putDouble("top", face.top)
              putDouble("width", face.width); putDouble("height", face.height); putDouble("confidence", face.confidence)
            }) }
            val qualityConfig = FaceScanConfig.load(context).quality
            val face = detected.singleOrNull()
            val crop = if (face == null) Rect(0, 0, bitmap.width, bitmap.height) else Rect(
              (face.left * bitmap.width).toInt().coerceIn(0, bitmap.width - 1),
              (face.top * bitmap.height).toInt().coerceIn(0, bitmap.height - 1),
              ((face.left + face.width) * bitmap.width).toInt().coerceIn(1, bitmap.width),
              ((face.top + face.height) * bitmap.height).toInt().coerceIn(1, bitmap.height))
            val quality = PhotoQuality.measure(bitmap, crop, qualityConfig.getInt("sampleSize"))
            promise.resolve(Arguments.createMap().apply {
              putArray("faces", faces)
              putDouble("minFaceWidthRatio", detector.config.getDouble("minFaceWidthRatio"))
              putDouble("maxFaceWidthRatio", detector.config.getDouble("maxFaceWidthRatio"))
              putMap("quality", Arguments.createMap().apply {
                putDouble("brightness", quality.brightness); putDouble("sharpness", quality.sharpness)
                putString("issue", quality.rejection(qualityConfig))
              })
            })
          } finally { if (!bitmap.isRecycled) bitmap.recycle() }
        } catch (error: Exception) {
          promise.reject("FACE_PHOTO_CHECK_FAILED", "ตรวจรูปไม่ได้ กรุณาถ่ายใหม่ในที่สว่าง", error)
        }
      }
    } catch (error: Exception) { promise.reject("FACE_PHOTO_CHECK_UNAVAILABLE", "กล้องยังไม่พร้อม กรุณาเปิดหน้าใหม่", error) }
  }

  override fun invalidate() {
    executor.execute { inspector?.close(); inspector = null }
    executor.shutdown()
    super.invalidate()
  }
}

package com.looklancare.app.enrollment

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import android.graphics.Rect
import android.os.Bundle
import android.os.SystemClock
import android.util.Base64
import androidx.test.platform.app.InstrumentationRegistry
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.bridge.WritableMap
import com.looklancare.app.FaceEnrollmentModule
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.File
import java.lang.reflect.Proxy
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/** Exercising the native bridge and difficult photos, without any account or upload. */
class FaceEnrollmentAuditTest {
  private val instrumentation = InstrumentationRegistry.getInstrumentation()
  private val context = instrumentation.targetContext
  private val output = File(context.getExternalFilesDir(null), "face-scan-audit").apply { mkdirs() }
  private fun portrait(): Bitmap = instrumentation.context.assets.open("face-portrait.jpg").use { BitmapFactory.decodeStream(it) }
  private fun encoded(bitmap: Bitmap): String = ByteArrayOutputStream().use {
    check(bitmap.compress(Bitmap.CompressFormat.JPEG, 95, it))
    Base64.encodeToString(it.toByteArray(), Base64.NO_WRAP)
  }
  @Test fun exportAuditCameraCacheForFramingReview() {
    // Only the isolated audit app's cache is accessible here; all photos use a public fixture.
    require(context.packageName.endsWith(".faceaudit.release"))
    val rows = JSONArray()
    for (directory in listOf("Camera", "ImageManipulator")) {
      val files = File(context.cacheDir, directory).listFiles()?.filter { it.isFile && it.extension.lowercase() in listOf("jpg", "jpeg", "png") } ?: emptyList()
      for ((index, file) in files.sortedBy { it.lastModified() }.takeLast(3).withIndex()) {
        val destination = File(output, "camera-$directory-$index.${file.extension}")
        file.copyTo(destination, overwrite = true)
        rows.put(JSONObject().put("name", destination.name).put("bytes", destination.length()))
      }
    }
    File(output, "camera-cache.json").writeText(rows.toString(2))
    instrumentation.sendStatus(0, Bundle().apply { putString("faceCameraCache", rows.toString()) })
  }
  private data class Call(val value: WritableMap?, val error: String?, val elapsedMs: Long)
  private fun inspect(module: FaceEnrollmentModule, base64: String): Call {
    val done = CountDownLatch(1)
    val value = AtomicReference<WritableMap?>()
    val error = AtomicReference<String?>()
    val promise = Proxy.newProxyInstance(Promise::class.java.classLoader, arrayOf(Promise::class.java)) { _, method, args ->
      when (method.name) {
        "resolve" -> { value.set(args?.firstOrNull() as? WritableMap); done.countDown() }
        "reject" -> {
          error.set(args?.firstOrNull()?.toString())
          args?.filterIsInstance<Throwable>()?.firstOrNull()?.let {
            instrumentation.sendStatus(0, Bundle().apply { putString("faceAuditException", it.javaClass.simpleName + ": " + it.message) })
          }
          done.countDown()
        }
      }
      null
    } as Promise
    val start = SystemClock.elapsedRealtime()
    module.inspectPhoto(base64, promise)
    assertTrue("Native bridge must resolve or reject", done.await(20, TimeUnit.SECONDS))
    return Call(value.get(), error.get(), SystemClock.elapsedRealtime() - start)
  }
  @Test fun bridgeReturnsStructuredResultsAndRejectsInvalidFiles() {
    val module = FaceEnrollmentModule(BridgeReactContext(context))
    val rows = JSONArray()
    try {
      val source = portrait()
      try {
        val valid = inspect(module, encoded(source))
        assertNull(valid.error); assertNotNull(valid.value)
        assertEquals(1, valid.value!!.getArray("faces")!!.size())
        rows.put(JSONObject().put("case", "valid-jpeg-bridge").put("faces", 1).put("elapsedMs", valid.elapsedMs))
      } finally { source.recycle() }
      for ((name, payload) in listOf("malformed-base64" to "!invalid", "not-an-image" to Base64.encodeToString(byteArrayOf(0, 1, 2), Base64.NO_WRAP))) {
        val result = inspect(module, payload)
        assertEquals("FACE_PHOTO_CHECK_FAILED", result.error)
        rows.put(JSONObject().put("case", name).put("error", result.error).put("elapsedMs", result.elapsedMs))
      }
      val inputLimit = JSONObject(context.assets.open("enrollment/model.json").bufferedReader().use { it.readText() }).getInt("maxInputBytes")
      val result = inspect(module, "A".repeat((inputLimit * 4 / 3) + 8))
      assertEquals("FACE_PHOTO_CHECK_FAILED", result.error)
      rows.put(JSONObject().put("case", "oversized-payload").put("error", result.error).put("elapsedMs", result.elapsedMs))
    } finally { module.invalidate() }
    File(output, "bridge-results.json").writeText(rows.toString(2))
    instrumentation.sendStatus(0, Bundle().apply { putString("faceBridgeAudit", rows.toString()) })
  }
  @Test fun difficultPhotoResultsAreRecordedWithoutClaimingAccuracy() {
    val source = portrait()
    val double = Bitmap.createBitmap(source.width * 2, source.height, Bitmap.Config.ARGB_8888).also {
      Canvas(it).apply { drawBitmap(source, 0f, 0f, null); drawBitmap(source, source.width.toFloat(), 0f, null) }
    }
    val blank = Bitmap.createBitmap(source.width, source.height, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.WHITE) }
    val dark = Bitmap.createBitmap(source.width, source.height, Bitmap.Config.ARGB_8888).also {
      val matrix = ColorMatrix().apply { setScale(.12f, .12f, .12f, 1f) }
      Canvas(it).drawBitmap(source, 0f, 0f, Paint().apply { colorFilter = ColorMatrixColorFilter(matrix) })
    }
    val coarse = Bitmap.createScaledBitmap(source, 24, 30, true)
    val blur = Bitmap.createScaledBitmap(coarse, source.width, source.height, true).also { coarse.recycle() }
    val cropped = Bitmap.createBitmap(source, source.width / 2, 0, source.width / 2, source.height)
    val tiny = Bitmap.createBitmap(source.width * 2, source.height * 2, Bitmap.Config.ARGB_8888).also {
      it.eraseColor(Color.WHITE)
      Canvas(it).drawBitmap(source, null, Rect(source.width, source.height, source.width + source.width / 2, source.height + source.height / 2), null)
    }
    val cases = listOf("clear-one-person" to source, "two-people" to double, "no-face" to blank,
      "very-dark" to dark, "strong-blur" to blur, "cropped-face" to cropped, "small-distant-face" to tiny)
    val module = FaceEnrollmentModule(BridgeReactContext(context))
    val rows = JSONArray()
    try {
      for ((name, bitmap) in cases) {
        val result = inspect(module, encoded(bitmap))
        assertNull("Processing must not crash for $name", result.error)
        assertNotNull(result.value)
        val row = JSONObject(result.value!!.toHashMap()).put("case", name).put("elapsedMs", result.elapsedMs)
        rows.put(row)
        File(output, "$name.jpg").outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 95, it) }
      }
    } finally { module.invalidate(); cases.forEach { if (!it.second.isRecycled) it.second.recycle() } }
    File(output, "photo-results.json").writeText(rows.toString(2))
    instrumentation.sendStatus(0, Bundle().apply { putString("facePhotoAudit", rows.toString()) })
  }
}

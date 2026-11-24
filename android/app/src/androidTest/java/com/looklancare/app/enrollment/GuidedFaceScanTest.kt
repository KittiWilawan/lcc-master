package com.looklancare.app.enrollment

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import android.graphics.Rect
import android.os.SystemClock
import androidx.test.platform.app.InstrumentationRegistry
import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.uimanager.ThemedReactContext
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class GuidedFaceScanTest {
  private val instrumentation = InstrumentationRegistry.getInstrumentation()
  private val context = instrumentation.targetContext
  private fun portrait() = instrumentation.context.assets.open("face-portrait.jpg").use { BitmapFactory.decodeStream(it) }
  @Test fun nativePreviewReceivesTheHostLayoutSize() {
    instrumentation.runOnMainSync {
      val themed = ThemedReactContext(BridgeReactContext(context), context, "face-audit", -1)
      val view = FaceScanView(themed)
      try {
        // Fabric supplies the host frame from Yoga; native children must not depend on a prior measure pass.
        view.layout(0, 0, 480, 640)
        assertEquals(480, view.getChildAt(0).width)
        assertEquals(640, view.getChildAt(0).height)
      } finally { view.dispose() }
    }
  }
  @Test fun actualLandmarksAndQualityRejectDarkBlurAndMultipleFaces() {
    val config = FaceScanConfig.load(context)
    val rows = JSONArray()
    val source = portrait()
    val dark = Bitmap.createBitmap(source.width, source.height, Bitmap.Config.ARGB_8888)
    Canvas(dark).drawBitmap(source, 0f, 0f, Paint().apply { colorFilter = ColorMatrixColorFilter(ColorMatrix().apply { setScale(.12f, .12f, .12f, 1f) }) })
    val tiny = Bitmap.createScaledBitmap(source, 24, 30, true)
    val blur = Bitmap.createScaledBitmap(tiny, source.width, source.height, true); tiny.recycle()
    val multiple = Bitmap.createBitmap(source.width * 2, source.height, Bitmap.Config.ARGB_8888)
    Canvas(multiple).apply { drawBitmap(source, 0f, 0f, null); drawBitmap(source, source.width.toFloat(), 0f, null) }
    val empty = Bitmap.createBitmap(source.width, source.height, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.WHITE) }
    try {
      for ((name, bitmap) in listOf("clear" to source, "dark" to dark, "blur" to blur, "multiple" to multiple, "empty" to empty)) {
        FaceScanAnalyzer(context, config).use { analyzer ->
          val now = SystemClock.elapsedRealtime()
          val observed = analyzer.inspect(bitmap, now)
          assertFalse("Model must not recycle a caller's photo", bitmap.isRecycled)
          val quality = PhotoQuality.measure(bitmap, Rect(0, 0, bitmap.width, bitmap.height), config.quality.getInt("sampleSize"))
          rows.put(JSONObject().put("case", name).put("faces", observed.count).put("qualityIssue", observed.qualityIssue)
            .put("wholeImageBrightness", quality.brightness).put("wholeImageSharpness", quality.sharpness)
            .put("yaw", observed.yaw).put("pitch", observed.pitch).put("roll", observed.roll).put("blinkLeft", observed.blinkLeft).put("blinkRight", observed.blinkRight)
            .put("elapsedMs", SystemClock.elapsedRealtime() - now))
          when (name) {
            "clear" -> { assertEquals(1, observed.count); assertNull(observed.qualityIssue); assertTrue(observed.yaw.isFinite()) }
            "dark" -> assertTrue(observed.count == 0 || observed.qualityIssue == "dark")
            "blur" -> assertTrue(observed.count == 0 || observed.qualityIssue == "blur")
            "multiple" -> assertEquals(2, observed.count)
            "empty" -> assertEquals(0, observed.count)
          }
        }
      }
    } finally {
      val output = File(context.getExternalFilesDir(null), "guided-face-audit").apply { mkdirs() }
      File(output, "landmark-quality.json").writeText(rows.toString(2))
      for (bitmap in listOf(source, dark, blur, multiple, empty)) bitmap.recycle()
    }
  }
  @Test fun blankFullBodyPhotoFailsQualityCheck() {
    val config = FaceScanConfig.load(context)
    val blank = Bitmap.createBitmap(640, 640, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.WHITE) }
    try { assertNotNull(PhotoQuality.measure(blank, Rect(0, 0, 640, 640), config.quality.getInt("sampleSize")).rejection(config.quality)) }
    finally { blank.recycle() }
  }
}

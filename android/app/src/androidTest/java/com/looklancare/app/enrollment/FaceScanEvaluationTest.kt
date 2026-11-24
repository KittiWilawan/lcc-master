package com.looklancare.app.enrollment

import android.graphics.BitmapFactory
import android.os.SystemClock
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import android.graphics.Bitmap

/** Real model evaluation on a separately pushed, labelled fixture set. No account or upload. */
class FaceScanEvaluationTest {
  private val instrumentation = InstrumentationRegistry.getInstrumentation()
  private val context = instrumentation.targetContext

  @Test fun evaluateLabelledFramesAndFrozenPhotoSequences() {
    require(context.packageName.endsWith(".faceaudit.release"))
    val root = File(context.getExternalFilesDir(null), "face-scan-evaluation")
    val manifest = JSONObject(File(root, "manifest.json").readText())
    val cases = manifest.getJSONArray("cases")
    val config = FaceScanConfig.load(context)
    val frameCount = manifest.getInt("framesPerCase")
    require(frameCount > 10)
    val rows = JSONArray()
    try {
      for (i in 0 until cases.length()) {
        val input = cases.getJSONObject(i)
        val bitmap = BitmapFactory.decodeFile(File(root, input.getString("file")).absolutePath)
        assertNotNull("Fixture must decode", bitmap)
        val session = config.session("all")
        val frames = JSONArray()
        val captures = JSONArray()
        val startup = SystemClock.elapsedRealtime()
        try {
          FaceScanAnalyzer(context, config).use { analyzer ->
            val initializedMs = SystemClock.elapsedRealtime() - startup
            for (frame in 0 until frameCount) {
              val now = (frame + 1) * config.camera.getLong("intervalMs")
              val start = SystemClock.elapsedRealtimeNanos()
              val observation = analyzer.inspect(bitmap, now)
              val decision = session.next(observation, now)
              val elapsedMs = (SystemClock.elapsedRealtimeNanos() - start) / 1_000_000.0
              assertFalse("Caller retains bitmap ownership", bitmap.isRecycled)
              decision.capture?.let { captures.put(it) }
              val features = JSONArray()
              for (detail in analyzer.featureDetails) features.put(JSONObject().put("region",detail.region)
                .put("brightnessRatio",detail.brightnessRatio).put("sharpness",detail.sharpness))
              frames.put(JSONObject().put("frame",frame).put("faces",observation.count)
                .put("quality",observation.qualityIssue ?: JSONObject.NULL)
                .put("left",observation.left).put("top",observation.top).put("width",observation.width).put("height",observation.height)
                .put("yaw",observation.yaw).put("pitch",observation.pitch).put("roll",observation.roll)
                .put("blinkLeft",observation.blinkLeft).put("blinkRight",observation.blinkRight)
                .put("hint",decision.hint).put("reset",decision.reset).put("elapsedMs",elapsedMs).put("features",features))
            }
            rows.put(JSONObject().put("name",input.getString("name")).put("expected",input.getString("expected"))
              .put("initializationMs",initializedMs).put("frames",frames).put("captures",captures).put("complete",session.complete))
          }
        } finally { bitmap.recycle() }
      }
    } finally {
      File(root,"results.json").writeText(JSONObject().put("cases",rows).put("config",config.values).toString(2))
    }
    assertEquals(cases.length(),rows.length())
  }

  @Test fun documentSamePositionPersonReplacementBoundary() {
    val config = FaceScanConfig.load(context)
    val session = config.session("all")
    val face = FaceObservation(1,.3,.2,.4,.48)
    val captures = mutableListOf<String>()
    var now = 0L
    fun feed(value: FaceObservation, durationMs: Long) {
      repeat((durationMs / config.camera.getLong("intervalMs")).toInt()) {
        now += config.camera.getLong("intervalMs")
        session.next(value, now).capture?.let { captures.add(it) }
      }
    }
    feed(face,config.rules.stableMs + 200)
    feed(face.copy(blinkLeft=1.0,blinkRight=1.0),200)
    feed(face,config.rules.stableMs + 200)
    // Without biometric evidence the production session must now refuse all captures.
    feed(face.copy(yaw=config.poses[1].minYaw + 1),config.rules.stableMs + 200)
    feed(face.copy(yaw=config.poses[2].minYaw + 1),config.rules.stableMs + 200)
    val result = JSONObject().put("synthetic",true).put("complete",session.complete)
      .put("captures",JSONArray(captures)).put("missingEvidenceBlocked",true)
    val root = File(context.getExternalFilesDir(null),"face-scan-evaluation").apply { mkdirs() }
    File(root,"identity-boundary.json").writeText(result.toString(2))
    assertFalse(session.complete)
    assertTrue(captures.isEmpty())
  }

  @Test fun referenceCropKeepsTheCallerImageAndExportsOnlyTheTarget() {
    val root=File(context.getExternalFilesDir(null),"face-scan-evaluation")
    val bitmap=BitmapFactory.decodeFile(File(root,"aligned-clear.jpg").absolutePath)
    val config=FaceScanConfig.load(context)
    assertNotNull(bitmap)
    try {
      FaceScanAnalyzer(context,config).use { analyzer ->
        val face=analyzer.inspect(bitmap,config.camera.getLong("intervalMs"))
        assertEquals(1,face.count); assertNull(face.qualityIssue)
        val crop=FaceReferenceCrop.crop(bitmap,face,config.capture.getDouble("facePadding"))
        try {
          assertTrue(crop.width < bitmap.width); assertTrue(crop.height < bitmap.height)
          assertFalse(bitmap.isRecycled)
          File(root,"reference-crop-sample.jpg").outputStream().use {
            assertTrue(crop.compress(Bitmap.CompressFormat.JPEG,config.camera.getInt("jpegQuality"),it))
          }
        } finally { if (crop !== bitmap) crop.recycle() }
        assertFalse(bitmap.isRecycled)
      }
    } finally { bitmap.recycle() }
  }
}

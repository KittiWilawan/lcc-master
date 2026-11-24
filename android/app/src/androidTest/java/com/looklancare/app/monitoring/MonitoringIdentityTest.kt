package com.looklancare.app.monitoring

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import androidx.test.platform.app.InstrumentationRegistry
import com.looklancare.app.enrollment.FaceVectors
import org.junit.Assert.*
import org.junit.Test
import org.json.JSONObject

/** Pipeline controls on public fixtures, not an accuracy evaluation of real people. */
class MonitoringIdentityTest {
  private val instrumentation = InstrumentationRegistry.getInstrumentation()
  private val context = instrumentation.targetContext
  private fun portrait(): Bitmap = instrumentation.context.assets.open("face-portrait.jpg").use { BitmapFactory.decodeStream(it) }
  @Test fun shippedModelsProduceFiniteIdentityAndPreserveBitmapOwnership() {
    val bitmap = portrait()
    try { MonitoringIdentityAnalyzer(context).use { analyzer ->
      val first = analyzer.reference(bitmap); val second = analyzer.reference(bitmap)
      assertFalse(bitmap.isRecycled); assertTrue(first.isNotEmpty()); assertTrue(first.all { it.isFinite() })
      assertTrue(checkNotNull(FaceVectors.cosine(first, second)) > analyzer.rules.threshold)
      val profile = IdentityTemplate("synthetic-person", "ผู้ทดสอบ", listOf(first, first.copyOf()))
      assertEquals("synthetic-person", IdentityMatcher.match(second, listOf(profile), analyzer.rules)?.memberId)
      first.fill(0.0); second.fill(0.0)
    } } finally { bitmap.recycle() }
  }
  @Test fun blankAndMultipleFaceReferencesCannotBecomeATemplate() {
    val portrait = portrait()
    val blank = Bitmap.createBitmap(portrait.width, portrait.height, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.WHITE) }
    val multiple = Bitmap.createBitmap(portrait.width * 2, portrait.height, Bitmap.Config.ARGB_8888)
    Canvas(multiple).apply { drawBitmap(portrait, 0f, 0f, null); drawBitmap(portrait, portrait.width.toFloat(), 0f, null) }
    try { MonitoringIdentityAnalyzer(context).use { analyzer ->
      assertThrows(IllegalArgumentException::class.java) { analyzer.reference(blank) }
      assertThrows(IllegalArgumentException::class.java) { analyzer.reference(multiple) }
    } } finally { portrait.recycle(); blank.recycle(); multiple.recycle() }
  }
  @Test fun privateGalleryIsEncryptedAndClearsWithoutBackup() {
    val store = IdentityGalleryStore(context)
    val value = JSONObject().put("userId", "synthetic-user").put("familyId", "synthetic-family").put("members", org.json.JSONArray())
    try {
      store.write(value)
      assertEquals("synthetic-family", store.read()?.getString("familyId"))
      val raw = java.io.File(context.noBackupFilesDir, "monitor-identity.json").readText()
      assertFalse(raw.contains("synthetic-user")); assertFalse(raw.contains("synthetic-family"))
      store.clear(); assertNull(store.read())
    } finally { store.clear() }
  }
  @Test fun repeatedCameraImageCannotConfirmAFallAndBecomesStalled() {
    val bitmap = portrait(); val config = MonitoringConfig.load(context)
    try { LocalPoseAnalyzer(context, config).use { analyzer ->
      analyzer.analyze("synthetic-camera", bitmap, 100)
      val repeated = analyzer.analyze("synthetic-camera", bitmap, 400)
      assertFalse(repeated.getBoolean("fallDetected")); assertFalse(repeated.getJSONObject("diagnostics").getBoolean("distinctFrame"))
      val stalled = analyzer.analyze("synthetic-camera", bitmap, 2200)
      assertTrue(stalled.getBoolean("frameStalled")); assertEquals("uncertain", stalled.getString("status")); assertFalse(stalled.getBoolean("fallDetected"))
    } } finally { bitmap.recycle() }
  }
  @Test fun enrolledFaceIsBoundToBodyTrackAndCannotCrossFamily() {
    val image = portrait(); val config = MonitoringConfig.load(context); val store = IdentityGalleryStore(context)
    try {
      val vector = MonitoringIdentityAnalyzer(context).use { it.reference(image) }
      val profile = JSONObject().put("id", "target-a").put("name", "ผู้ทดสอบ A")
        .put("vectors", org.json.JSONArray(listOf(org.json.JSONArray(vector.toList()), org.json.JSONArray(vector.toList()))))
      store.write(JSONObject().put("userId", "synthetic-user").put("familyId", "synthetic-family")
        .put("revision", "synthetic-v1").put("expiresAt", System.currentTimeMillis() + 300000)
        .put("members", org.json.JSONArray(listOf(profile))))
      vector.fill(0.0)
      val camera = JSONObject().put("userId", "synthetic-user").put("familyId", "synthetic-family").put("targetMemberId", "target-a")
      LocalPoseAnalyzer(context, config).use { analyzer ->
        var result = JSONObject()
        for (i in 0 until 3) {
          val frame = image.copy(Bitmap.Config.ARGB_8888, true)
          Canvas(frame).drawRect(0f, 0f, frame.width.toFloat(), frame.height / 24f,
            android.graphics.Paint().apply { color = if (i % 2 == 0) Color.WHITE else Color.BLACK })
          try { result = analyzer.analyze("identity-camera", frame, 100L + i * 300, camera) } finally { frame.recycle() }
        }
        val boxes = result.getJSONArray("detections")
        assertTrue("Public portrait control must contain a body track", boxes.length() > 0)
        assertTrue("Face evidence must attach to its body track", (0 until boxes.length()).any { boxes.getJSONObject(it).optString("memberId") == "target-a" })
        val foreign = JSONObject(camera.toString()).put("familyId", "different-family")
        val other = analyzer.analyze("identity-camera", image, 1100, foreign).getJSONArray("detections")
        assertEquals("A foreign gallery must not expose a box in selected-people mode", 0, other.length())
        assertTrue((0 until other.length()).all { other.getJSONObject(it).isNull("memberId") })
      }
    } finally { store.clear(); image.recycle() }
  }
}

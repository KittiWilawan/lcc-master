package com.looklancare.app.enrollment

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test

/** Runs the shipped model on real Android, without accessing accounts or uploading photos. */
class FacePhotoInspectorTest {
  private val instrumentation = InstrumentationRegistry.getInstrumentation()
  private val context = instrumentation.targetContext
  private fun portrait(): Bitmap = instrumentation.context.assets.open("face-portrait.jpg").use { BitmapFactory.decodeStream(it) }

  @Test fun emptyPhotoHasNoFace() {
    val bitmap = Bitmap.createBitmap(640, 640, Bitmap.Config.ARGB_8888)
    bitmap.eraseColor(Color.WHITE)
    try { FacePhotoInspector(context).use { assertEquals(0, it.inspect(bitmap).size) } }
    finally { bitmap.recycle() }
  }
  @Test fun portraitContainsOneFaceWithNormalizedBox() {
    val bitmap = portrait()
    try { FacePhotoInspector(context).use {
      val faces = it.inspect(bitmap)
      assertFalse("Caller still owns the photo", bitmap.isRecycled)
      assertEquals(1, faces.size)
      val face = faces.single()
      assertTrue(face.confidence >= it.config.getDouble("minDetectionConfidence"))
      assertTrue(face.left >= 0 && face.top >= 0 && face.left + face.width <= 1 && face.top + face.height <= 1)
    } } finally { if (!bitmap.isRecycled) bitmap.recycle() }
  }
  @Test fun twoPeopleAreNotMergedIntoOneFace() {
    val portrait = portrait()
    val bitmap = Bitmap.createBitmap(portrait.width * 2, portrait.height, Bitmap.Config.ARGB_8888)
    Canvas(bitmap).apply { drawBitmap(portrait, 0f, 0f, null); drawBitmap(portrait, portrait.width.toFloat(), 0f, null) }
    try { FacePhotoInspector(context).use { assertEquals(2, it.inspect(bitmap).size) } }
    finally { if (!bitmap.isRecycled) bitmap.recycle(); portrait.recycle() }
  }
}

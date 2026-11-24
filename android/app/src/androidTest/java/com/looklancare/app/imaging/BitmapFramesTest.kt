package com.looklancare.app.imaging

import android.graphics.Bitmap
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayOutputStream

/** Platform codec checks: run on an isolated Android test device. */
class BitmapFramesTest {
  private fun jpeg(width: Int, height: Int): ByteArray {
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    return try {
      bitmap.eraseColor(0xff556677.toInt())
      ByteArrayOutputStream().use { output ->
        check(bitmap.compress(Bitmap.CompressFormat.JPEG, 90, output))
        output.toByteArray()
      }
    } finally { bitmap.recycle() }
  }

  @Test fun snapshotIsDecodedAtTheConfiguredResolution() {
    val bitmap = BitmapFrames.decode(jpeg(1920, 1080), 640)
    try { assertEquals(640, bitmap.width); assertEquals(360, bitmap.height); assertFalse(bitmap.isRecycled) }
    finally { bitmap.recycle() }
  }

  @Test fun enrollmentReferenceDoesNotLoseAnExtraSamplingStep() {
    val bitmap = BitmapFrames.decode(jpeg(1280, 720), 960)
    try { assertEquals(960, bitmap.width); assertEquals(540, bitmap.height) }
    finally { bitmap.recycle() }
  }

  @Test fun smallPhotosKeepTheOriginalPixels() {
    val bitmap = BitmapFrames.decode(jpeg(320, 240), 960)
    try { assertEquals(320, bitmap.width); assertEquals(240, bitmap.height) }
    finally { bitmap.recycle() }
  }

  @Test fun malformedPhotoIsRejected() {
    assertThrows(IllegalArgumentException::class.java) { BitmapFrames.decode(byteArrayOf(1, 2, 3), 640) }
  }
}

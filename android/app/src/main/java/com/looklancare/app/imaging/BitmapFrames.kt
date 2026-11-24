package com.looklancare.app.imaging

import android.graphics.Bitmap
import android.graphics.BitmapFactory

/** Android decoding adapter shared by enrollment, reference installation and camera snapshots. */
object BitmapFrames {
  fun decode(bytes: ByteArray, maximum: Int): Bitmap {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    val options = BitmapFactory.Options().apply {
      inPreferredConfig = Bitmap.Config.ARGB_8888
      inSampleSize = FrameSizing.decodeSample(bounds.outWidth, bounds.outHeight, maximum)
    }
    val decoded = requireNotNull(BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)) { "Invalid image" }
    val (width, height) = FrameSizing.fit(decoded.width, decoded.height, maximum)
    if (width == decoded.width && height == decoded.height) return decoded
    return try { Bitmap.createScaledBitmap(decoded, width, height, true) }
    finally { decoded.recycle() }
  }
}

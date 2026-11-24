package com.looklancare.app.enrollment

import android.graphics.Bitmap
import java.security.MessageDigest
import kotlin.math.min

/** Ephemeral sampled content; no face template or image hash is exposed to the bridge/logs. */
object FrameSignature {
  fun measure(bitmap: Bitmap, samples: Int): ByteArray {
    require(samples >= 2)
    val countX = min(samples, bitmap.width); val countY = min(samples, bitmap.height)
    val row = IntArray(bitmap.width)
    val bytes = ByteArray(countX * countY * 3)
    var offset = 0
    for (y in 0 until countY) {
      bitmap.getPixels(row, 0, bitmap.width, 0, y * (bitmap.height - 1) / (countY - 1).coerceAtLeast(1), bitmap.width, 1)
      for (x in 0 until countX) {
        val pixel = row[x * (bitmap.width - 1) / (countX - 1).coerceAtLeast(1)]
        bytes[offset++] = (pixel shr 16).toByte(); bytes[offset++] = (pixel shr 8).toByte(); bytes[offset++] = pixel.toByte()
      }
    }
    return try { MessageDigest.getInstance("SHA-256").digest(bytes) } finally { row.fill(0); bytes.fill(0) }
  }
}

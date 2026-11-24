package com.looklancare.app.enrollment

import android.graphics.Bitmap
import android.graphics.Rect
import org.json.JSONObject

/** Measures illumination and focus over the face crop, not the surrounding room. */
data class PhotoQuality(val brightness: Double, val sharpness: Double) {
  fun rejection(config: JSONObject): String? = when {
    brightness < config.getDouble("minBrightness") -> "dark"
    brightness > config.getDouble("maxBrightness") -> "bright"
    sharpness < config.getDouble("minSharpness") -> "blur"
    else -> null
  }
  companion object {
    fun measure(bitmap: Bitmap, region: Rect, size: Int): PhotoQuality {
      require(size >= 3 && region.width() > 0 && region.height() > 0)
      val crop = Bitmap.createBitmap(bitmap, region.left, region.top, region.width(), region.height())
      val sample = Bitmap.createScaledBitmap(crop, size, size, true)
      try {
        val pixels = IntArray(size * size)
        sample.getPixels(pixels, 0, size, 0, 0, size, size)
        val luma = DoubleArray(pixels.size) { i ->
          val value = pixels[i]
          // ITU-R BT.601 luma coefficients are algorithm constants.
          0.299 * ((value shr 16) and 255) + 0.587 * ((value shr 8) and 255) + 0.114 * (value and 255)
        }
        var sum = 0.0; var squared = 0.0; var count = 0
        for (y in 1 until size - 1) for (x in 1 until size - 1) {
          val i = y * size + x
          val laplacian = luma[i - 1] + luma[i + 1] + luma[i - size] + luma[i + size] - 4 * luma[i]
          sum += laplacian; squared += laplacian * laplacian; count++
        }
        return PhotoQuality(luma.average(), squared / count - (sum / count) * (sum / count))
      } finally {
        if (sample !== crop && sample !== bitmap) sample.recycle()
        if (crop !== bitmap) crop.recycle()
      }
    }
  }
}

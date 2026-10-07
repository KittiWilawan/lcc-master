package com.looklancare.app.monitoring

import android.graphics.Bitmap

/** A small shirt-colour descriptor helps continuity; it never verifies a person's identity. */
class PoseAppearanceExtractor(private val jointIndices: List<Int>, private val minVisibleJoints: Int,
                              private val visibility: Float, private val bins: Int, private val samples: Int) {
  init { require(jointIndices.isNotEmpty() && minVisibleJoints > 0 && bins > 1 && samples > 1) }

  fun extract(bitmap: Bitmap, observation: PoseObservation): FloatArray? {
    val joints = jointIndices.map { observation.points[it] }.filter { it.visibility >= visibility }
    if (joints.size < minVisibleJoints) return null
    val left = joints.minOf { it.x }.coerceIn(0f, 1f)
    val right = joints.maxOf { it.x }.coerceIn(0f, 1f)
    val top = joints.minOf { it.y }.coerceIn(0f, 1f)
    val bottom = joints.maxOf { it.y }.coerceIn(0f, 1f)
    if (right <= left || bottom <= top) return null
    val histogram = FloatArray(bins * 3)
    for (row in 0 until samples) for (column in 0 until samples) {
      val x = ((left + (right - left) * (column + 0.5f) / samples) * bitmap.width).toInt().coerceIn(0, bitmap.width - 1)
      val y = ((top + (bottom - top) * (row + 0.5f) / samples) * bitmap.height).toInt().coerceIn(0, bitmap.height - 1)
      val colour = bitmap.getPixel(x, y)
      val channels = intArrayOf((colour ushr 16) and 255, (colour ushr 8) and 255, colour and 255)
      val intensity = channels.sum().coerceAtLeast(1)
      channels.forEachIndexed { channel, value ->
        val bin = (value.toFloat() / intensity * bins).toInt().coerceIn(0, bins - 1)
        histogram[channel * bins + bin]++
      }
    }
    val total = histogram.sum()
    return FloatArray(histogram.size) { histogram[it] / total }
  }
}

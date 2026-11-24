package com.looklancare.app.imaging

/** Decode near the analysis resolution without first throwing away pixels it needs. */
object FrameSizing {
  fun decodeSample(width: Int, height: Int, maximum: Int): Int {
    require(width > 0 && height > 0 && maximum > 0)
    val dimension = maxOf(width, height).toLong()
    var sample = 1
    while (dimension / (sample.toLong() * 2) >= maximum) sample *= 2
    return sample
  }

  fun fit(width: Int, height: Int, maximum: Int): Pair<Int, Int> {
    require(width > 0 && height > 0 && maximum > 0)
    val ratio = minOf(1.0, maximum.toDouble() / maxOf(width, height))
    return (width * ratio).toInt().coerceAtLeast(1) to (height * ratio).toInt().coerceAtLeast(1)
  }

  fun fitVideo(width: Int, height: Int, pixelRatio: Float, maximum: Int): Pair<Int, Int> {
    require(width > 0 && height > 0 && maximum > 0)
    val aspect = if (pixelRatio.isFinite() && pixelRatio > 0f) pixelRatio.toDouble() else 1.0
    // Correct non-square pixels by reducing one axis, preserving the source pixel limit.
    val squareWidth = (width * minOf(1.0, aspect)).toInt().coerceAtLeast(1)
    val squareHeight = (height / maxOf(1.0, aspect)).toInt().coerceAtLeast(1)
    return fit(squareWidth, squareHeight, maximum)
  }
}

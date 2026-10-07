package com.looklancare.app.monitoring

import kotlin.math.hypot

data class PoseObservation(val points: List<PosePoint>, val bounds: PoseBounds) {
  val quality get() = points.map { it.visibility.toDouble() }.average()

  companion object {
    fun create(points: List<PosePoint>, landmarkCount: Int, visibility: Float): PoseObservation? {
      if (points.size != landmarkCount || points.any { !it.x.isFinite() || !it.y.isFinite() || !it.z.isFinite() || !it.visibility.isFinite() }) return null
      val selected = points.filter { it.visibility >= visibility }.ifEmpty { points }
      val bounds = PoseBounds(selected.minOf { it.x }.coerceIn(0f, 1f), selected.minOf { it.y }.coerceIn(0f, 1f),
        selected.maxOf { it.x }.coerceIn(0f, 1f), selected.maxOf { it.y }.coerceIn(0f, 1f))
      return if (bounds.area > 0f) PoseObservation(points, bounds) else null
    }
  }
}

data class PoseDuplicatePolicy(val minOverlap: Float, val maxLandmarkDistance: Float,
                               val minSharedLandmarks: Int, val visibility: Float) {
  init {
    require(minOverlap in 0f..1f && maxLandmarkDistance > 0f && maxLandmarkDistance.isFinite())
    require(minSharedLandmarks > 0 && visibility in 0f..1f)
  }
}

/** Overlap alone cannot remove a person: corresponding visible joints must also coincide. */
class PoseObservationReducer(private val policy: PoseDuplicatePolicy) {
  fun reduce(observations: List<PoseObservation>): List<PoseObservation> {
    val selected = mutableListOf<PoseObservation>()
    observations.sortedByDescending { it.quality }.forEach { candidate ->
      if (selected.none { duplicate(it, candidate) }) selected.add(candidate)
    }
    return selected
  }

  private fun duplicate(first: PoseObservation, second: PoseObservation): Boolean {
    if (first.bounds.overlap(second.bounds) < policy.minOverlap || first.points.size != second.points.size) return false
    val pairs = first.points.zip(second.points).filter { (a, b) -> a.visibility >= policy.visibility && b.visibility >= policy.visibility }
    if (pairs.size < policy.minSharedLandmarks) return false
    val scale = maxOf(first.bounds.diagonal, second.bounds.diagonal)
    val distance = pairs.map { (a, b) -> hypot(a.x - b.x, a.y - b.y).toDouble() }.average() / scale
    return distance <= policy.maxLandmarkDistance
  }
}

data class PoseCrop(val left: Int, val top: Int, val width: Int, val height: Int) {
  init { require(left >= 0 && top >= 0 && width > 0 && height > 0) }

  /** Restore image coordinates and the MediaPipe z scale (expressed in input-image widths). */
  fun restore(points: List<PosePoint>, frameWidth: Int, frameHeight: Int, rotation: Int): List<PosePoint> {
    require(frameWidth > 0 && frameHeight > 0 && left + width <= frameWidth && top + height <= frameHeight)
    require(rotation in listOf(0, 90, -90))
    val inputWidth = if (rotation == 0) width else height
    return points.map { point ->
      val x = when (rotation) { 90 -> point.y; -90 -> 1f - point.y; else -> point.x }
      val y = when (rotation) { 90 -> 1f - point.x; -90 -> point.x; else -> point.y }
      PosePoint((left + x * width) / frameWidth, (top + y * height) / frameHeight,
        point.z * inputWidth / frameWidth, point.visibility)
    }
  }

  companion object {
    fun around(bounds: PoseBounds, frameWidth: Int, frameHeight: Int, margin: Float, minPixels: Int): PoseCrop? {
      require(margin.isFinite() && margin >= 1f && minPixels > 0)
      val halfWidth = (bounds.right - bounds.left) * margin / 2
      val halfHeight = (bounds.bottom - bounds.top) * margin / 2
      val left = ((bounds.x - halfWidth) * frameWidth).toInt().coerceIn(0, frameWidth)
      val top = ((bounds.y - halfHeight) * frameHeight).toInt().coerceIn(0, frameHeight)
      val right = kotlin.math.ceil(((bounds.x + halfWidth) * frameWidth).toDouble()).toInt().coerceIn(0, frameWidth)
      val bottom = kotlin.math.ceil(((bounds.y + halfHeight) * frameHeight).toDouble()).toInt().coerceIn(0, frameHeight)
      return if (right - left >= minPixels && bottom - top >= minPixels) PoseCrop(left, top, right - left, bottom - top) else null
    }
  }
}

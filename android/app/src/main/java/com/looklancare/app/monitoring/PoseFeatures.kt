package com.looklancare.app.monitoring

import kotlin.math.sqrt

data class PosePoint(val x: Float, val y: Float, val z: Float, val visibility: Float)

class PoseFeatures(
  private val landmarkCount: Int,
  private val visibilityThreshold: Float,
  private val minScale: Float,
  private val variant: String,
) {
  val frameSize = landmarkCount * 4 + 6

  fun normalize(points: List<PosePoint>): FloatArray {
    require(points.size == landmarkCount)
    require(points.all { it.x.isFinite() && it.y.isFinite() && it.z.isFinite() && it.visibility.isFinite() })
    val visible = points.filter { it.visibility >= visibilityThreshold }.ifEmpty { points }
    val center = floatArrayOf(visible.map { it.x }.average().toFloat(), visible.map { it.y }.average().toFloat(), visible.map { it.z }.average().toFloat())
    val width = visible.maxOf { it.x } - visible.minOf { it.x }
    val height = visible.maxOf { it.y } - visible.minOf { it.y }
    val scale = maxOf(width, height, minScale)
    val result = FloatArray(frameSize)
    points.forEachIndexed { index, point ->
      result[index * 3] = (point.x - center[0]) / scale
      result[index * 3 + 1] = (point.y - center[1]) / scale
      result[index * 3 + 2] = (point.z - center[2]) / scale
      result[landmarkCount * 3 + index] = point.visibility
    }
    val offset = landmarkCount * 4
    result[offset] = center[0]
    result[offset + 1] = center[1]
    result[offset + 2] = width
    result[offset + 3] = height
    result[offset + 4] = points.count { it.visibility >= visibilityThreshold }.toFloat() / landmarkCount
    result[offset + 5] = 1f
    return result
  }

  fun sequence(frames: List<FloatArray>): FloatArray {
    require(frames.isNotEmpty() && frames.all { it.size == frameSize })
    val invariant = variant == "invariant" || variant == "invariant_temporal"
    val temporal = variant == "temporal" || variant == "invariant_temporal"
    require(variant in listOf("base", "temporal", "invariant", "invariant_temporal"))
    val count = if (invariant) landmarkCount * 4 else frameSize
    val base = frames.flatMap { it.take(count) }
    if (!temporal) return base.toFloatArray()
    val deltas = frames.zipWithNext().flatMap { (first, second) -> List(count) { second[it] - first[it] } }
    val mean = FloatArray(count) { feature -> frames.map { it[feature].toDouble() }.average().toFloat() }
    val std = FloatArray(count) { feature ->
      sqrt(frames.map { (it[feature] - mean[feature]).toDouble().let { value -> value * value } }.average()).toFloat()
    }
    val min = FloatArray(count) { feature -> frames.minOf { it[feature] } }
    val max = FloatArray(count) { feature -> frames.maxOf { it[feature] } }
    return (base + deltas + mean.toList() + std.toList() + min.toList() + max.toList()).toFloatArray()
  }
}

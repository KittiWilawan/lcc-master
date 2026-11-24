package com.looklancare.app.enrollment

import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

data class FaceSceneRules(val tileFraction: Double, val tileOverlap: Double, val mergeIou: Double,
  val mergeCenterRatio: Double, val mergeScaleRatio: Double, val stopAfterFaces: Int, val verificationScale: Double)

data class FaceRegion(val left: Double, val top: Double, val width: Double, val height: Double) {
  private val area: Double get() = width * height
  fun expanded(scale: Double): FaceRegion {
    require(scale >= 1 && scale.isFinite())
    val x = left + width / 2; val y = top + height / 2
    val startX = (x - width * scale / 2).coerceIn(0.0, 1.0)
    val startY = (y - height * scale / 2).coerceIn(0.0, 1.0)
    val endX = (x + width * scale / 2).coerceIn(0.0, 1.0)
    val endY = (y + height * scale / 2).coerceIn(0.0, 1.0)
    return FaceRegion(startX, startY, max(0.0, endX - startX), max(0.0, endY - startY))
  }
  fun sameFace(other: FaceRegion, rules: FaceSceneRules): Boolean {
    val overlap = max(0.0, min(left + width, other.left + other.width) - max(left, other.left)) *
      max(0.0, min(top + height, other.top + other.height) - max(top, other.top))
    val union = area + other.area - overlap
    if (union <= 0) return false
    val scale = min(width, other.width) / max(width, other.width)
    if (scale < rules.mergeScaleRatio) return false
    val distance = hypot(left + width / 2 - other.left - other.width / 2, top + height / 2 - other.top - other.height / 2)
    return overlap / union >= rules.mergeIou || distance <= min(width, other.width) * rules.mergeCenterRatio
  }
}

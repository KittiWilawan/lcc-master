package com.looklancare.app.enrollment

import android.graphics.Bitmap
import android.graphics.Rect
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max

data class FeatureAssessment(val issue: String?, val details: List<FeatureDetail>)

/** Pixel evidence corroborates inferred landmarks. This is a photo quality guard, not anti-spoofing. */
class FaceFeatureQuality(private val config: JSONObject) {
  private fun region(points: List<ImagePoint>, indices: JSONArray, bitmap: Bitmap, faceHeight: Double): Rect? {
    val selected = (0 until indices.length()).map { indices.getInt(it) }.map { points.getOrNull(it) ?: return null }
    if (selected.isEmpty() || selected.any { !it.x.isFinite() || !it.y.isFinite() }) return null
    val left = selected.minOf { it.x }; val right = selected.maxOf { it.x }
    val top = selected.minOf { it.y }; val bottom = selected.maxOf { it.y }
    val paddingX = (right - left) * config.getDouble("paddingX")
    val height = max(bottom - top, faceHeight * config.getDouble("minHeightToFace"))
    val paddingY = height * config.getDouble("paddingY")
    return Rect(floor((left - paddingX) * bitmap.width).toInt().coerceIn(0, bitmap.width),
      floor((top - paddingY) * bitmap.height).toInt().coerceIn(0, bitmap.height),
      ceil((right + paddingX) * bitmap.width).toInt().coerceIn(0, bitmap.width),
      ceil((bottom + paddingY) * bitmap.height).toInt().coerceIn(0, bitmap.height))
      .takeIf { it.width() > 0 && it.height() > 0 }
  }
  fun assess(bitmap: Bitmap, points: List<ImagePoint>, faceHeight: Double, frontFacing: Boolean): FeatureAssessment {
    val sampleSize = config.getInt("sampleSize")
    val reference = region(points, config.getJSONArray("reference"), bitmap, faceHeight)
      ?: return FeatureAssessment("blur", emptyList())
    val referenceBrightness = PhotoQuality.measure(bitmap, reference, sampleSize).brightness
    if (referenceBrightness <= 0) return FeatureAssessment("dark", emptyList())
    val details = mutableListOf<FeatureDetail>()
    var hardIssue: String? = null
    var softIssue: String? = null
    for ((group, hint, threshold) in listOf(
      Triple("eyes", "eyes", config.getDouble("minEyeBrightnessRatio")),
      Triple("lowerFace", "lower", config.getDouble("minLowerBrightnessRatio")))) {
      val areas = config.getJSONArray(group)
      val groupDetails = mutableListOf<FeatureDetail>()
      for (index in 0 until areas.length()) {
        val box = region(points, areas.getJSONArray(index), bitmap, faceHeight)
          ?: return FeatureAssessment("features_missing", details)
        val quality = PhotoQuality.measure(bitmap, box, sampleSize)
        val ratio = quality.brightness / referenceBrightness
        groupDetails.add(FeatureDetail("$group:$index", ratio, quality.sharpness))
      }
      val required = if (group == "eyes") config.getInt(if (frontFacing) "minVisibleEyesFront" else "minVisibleEyesSide") else areas.length()
      details.addAll(groupDetails)
      when (FeatureVisibility.assess(groupDetails, threshold, config.getDouble("minSharpness"), required)) {
        FeatureVisibilityIssue.MISSING -> hardIssue = hardIssue ?: "features_missing"
        FeatureVisibilityIssue.DARK -> hardIssue = hardIssue ?: "${hint}_dark"
        FeatureVisibilityIssue.BLUR -> softIssue = softIssue ?: "${hint}_blur"
        null -> Unit
      }
    }
    return FeatureAssessment(hardIssue ?: softIssue, details)
  }
}

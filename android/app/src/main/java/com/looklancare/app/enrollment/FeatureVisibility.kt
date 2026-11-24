package com.looklancare.app.enrollment

data class FeatureDetail(val region: String, val brightnessRatio: Double, val sharpness: Double)
enum class FeatureVisibilityIssue { MISSING, DARK, BLUR }

/** Pixel quality cannot establish whether a physical object is covering the feature. */
object FeatureVisibility {
  fun assess(regions: List<FeatureDetail>, minRatio: Double, minSharpness: Double, required: Int): FeatureVisibilityIssue? {
    require(required > 0 && minRatio >= 0 && minSharpness >= 0)
    if (regions.size < required || regions.any { !it.brightnessRatio.isFinite() || !it.sharpness.isFinite() }) return FeatureVisibilityIssue.MISSING
    val lit = regions.filter { it.brightnessRatio >= minRatio }
    if (lit.size < required) return FeatureVisibilityIssue.DARK
    if (lit.count { it.sharpness >= minSharpness } < required) return FeatureVisibilityIssue.BLUR
    return null
  }
}

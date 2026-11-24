package com.looklancare.app.enrollment

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Rect
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarker
import kotlin.math.max
import kotlin.math.min

/** Model adapter. VIDEO runs synchronously on the camera's dedicated analysis executor. */
class FaceScanAnalyzer(context: Context, val config: FaceScanConfig) : AutoCloseable {
  private val scene = lazy { SceneFaceInspector(context, config.sceneRules) }
  private val featureQuality = FaceFeatureQuality(config.features)
  private val security = lazy { FaceSecurityModels(context, config.security) }
  private val freshness = FrameFreshness(config.freshness.getLong("maxUnchangedMs"))
  var featureDetails: List<FeatureDetail> = emptyList()
    private set
  private val model = FaceLandmarker.createFromOptions(context, FaceLandmarker.FaceLandmarkerOptions.builder()
    .setBaseOptions(BaseOptions.builder().setModelAssetPath(config.model.getString("asset")).build())
    .setRunningMode(RunningMode.VIDEO).setNumFaces(config.model.getInt("maxFaces"))
    .setMinFaceDetectionConfidence(config.model.getDouble("minDetection").toFloat())
    .setMinFacePresenceConfidence(config.model.getDouble("minPresence").toFloat())
    .setMinTrackingConfidence(config.model.getDouble("minTracking").toFloat())
    .setOutputFaceBlendshapes(true).setOutputFacialTransformationMatrixes(true).build())

  fun inspect(bitmap: Bitmap, timestamp: Long): FaceObservation {
    featureDetails = emptyList()
    val signature = FrameSignature.measure(bitmap, config.freshness.getInt("sampleSize"))
    val stalled = try { freshness.stalled(signature, timestamp) } finally { signature.fill(0) }
    if (stalled) return FaceObservation(0, qualityIssue = "camera_stalled")
    // MPImage.close recycles its bitmap; the caller still needs the original for quality and JPEG.
    val image = BitmapImageBuilder(bitmap.copy(Bitmap.Config.ARGB_8888, false)).build()
    val result = try { model.detectForVideo(image, timestamp) } finally { image.close() }
    val faces = result.faceLandmarks()
    val regions = faces.map { points ->
      val left = points.minOf { it.x().toDouble() }; val top = points.minOf { it.y().toDouble() }
      FaceRegion(left, top, points.maxOf { it.x().toDouble() }-left, points.maxOf { it.y().toDouble() }-top)
    }
    val distinct = FaceDuplicateReducer.indices(regions, faces.map { face -> face.map { ImagePoint(it.x().toDouble(),it.y().toDouble()) } }, config.duplicatePolicy)
    if (distinct.size != 1) return FaceObservation(distinct.size)
    val faceIndex = distinct.single()
    val face = faces[faceIndex]
    val left = face.minOf { it.x().toDouble() }; val top = face.minOf { it.y().toDouble() }
    val right = face.maxOf { it.x().toDouble() }; val bottom = face.maxOf { it.y().toDouble() }
    val region = Rect(max(0, (left * bitmap.width).toInt()), max(0, (top * bitmap.height).toInt()),
      min(bitmap.width, (right * bitmap.width).toInt()), min(bitmap.height, (bottom * bitmap.height).toInt()))
    if (region.width() <= 0 || region.height() <= 0) return FaceObservation(0)
    val quality = PhotoQuality.measure(bitmap, region, config.quality.getInt("sampleSize"))
    val transforms = result.facialTransformationMatrixes().orElse(emptyList())
    val blendshapes = result.faceBlendshapes().orElse(emptyList())
    if (transforms.size != faces.size || blendshapes.size != faces.size) return FaceObservation(0)
    val orientation = FaceOrientation.fromMatrix(transforms[faceIndex])
    val expressions = blendshapes[faceIndex].associate { it.categoryName() to it.score().toDouble() }
    val blinkLeft = expressions[config.landmarks.getString("blinkLeft")] ?: return FaceObservation(0)
    val blinkRight = expressions[config.landmarks.getString("blinkRight")] ?: return FaceObservation(0)
    val front = config.poses.first { it.key == "front" }
    val feature = featureQuality.assess(bitmap, face.map { ImagePoint(it.x().toDouble(), it.y().toDouble()) }, bottom - top,
      orientation.yaw in front.minYaw..front.maxYaw)
    featureDetails = feature.details
    val observation = FaceObservation(1, left, top, right - left, bottom - top, orientation.yaw, orientation.pitch, orientation.roll,
      blinkLeft, blinkRight, quality.rejection(config.quality) ?: feature.issue)
    // No tile processing is needed when the picture cannot become a valid reference anyway.
    // A requested blink can be measured while eyelid texture becomes soft. Domain decides whether
    // that closed-eye observation belongs to its pending action; it is never a reference-quality frame.
    val eyeMotionTexture = observation.qualityIssue == "eyes_blur" &&
      blinkLeft > config.rules.blinkOpen && blinkRight > config.rules.blinkOpen
    // Evaluate identity and passive evidence on partial closure too. Domain alone decides whether
    // this belongs to a pending, time-bounded blink; such frames never become stored references.
    val tracking = if (eyeMotionTexture) observation.copy(qualityIssue = null) else observation
    if (FaceAlignment.issue(tracking, config.rules) != null) return observation
    val sceneFaces = scene.value.inspect(bitmap, listOf(FaceRegion(left, top, right - left, bottom - top)))
    if (sceneFaces.size > 1) return FaceObservation(sceneFaces.size)
    return observation.copy(evidence = security.value.inspect(bitmap,
      face.map { ImagePoint(it.x().toDouble(), it.y().toDouble()) }, observation, orientation.yaw in front.minYaw..front.maxYaw))
  }
  override fun close() {
    freshness.clear()
    try { model.close() }
    finally { try { if (scene.isInitialized()) scene.value.close() } finally { if (security.isInitialized()) security.value.close() } }
  }
}

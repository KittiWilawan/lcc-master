package com.looklancare.app.monitoring

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Rect
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarker
import com.looklancare.app.enrollment.*
import org.json.JSONObject
import kotlin.math.abs

/** Recognition model adapter, single inference executor; never sends embeddings to JS/cloud. */
class MonitoringIdentityAnalyzer(context: Context) : AutoCloseable {
  val settings = JSONObject(context.assets.open("monitoring/identity.json").bufferedReader().use { it.readText() })
  private val scan = FaceScanConfig.load(context)
  private val security = FaceSecurityModels(context, scan.security)
  val rules = IdentityRules(settings.getDouble("similarityThreshold"), settings.getDouble("runnerUpMargin"),
    settings.getInt("confirmationFrames"), settings.getLong("confirmationMaxGapMs"), settings.getLong("retentionMs"), settings.getInt("minTemplateMatches"))
  private val detector = FaceLandmarker.createFromOptions(context, FaceLandmarker.FaceLandmarkerOptions.builder()
    .setBaseOptions(BaseOptions.builder().setModelAssetPath(scan.model.getString("asset")).build())
    .setRunningMode(RunningMode.IMAGE).setNumFaces(settings.getInt("maxFaces"))
    .setMinFaceDetectionConfidence(scan.model.getDouble("minDetection").toFloat())
    .setMinFacePresenceConfidence(scan.model.getDouble("minPresence").toFloat())
    .setOutputFacialTransformationMatrixes(true).build())
  data class Face(val bounds: PoseBounds, val vector: DoubleArray?)
  fun faces(bitmap: Bitmap, reference: Boolean = false): List<Face> {
    val owned = checkNotNull(bitmap.copy(Bitmap.Config.ARGB_8888, false))
    val image = BitmapImageBuilder(owned).build()
    val result = try { detector.detect(image) } finally { image.close() }
    val transforms = result.facialTransformationMatrixes().orElse(emptyList())
    return result.faceLandmarks().mapIndexed { index, landmarks ->
      val left = landmarks.minOf { it.x() }.coerceIn(0f, 1f); val top = landmarks.minOf { it.y() }.coerceIn(0f, 1f)
      val right = landmarks.maxOf { it.x() }.coerceIn(0f, 1f); val bottom = landmarks.maxOf { it.y() }.coerceIn(0f, 1f)
      val bounds = PoseBounds(left, top, right, bottom)
      val region = Rect((left * bitmap.width).toInt(), (top * bitmap.height).toInt(),
        (right * bitmap.width).toInt(), (bottom * bitmap.height).toInt())
      val orientation = transforms.getOrNull(index)?.let(FaceOrientation::fromMatrix)
      val yawLimit = if (reference) scan.poses.maxOf { maxOf(abs(it.minYaw), abs(it.maxYaw)) } else settings.getDouble("maxYaw")
      val geometry = region.width() >= settings.getInt("minimumFacePixels") && region.height() >= settings.getInt("minimumFacePixels") &&
        orientation != null && abs(orientation.yaw) <= yawLimit &&
        abs(orientation.pitch) <= settings.getDouble("maxPitch") && abs(orientation.roll) <= settings.getDouble("maxRoll")
      val quality = if (geometry) PhotoQuality.measure(bitmap, region, scan.quality.getInt("sampleSize")) else null
      val acceptable = quality != null && quality.brightness >= scan.quality.getDouble("minBrightness") &&
        quality.brightness <= scan.quality.getDouble("maxBrightness") &&
        quality.sharpness >= if (reference) scan.quality.getDouble("minSharpness") else settings.getDouble("minSharpness")
      val vector = if (acceptable) security.embedding(bitmap, landmarks.map { ImagePoint(it.x().toDouble(), it.y().toDouble()) }) else null
      Face(bounds, vector)
    }
  }
  fun reference(bitmap: Bitmap): DoubleArray {
    val faces = faces(bitmap, true)
    require(faces.size == 1 && faces.single().vector != null) { "Reference needs one clear face" }
    return checkNotNull(faces.single().vector)
  }
  override fun close() { try { detector.close() } finally { security.close() } }
}

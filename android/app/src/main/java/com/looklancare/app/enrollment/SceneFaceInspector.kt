package com.looklancare.app.enrollment

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Rect
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.facedetector.FaceDetector
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarker
import org.json.JSONObject
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max

/** The same bundled detector examines overlapping crops; small faces retain more input pixels. */
class SceneFaceInspector(private val context: Context, private val rules: FaceSceneRules) : AutoCloseable {
  private val scan = FaceScanConfig.load(context)
  private val detectorConfig = JSONObject(context.assets.open("enrollment/model.json").bufferedReader().use { it.readText() })
  private val detector = FaceDetector.createFromOptions(context, FaceDetector.FaceDetectorOptions.builder()
    .setBaseOptions(BaseOptions.builder().setModelAssetPath(detectorConfig.getString("modelAsset")).build())
    .setRunningMode(RunningMode.IMAGE)
    .setMinDetectionConfidence(detectorConfig.getDouble("minDetectionConfidence").toFloat())
    .setMinSuppressionThreshold(detectorConfig.getDouble("minSuppressionThreshold").toFloat()).build())
  private val verification = lazy {
    val model = scan.model
    FaceLandmarker.createFromOptions(context, FaceLandmarker.FaceLandmarkerOptions.builder()
      .setBaseOptions(BaseOptions.builder().setModelAssetPath(model.getString("asset")).build())
      .setRunningMode(RunningMode.IMAGE).setNumFaces(model.getInt("maxFaces"))
      .setMinFaceDetectionConfidence(model.getDouble("minDetection").toFloat())
      .setMinFacePresenceConfidence(model.getDouble("minPresence").toFloat())
      .setMinTrackingConfidence(model.getDouble("minTracking").toFloat()).build())
  }

  /** Coarse tile boxes can be wall texture or a fragment of the main face. Require landmark evidence. */
  private fun verify(bitmap: Bitmap, candidate: FaceRegion): List<FaceRegion> {
    val area = candidate.expanded(rules.verificationScale)
    val box = Rect(floor(area.left * bitmap.width).toInt(), floor(area.top * bitmap.height).toInt(),
      ceil((area.left + area.width) * bitmap.width).toInt().coerceAtMost(bitmap.width),
      ceil((area.top + area.height) * bitmap.height).toInt().coerceAtMost(bitmap.height))
    if (box.width() <= 0 || box.height() <= 0) return emptyList()
    val crop = Bitmap.createBitmap(bitmap, box.left, box.top, box.width(), box.height())
    val image = BitmapImageBuilder(crop.copy(Bitmap.Config.ARGB_8888, false)).build()
    return try {
      verification.value.detect(image).faceLandmarks().mapNotNull { face ->
        val left = face.minOf { it.x().toDouble() }; val top = face.minOf { it.y().toDouble() }
        val right = face.maxOf { it.x().toDouble() }; val bottom = face.maxOf { it.y().toDouble() }
        if (!listOf(left, top, right, bottom).all { it.isFinite() } || right <= left || bottom <= top) null
        else {
          // Landmarks can also fit clothing/arm texture. Corroborate the verified face with pixels.
          val region = Rect(floor(left * crop.width).toInt().coerceIn(0, crop.width), floor(top * crop.height).toInt().coerceIn(0, crop.height),
            ceil(right * crop.width).toInt().coerceIn(0, crop.width), ceil(bottom * crop.height).toInt().coerceIn(0, crop.height))
          if (region.width() <= 0 || region.height() <= 0 ||
            PhotoQuality.measure(crop, region, scan.quality.getInt("sampleSize")).rejection(scan.quality) != null) null
          else FaceRegion((box.left + left * box.width()) / bitmap.width, (box.top + top * box.height()) / bitmap.height,
            (right - left) * box.width() / bitmap.width, (bottom - top) * box.height() / bitmap.height)
        }
      }
    } finally { image.close(); if (crop !== bitmap) crop.recycle() }
  }

  private fun starts(length: Int, tile: Int): List<Int> {
    val stride = max(1, (tile * (1 - rules.tileOverlap)).toInt())
    return (0..(length - tile) step stride).toList().plus(length - tile).distinct()
  }
  fun inspect(bitmap: Bitmap, known: List<FaceRegion>): List<FaceRegion> {
    val found = known.toMutableList()
    val tileWidth = ceil(bitmap.width * rules.tileFraction).toInt().coerceIn(1, bitmap.width)
    val tileHeight = ceil(bitmap.height * rules.tileFraction).toInt().coerceIn(1, bitmap.height)
    for (top in starts(bitmap.height, tileHeight)) for (left in starts(bitmap.width, tileWidth)) {
      val crop = Bitmap.createBitmap(bitmap, left, top, tileWidth, tileHeight)
      // MPImage must own a copy even if the tile is the complete caller image.
      val image = BitmapImageBuilder(crop.copy(Bitmap.Config.ARGB_8888, false)).build()
      try {
        for (detection in detector.detect(image).detections()) {
          val box = detection.boundingBox()
          val face = FaceRegion((left + box.left).toDouble() / bitmap.width, (top + box.top).toDouble() / bitmap.height,
            box.width().toDouble() / bitmap.width, box.height().toDouble() / bitmap.height)
          if (face.width <= 0 || face.height <= 0) continue
          if (found.none { it.sameFace(face, rules) }) {
            for (confirmed in verify(bitmap, face)) {
              if (found.none { it.sameFace(confirmed, rules) }) found.add(confirmed)
            }
          }
          if (found.size >= rules.stopAfterFaces) return found
        }
      } finally {
        image.close()
        if (crop !== bitmap) crop.recycle()
      }
    }
    return found
  }
  override fun close() {
    try { detector.close() } finally { if (verification.isInitialized()) verification.value.close() }
  }
}

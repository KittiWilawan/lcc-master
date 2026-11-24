package com.looklancare.app.enrollment

import android.content.Context
import android.graphics.Bitmap
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.facedetector.FaceDetector
import org.json.JSONObject

/** Photo quality only: this detector does not establish identity or liveness. */
class FacePhotoInspector(context: Context) : AutoCloseable {
  val config = JSONObject(context.assets.open("enrollment/model.json").bufferedReader().use { it.readText() })
  private val detector = FaceDetector.createFromOptions(context, FaceDetector.FaceDetectorOptions.builder()
    .setBaseOptions(BaseOptions.builder().setModelAssetPath(config.getString("modelAsset")).build())
    .setRunningMode(RunningMode.IMAGE)
    .setMinDetectionConfidence(config.getDouble("minDetectionConfidence").toFloat())
    .setMinSuppressionThreshold(config.getDouble("minSuppressionThreshold").toFloat()).build())

  data class Face(val left: Double, val top: Double, val width: Double, val height: Double, val confidence: Double)
  fun inspect(bitmap: Bitmap): List<Face> {
    // Own the model input so closing MPImage cannot recycle a photo owned by the caller.
    val image = BitmapImageBuilder(bitmap.copy(Bitmap.Config.ARGB_8888, false)).build()
    return try {
      detector.detect(image).detections().map { detection ->
        val box = detection.boundingBox()
        Face(box.left.toDouble() / bitmap.width, box.top.toDouble() / bitmap.height,
          box.width().toDouble() / bitmap.width, box.height().toDouble() / bitmap.height,
          detection.categories().maxOfOrNull { it.score().toDouble() } ?: 0.0)
      }
    } finally { image.close() }
  }
  override fun close() { detector.close() }
}

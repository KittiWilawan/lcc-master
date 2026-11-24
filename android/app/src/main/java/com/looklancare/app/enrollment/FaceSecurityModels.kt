package com.looklancare.app.enrollment

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import org.json.JSONObject
import java.nio.FloatBuffer
import java.security.MessageDigest
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min

/** CPU model adapter. Pinned assets are checked before inference; no face vectors leave this process. */
private class FaceOnnxModel(context: Context, private val config: JSONObject, threads: Int) : AutoCloseable {
  private val environment = OrtEnvironment.getEnvironment()
  private val session: OrtSession
  private val size = config.getInt("size")
  init {
    require(size > 0 && threads > 0 && config.getInt("outputSize") > 0)
    val shifts = config.getJSONArray("channelShifts")
    require(shifts.length() == 3 && (0 until shifts.length()).map { shifts.getInt(it) }.toSet() == setOf(0, 8, 16))
    val bytes = context.assets.open(config.getString("asset")).use { it.readBytes() }
    val hash = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    require(hash == config.getString("sha256")) { "Face model asset integrity failure" }
    session = OrtSession.SessionOptions().use { options ->
      options.setIntraOpNumThreads(threads); options.setInterOpNumThreads(1)
      environment.createSession(bytes, options)
    }
    try { require(session.inputNames.contains(config.getString("input"))) }
    catch (failure: Exception) { session.close(); throw failure }
  }
  fun run(bitmap: Bitmap): DoubleArray {
    require(bitmap.width == size && bitmap.height == size)
    val pixels = IntArray(size * size)
    bitmap.getPixels(pixels, 0, size, 0, 0, size, size)
    val input = FloatArray(pixels.size * 3)
    val channels = config.getJSONArray("channelShifts")
    for (channel in 0 until channels.length()) for (i in pixels.indices) {
      input[channel * pixels.size + i] = ((pixels[i] ushr channels.getInt(channel)) and 255).toFloat()
    }
    return OnnxTensor.createTensor(environment, FloatBuffer.wrap(input), longArrayOf(1, 3, size.toLong(), size.toLong())).use { tensor ->
      session.run(mapOf(config.getString("input") to tensor)).use { output ->
        val values = (output[0] as OnnxTensor).floatBuffer
        val result = FloatArray(values.remaining()); values.get(result)
        require(result.size == config.getInt("outputSize") && result.all { it.isFinite() })
        DoubleArray(result.size) { result[it].toDouble() }
      }
    }
  }
  override fun close() { session.close() }
}

class FaceSecurityModels(private val context: Context, private val config: JSONObject) : AutoCloseable {
  private val identity = lazy { FaceOnnxModel(context, config.getJSONObject("identity"), config.getInt("threads")) }
  private val passive = mutableListOf<FaceOnnxModel>()

  fun inspect(bitmap: Bitmap, points: List<ImagePoint>, face: FaceObservation, front: Boolean): FaceEvidence {
    return FaceEvidence(embedding(bitmap, points), if (front) liveScore(bitmap, face) else null)
  }

  /** Recognition reuses alignment, never the enrolment liveness decision. */
  fun embedding(bitmap: Bitmap, points: List<ImagePoint>): DoubleArray {
    val identityConfig = config.getJSONObject("identity")
    val indexes = identityConfig.getJSONArray("landmarkGroups")
    val source = (0 until indexes.length()).map { i ->
      val group = indexes.getJSONArray(i)
      val selected = (0 until group.length()).map { points[group.getInt(it)] }
      ImagePoint(selected.map { it.x }.average() * bitmap.width, selected.map { it.y }.average() * bitmap.height)
    }
    val template = identityConfig.getJSONArray("template")
    val target = (0 until template.length()).map { i -> template.getJSONArray(i).let { ImagePoint(it.getDouble(0), it.getDouble(1)) } }
    val aligned = Bitmap.createBitmap(identityConfig.getInt("size"), identityConfig.getInt("size"), Bitmap.Config.ARGB_8888)
    val embedding = try {
      Canvas(aligned).drawBitmap(bitmap, Matrix().apply { setValues(FaceSimilarityTransform.forCanvas(FaceSimilarityTransform.fit(source, target))) }, Paint(Paint.FILTER_BITMAP_FLAG))
      FaceVectors.normalized(identity.value.run(aligned)) ?: error("Invalid face embedding")
    } finally { aligned.recycle() }
    return embedding
  }

  private fun liveScore(bitmap: Bitmap, face: FaceObservation): Double {
    val models = config.getJSONArray("passiveModels")
    if (passive.isEmpty()) {
      try { for (i in 0 until models.length()) passive.add(FaceOnnxModel(context, models.getJSONObject(i), config.getInt("threads"))) }
      catch (failure: Exception) { passive.forEach { it.close() }; passive.clear(); throw failure }
    }
    return passive.indices.map { i ->
      val modelConfig = models.getJSONObject(i)
      val crop = passiveCrop(bitmap, face, modelConfig.getDouble("scale"), modelConfig.getInt("size"))
      try {
        val logits = passive[i].run(crop)
        val largest = logits.maxOrNull()!!
        val probabilities = logits.map { exp(it - largest) }
        probabilities[config.getInt("liveClass")] / probabilities.sum()
      } finally { crop.recycle() }
    }.average()
  }

  /** Matches the upstream multi-scale crop: shift within the image rather than clip one edge. */
  private fun passiveCrop(bitmap: Bitmap, face: FaceObservation, requestedScale: Double, size: Int): Bitmap {
    val width = face.width * bitmap.width; val height = face.height * bitmap.height
    val scale = min(requestedScale, min((bitmap.width - 1) / width, (bitmap.height - 1) / height))
    val cropWidth = width * scale; val cropHeight = height * scale
    val cx = (face.left + face.width / 2) * bitmap.width; val cy = (face.top + face.height / 2) * bitmap.height
    val left = (cx - cropWidth / 2).coerceIn(0.0, max(0.0, bitmap.width - 1.0 - cropWidth)).toInt()
    val top = (cy - cropHeight / 2).coerceIn(0.0, max(0.0, bitmap.height - 1.0 - cropHeight)).toInt()
    val right = (left + cropWidth).toInt().coerceAtMost(bitmap.width - 1)
    val bottom = (top + cropHeight).toInt().coerceAtMost(bitmap.height - 1)
    val crop = Bitmap.createBitmap(bitmap, left, top, right - left + 1, bottom - top + 1)
    val scaled = Bitmap.createScaledBitmap(crop, size, size, true)
    return try { scaled.copy(Bitmap.Config.ARGB_8888, false) }
    finally { if (scaled !== crop && scaled !== bitmap) scaled.recycle(); if (crop !== bitmap) crop.recycle() }
  }
  override fun close() {
    try { if (identity.isInitialized()) identity.value.close() }
    finally { passive.forEach { it.close() }; passive.clear() }
  }
}

package com.looklancare.app.monitoring

import android.content.Context
import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.SystemClock
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.CancellationException

/** Offline samples use clip time and the live analyzer. No event queue, server or notification writer. */
class VideoFallTestRunner(private val context: Context) {
  private val runtime = MonitoringConfig.load(context)
  private val limits = JSONObject(context.assets.open("monitoring/video-test.json").bufferedReader().use { it.readText() })

  fun run(request: JSONObject, cancelled: () -> Boolean, onFrame: (JSONObject, Bitmap) -> Unit): JSONObject {
    val uri = Uri.parse(request.getString("uri"))
    require(uri.scheme == "file" || uri.scheme == "content") { "เลือกวิดีโอจากเครื่องเท่านั้น" }
    if (uri.scheme == "file") {
      val file = File(requireNotNull(uri.path)).canonicalFile
      require(file.toPath().startsWith(context.cacheDir.canonicalFile.toPath())) { "กรุณาเลือกคลิปใหม่ผ่านแอป" }
      require(file.isFile && file.length() in 1..limits.getLong("maxFileBytes")) { "วิดีโอใหญ่เกินขนาดที่รองรับ" }
    }
    val camera = JSONObject().put("userId", request.getString("userId")).put("familyId", request.getString("familyId"))
      .put("targetMemberIds", request.getJSONArray("targetMemberIds"))
    require(camera.getString("userId").isNotBlank() && camera.getString("familyId").isNotBlank())
    val scope = CameraMonitoringTargets.read(camera)
    val identitySettings = JSONObject(context.assets.open("monitoring/identity.json").bufferedReader().use { it.readText() })
    require(scope.memberIds.size <= identitySettings.getInt("maxMembers"))
    val retriever = MediaMetadataRetriever()
    val started = SystemClock.elapsedRealtime()
    fun checkActive() {
      if (cancelled()) throw CancellationException("หยุดทดสอบแล้ว")
      check(SystemClock.elapsedRealtime() - started <= limits.getLong("maxProcessingMs")) { "ทดสอบใช้เวลานานเกินกำหนด กรุณาเลือกคลิปสั้นลง" }
    }
    try {
      checkActive()
      context.contentResolver.openAssetFileDescriptor(uri, "r").use { descriptor ->
        requireNotNull(descriptor) { "อ่านไฟล์ไม่ได้ กรุณาเลือกวิดีโอใหม่" }
        val size = if (descriptor.length >= 0) descriptor.length else descriptor.parcelFileDescriptor.statSize
        require(size in 1..limits.getLong("maxFileBytes")) { "อ่านขนาดวิดีโอไม่ได้หรือไฟล์ใหญ่เกินกำหนด" }
        if (descriptor.declaredLength >= 0) retriever.setDataSource(descriptor.fileDescriptor, descriptor.startOffset, descriptor.declaredLength)
        else retriever.setDataSource(descriptor.fileDescriptor)
      }
      val duration = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
      require(duration != null && duration in 1..limits.getLong("maxDurationMs")) { "กรุณาใช้คลิปที่ยาวไม่เกิน ${limits.getLong("maxDurationMs") / 60000} นาที" }
      val width = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0
      val height = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0
      require(width > 0 && height > 0) { "ไฟล์นี้ไม่มีภาพวิดีโอที่อ่านได้" }
      require(width.toLong() * height <= limits.getLong("maxInputPixels")) { "วิดีโอมีความละเอียดสูงเกินไป กรุณาลดความละเอียดก่อนทดสอบ" }
      val scale = minOf(1.0, runtime.int("maxFrameDimension").toDouble() / maxOf(width, height))
      val frameWidth = (width * scale).toInt().coerceAtLeast(1)
      val frameHeight = (height * scale).toInt().coerceAtLeast(1)
      val events = JSONArray()
      val comparisonEvents = JSONArray()
      var count = 0
      var personFrames = 0
      var monitoredFrames = 0
      var position = 0L
      LocalPoseAnalyzer(context, runtime, compareVideoWeights = true).use { analyzer ->
        analyzer.prepare(request.getString("id"))
        while (position < duration) {
          checkActive()
          val decoded = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1)
            retriever.getScaledFrameAtTime(position * 1000, MediaMetadataRetriever.OPTION_CLOSEST, frameWidth, frameHeight)
            else retriever.getFrameAtTime(position * 1000, MediaMetadataRetriever.OPTION_CLOSEST)
          requireNotNull(decoded) { "ถอดภาพวิดีโอไม่สำเร็จ" }
          val maximum = maxOf(decoded.width, decoded.height)
          val bitmap = if (maximum <= runtime.int("maxFrameDimension")) decoded else {
            val ratio = runtime.int("maxFrameDimension").toDouble() / maximum
            try { Bitmap.createScaledBitmap(decoded, (decoded.width * ratio).toInt().coerceAtLeast(1), (decoded.height * ratio).toInt().coerceAtLeast(1), true) }
            finally { decoded.recycle() }
          }
          try {
            val analysis = analyzer.analyze(request.getString("id"), bitmap, started + position, camera)
            checkActive()
            count++
            if (analysis.getInt("peopleCount") > 0) personFrames++
            if (analysis.getInt("monitoredPeopleCount") > 0) monitoredFrames++
            if (analysis.getBoolean("fallDetected")) events.put(JSONObject().put("positionMs", position).put("analysis", analysis))
            val compared = analysis.getJSONArray("comparisonEvents")
            for (index in 0 until compared.length()) comparisonEvents.put(compared.getJSONObject(index).put("positionMs", position))
            onFrame(JSONObject().put("id", request.getString("id")).put("positionMs", position).put("durationMs", duration)
              .put("framesAnalyzed", count).put("fallEvents", events.length()).put("analysis", analysis), bitmap)
          } finally { bitmap.recycle() }
          position += runtime.long("frameIntervalMs")
        }
      }
      checkActive()
      return JSONObject().put("id", request.getString("id")).put("durationMs", duration).put("framesAnalyzed", count)
        .put("personFrames", personFrames).put("monitoredFrames", monitoredFrames).put("events", events).put("comparisonEvents", comparisonEvents)
        .put("monitoringMode", if (scope.allPeople) "all_people" else "selected_people")
    } finally { retriever.release() }
  }
}

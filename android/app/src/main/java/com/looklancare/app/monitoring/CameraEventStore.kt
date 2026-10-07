package com.looklancare.app.monitoring

import android.content.Context
import android.graphics.Bitmap
import android.util.AtomicFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

/** Private evidence queue, bounded and acknowledged only after local app storage. */
class CameraEventStore(context: Context, private val maximum: Int) {
  companion object { private val guard = Any() }
  private val directory = File(context.noBackupFilesDir, "camera-events").apply { mkdirs() }
  private val index = AtomicFile(File(directory, "events.json"))
  fun read(): JSONArray = synchronized(guard) { try {
    JSONArray(index.openRead().bufferedReader().use { it.readText() })
  } catch (_: Exception) { JSONArray() } }

  fun add(camera: JSONObject, analysis: JSONObject, bitmap: Bitmap, notificationSent: Boolean): JSONObject = synchronized(guard) {
    val id = UUID.randomUUID().toString()
    val image = File(directory, "$id.jpg")
    image.outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.JPEG, camera.getInt("jpegQuality"), it)) }
    val event = JSONObject().put("id", id).put("cameraId", camera.getString("id"))
      .put("cameraName", camera.getString("name")).put("familyId", camera.getString("familyId"))
      .put("userId", camera.getString("userId")).put("createdAt", System.currentTimeMillis())
      .put("imageUri", android.net.Uri.fromFile(image).toString()).put("analysis", analysis).put("notificationSent", notificationSent)
    val events = read()
    val expired = mutableListOf<JSONObject>()
    while (events.length() >= maximum) expired.add(events.remove(0) as JSONObject)
    events.put(event)
    try { write(events) } catch (error: Exception) { image.delete(); throw error }
    expired.forEach { delete(it) }
    event
  }

  fun acknowledge(id: String) = synchronized(guard) {
    val events = read(); val remaining = JSONArray(); val removed = mutableListOf<JSONObject>()
    for (index in 0 until events.length()) {
      val event = events.getJSONObject(index)
      if (event.getString("id") == id) removed.add(event) else remaining.put(event)
    }
    write(remaining)
    removed.forEach { delete(it) }
  }

  fun updateDelivery(id: String, result: JSONObject) = synchronized(guard) {
    val events = read()
    for (index in 0 until events.length()) {
      val event = events.getJSONObject(index)
      if (event.getString("id") == id) {
        event.put("deliveryState", result.optString("state"))
        if (result.has("cloudSynced")) event.put("cloudSynced", result.getBoolean("cloudSynced"))
        if (result.has("remoteAccepted")) event.put("remoteAccepted", result.getBoolean("remoteAccepted"))
        if (result.has("imagePath")) event.put("cloudImagePath", result.getString("imagePath"))
      }
    }
    write(events)
  }

  fun clear() = synchronized(guard) {
    write(JSONArray())
    directory.listFiles()?.filter { it.extension == "jpg" && it.parentFile?.canonicalFile == directory.canonicalFile }
      ?.forEach { it.delete() }
  }

  private fun delete(event: JSONObject) {
    val file = File(java.net.URI(event.getString("imageUri")))
    if (file.parentFile?.canonicalFile == directory.canonicalFile) file.delete()
  }

  private fun write(events: JSONArray) {
    val stream = index.startWrite()
    try { stream.write(events.toString().toByteArray()); index.finishWrite(stream) }
    catch (error: Exception) { index.failWrite(stream); throw error }
  }
}

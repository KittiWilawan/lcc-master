package com.looklancare.app.monitoring

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.graphics.Bitmap
import android.util.AtomicFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.UUID

/** Durable outbox: count is a warning threshold, never a reason to evict an unsent event. */
class CameraEventStore(context: Context, private val maximum: Int, storageRules: EvidenceStorageRules? = null) {
  companion object {
    private val guard = Any()
    private val databases = mutableMapOf<String, SQLiteDatabase>()
  }
  private val directory = File(context.noBackupFilesDir, "camera-events").apply { check(isDirectory || mkdirs()) }
  private val settings = JSONObject(context.assets.open("monitoring/storage.json").bufferedReader().use { it.readText() })
  private val rules = storageRules ?: EvidenceStorageRules(settings.getLong("maxEvidenceBytes"), settings.getLong("minimumFreeBytes"), settings.getLong("maxEventImageBytes"))
  private val database = synchronized(guard) {
    val path = File(directory, "outbox.db").absolutePath
    databases.getOrPut(path) { OutboxDatabase(context.applicationContext, path).writableDatabase }
  }
  init { require(maximum > 0); synchronized(guard) { migrateLegacy() } }

  private class OutboxDatabase(context: Context, path: String) : SQLiteOpenHelper(context, path, null, 1) {
    override fun onConfigure(db: SQLiteDatabase) { db.execSQL("PRAGMA synchronous=FULL") }
    override fun onCreate(db: SQLiteDatabase) {
      db.execSQL("CREATE TABLE events (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, payload TEXT NOT NULL, locally_saved INTEGER NOT NULL DEFAULT 0, delivery_complete INTEGER NOT NULL DEFAULT 0, image_bytes INTEGER NOT NULL DEFAULT 0, last_attempt INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL DEFAULT 0)")
      db.execSQL("CREATE INDEX events_delivery ON events(delivery_complete,last_attempt,created_at)")
      db.execSQL("CREATE TABLE metadata (name TEXT PRIMARY KEY, value INTEGER NOT NULL)")
    }
    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) { error("Unsupported outbox version") }
  }

  private fun migrateLegacy() {
    database.rawQuery("SELECT value FROM metadata WHERE name=?", arrayOf("legacy_imported")).use { if (it.moveToFirst()) return }
    val legacy = AtomicFile(File(directory, "events.json"))
    val events = try { JSONArray(legacy.openRead().bufferedReader().use { it.readText() }) }
      catch (error: java.io.FileNotFoundException) {
        if (legacy.baseFile.exists() || File(directory, "events.json.bak").exists()) throw error
        JSONArray()
      }
    database.beginTransaction()
    try {
      for (index in 0 until events.length()) {
        val event = events.getJSONObject(index)
        insert(event, evidenceFile(event)?.length() ?: 0, SQLiteDatabase.CONFLICT_IGNORE)
      }
      val discarded = (0 until events.length()).maxOfOrNull { events.getJSONObject(it).optInt("queueDiscardedTotal") } ?: 0
      database.insertOrThrow("metadata", null, ContentValues().apply { put("name", "legacy_discarded"); put("value", discarded) })
      database.insertOrThrow("metadata", null, ContentValues().apply { put("name", "legacy_imported"); put("value", 1) })
      database.setTransactionSuccessful()
    } finally { database.endTransaction() }
    legacy.delete()
  }

  private fun insert(event: JSONObject, bytes: Long, conflict: Int = SQLiteDatabase.CONFLICT_ABORT) {
    val result = database.insertWithOnConflict("events", null, ContentValues().apply {
      put("id", event.getString("id")); put("created_at", event.getLong("createdAt")); put("payload", event.toString())
      put("delivery_complete", if (event.optBoolean("deliveryComplete")) 1 else 0); put("image_bytes", bytes)
    }, conflict)
    check(result != -1L || conflict == SQLiteDatabase.CONFLICT_IGNORE)
  }
  private fun rows(selection: String? = null, arguments: Array<String>? = null, order: String = "created_at,id", limit: String? = null): JSONArray {
    val result = JSONArray()
    database.query("events", arrayOf("payload"), selection, arguments, null, null, order, limit).use { cursor ->
      while (cursor.moveToNext()) result.put(JSONObject(cursor.getString(0)))
    }
    return result
  }
  fun read(): JSONArray = synchronized(guard) { rows() }
  fun forApp(): JSONArray = synchronized(guard) { rows("locally_saved=0 OR delivery_complete=1", limit = settings.getInt("appBatchSize").toString()) }
  fun forDelivery(now: Long, maximumDelay: Long): JSONArray = synchronized(guard) {
    rows("delivery_complete=0 AND (next_attempt<=? OR next_attempt>?)", arrayOf(now.toString(), (now + maximumDelay).toString()),
      order = "last_attempt,created_at DESC,id", limit = settings.getInt("deliveryBatchSize").toString())
  }
  fun markAttempt(id: String, delayMs: Long) = synchronized(guard) {
    val now = System.currentTimeMillis()
    database.update("events", ContentValues().apply { put("last_attempt", now); put("next_attempt", now + delayMs) }, "id=?", arrayOf(id))
  }
  fun nextAttemptDelay(now: Long, fallback: Long, maximumDelay: Long): Long = synchronized(guard) {
    database.rawQuery("SELECT MIN(next_attempt) FROM events WHERE delivery_complete=0", null).use { cursor ->
      check(cursor.moveToFirst())
      if (cursor.isNull(0)) fallback else (cursor.getLong(0) - now).coerceIn(0, maximumDelay)
    }
  }
  fun markLocallySaved(id: String) = synchronized(guard) {
    database.update("events", ContentValues().apply { put("locally_saved", 1) }, "id=?", arrayOf(id))
  }

  fun add(camera: JSONObject, analysis: JSONObject, bitmap: Bitmap, notificationSent: Boolean, stillActive: () -> Boolean = { true }): JSONObject = synchronized(guard) {
    check(stillActive()) { "Monitoring scope ended before saving event" }
    val id = if (analysis.has("eventId")) UUID.fromString(analysis.getString("eventId")).toString() else UUID.randomUUID().toString()
    rows("id=?", arrayOf(id)).optJSONObject(0)?.let { return@synchronized it }
    val bytes = ByteArrayOutputStream().use { output ->
      check(bitmap.compress(Bitmap.CompressFormat.JPEG, camera.getInt("jpegQuality"), output)); output.toByteArray()
    }
    val storedBytes = scalar("SELECT COALESCE(SUM(image_bytes),0) FROM events")
    var keepImage = rules.canStore(storedBytes, bytes.size.toLong(), directory.usableSpace)
    val file = AtomicFile(File(directory, "$id.jpg"))
    if (keepImage) {
      try {
        val stream = file.startWrite()
        try { stream.write(bytes); file.finishWrite(stream) } catch (error: Exception) { file.failWrite(stream); throw error }
      } catch (_: java.io.IOException) { file.delete(); keepImage = false }
    }
    val event = JSONObject().put("id", id).put("cameraId", camera.getString("id"))
      .put("cameraName", camera.getString("name")).put("familyId", camera.getString("familyId"))
      .put("userId", camera.getString("userId")).put("createdAt", System.currentTimeMillis())
      .put("imageUri", if (keepImage) android.net.Uri.fromFile(file.baseFile).toString() else JSONObject.NULL)
      .put("evidenceState", if (keepImage) "available" else "storage_pressure")
      .put("analysis", analysis).put("notificationSent", notificationSent)
    try { insert(event, if (keepImage) bytes.size.toLong() else 0) } catch (error: Exception) { file.delete(); throw error }
    event
  }

  fun health(): QueueHealthInput = synchronized(guard) {
    val pending = scalar("SELECT COUNT(*) FROM events WHERE delivery_complete=0").toInt()
    val missing = scalar("SELECT COUNT(*) FROM events WHERE image_bytes=0").toInt()
    val discarded = scalar("SELECT COALESCE(MAX(value),0) FROM metadata WHERE name='legacy_discarded'").toInt()
    QueueHealthInput(pending, maximum, discarded, missing)
  }

  fun acknowledge(id: String) = synchronized(guard) {
    val event = rows("id=?", arrayOf(id)).optJSONObject(0) ?: return@synchronized
    // Cloud receipt and local archival must both precede evidence deletion.
    if (!event.optBoolean("cloudSynced") || !event.optBoolean("deliveryComplete")) return@synchronized
    database.delete("events", "id=? AND locally_saved=1", arrayOf(id)).also { if (it > 0) evidenceFile(event)?.delete() }
  }

  fun updateDelivery(id: String, result: JSONObject) = synchronized(guard) {
    val event = rows("id=?", arrayOf(id)).optJSONObject(0) ?: return@synchronized
    event.put("deliveryState", result.optString("state"))
    for (key in listOf("cloudSynced", "remoteAccepted", "deliveryComplete", "providerConfirmed", "receivedCount")) {
      if (result.has(key)) event.put(key, result.get(key))
    }
    if (result.has("imagePath")) event.put("cloudImagePath", result.get("imagePath"))
    database.update("events", ContentValues().apply { put("payload", event.toString()); put("delivery_complete", if (event.optBoolean("deliveryComplete")) 1 else 0) }, "id=?", arrayOf(id))
  }

  fun clear() = synchronized(guard) {
    database.delete("events", null, null)
    database.update("metadata", ContentValues().apply { put("value", 0) }, "name=?", arrayOf("legacy_discarded"))
    directory.listFiles()?.filter { it.extension == "jpg" && it.parentFile?.canonicalFile == directory.canonicalFile }?.forEach { it.delete() }
  }
  private fun scalar(query: String): Long = database.rawQuery(query, null).use { check(it.moveToFirst()); it.getLong(0) }
  private fun evidenceFile(event: JSONObject): File? {
    val uri = event.optString("imageUri").takeIf { !event.isNull("imageUri") && it.isNotBlank() } ?: return null
    val file = File(java.net.URI(uri))
    check(file.parentFile?.canonicalFile == directory.canonicalFile)
    return file
  }
}

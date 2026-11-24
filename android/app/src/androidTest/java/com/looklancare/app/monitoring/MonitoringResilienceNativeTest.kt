package com.looklancare.app.monitoring

import android.content.Intent
import android.graphics.Bitmap
import android.os.SystemClock
import androidx.test.platform.app.InstrumentationRegistry
import com.looklancare.app.MainActivity
import com.looklancare.app.MonitoringForegroundService
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class MonitoringResilienceNativeTest {
  private val instrumentation = InstrumentationRegistry.getInstrumentation()
  private val context = instrumentation.targetContext
  private val runtime = MonitoringConfig.load(context)
  private fun camera(url: String = "https://camera.invalid/live.m3u8") = JSONObject().put("id", "resilience-camera")
    .put("name", "กล้องทดสอบ").put("userId", "resilience-user").put("familyId", "resilience-family")
    .put("url", url).put("jpegQuality", runtime.int("jpegQuality"))
  private fun credential(family: String = "resilience-family", expires: Long = System.currentTimeMillis() + 3600000) = JSONObject()
    .put("endpoint", "https://device.invalid/events").put("token", "synthetic-resilience-device-token")
    .put("userId", "resilience-user").put("familyId", family).put("deviceId", "synthetic-device")
    .put("expiresAt", java.time.Instant.ofEpochMilli(expires).toString())
  private fun write(name: String, value: JSONObject) { File(context.filesDir, name).writeText(value.toString(2)) }

  @Test fun prepareDurableQueueForProcessRestart() {
    val store = CameraEventStore(context, runtime.int("maxPendingEvents")); store.clear()
    val bitmap = Bitmap.createBitmap(4,4,Bitmap.Config.ARGB_8888)
    val expected = JSONArray()
    try {
      repeat(runtime.int("maxPendingEvents") * 3) {
        expected.put(store.add(camera(), JSONObject().put("reason", "เหตุทดสอบคิวส่วนตัว"), bitmap, false).getString("id"))
      }
      assertEquals(expected.length(), store.read().length()); assertEquals(0, store.health().discarded)
      write("resilience-queue-expected.json", JSONObject().put("ids", expected))
    } finally { bitmap.recycle() }
  }
  @Test fun durableQueueSurvivesNewProcessAndRequiresBothAcknowledgements() {
    val expected = JSONObject(File(context.filesDir, "resilience-queue-expected.json").readText()).getJSONArray("ids")
    val store = CameraEventStore(context, runtime.int("maxPendingEvents"))
    try {
      val actual = store.read(); assertEquals(expected.length(), actual.length())
      val ids = (0 until actual.length()).map { actual.getJSONObject(it).getString("id") }.toSet()
      for (index in 0 until expected.length()) assertTrue(expected.getString(index) in ids)
      val id = expected.getString(0)
      store.acknowledge(id); assertEquals(expected.length(), store.read().length())
      store.updateDelivery(id, JSONObject().put("cloudSynced", true).put("deliveryComplete", true))
      store.acknowledge(id); assertEquals(expected.length(), store.read().length())
      store.markLocallySaved(id); store.acknowledge(id); assertEquals(expected.length()-1,store.read().length())
      val first = store.forDelivery(System.currentTimeMillis(), 300000)
      for (index in 0 until first.length()) store.markAttempt(first.getJSONObject(index).getString("id"), 300000)
      val next = store.forDelivery(System.currentTimeMillis(), 300000)
      val firstIds=(0 until first.length()).map { first.getJSONObject(it).getString("id") }.toSet()
      assertTrue((0 until next.length()).none { next.getJSONObject(it).getString("id") in firstIds })
      write("resilience-queue-result.json",JSONObject().put("preserved",expected.length()).put("discarded",store.health().discarded)
        .put("bothAcknowledgementsRequired",true).put("fairDeliveryBatches",true))
    } finally { store.clear() }
  }
  @Test fun cameraSessionIsEncryptedScopedAndCleared() {
    val saved = MonitorSessionStore(context); val permission = MonitorCredentialStore(context)
    try {
      val revision = saved.save(JSONArray().put(camera()))
      assertNull(saved.forRestore()); permission.write(credential()); assertNotNull(saved.forRestore())
      val raw = File(context.noBackupFilesDir,"monitor-session.json").readText()
      assertFalse(raw.contains("camera.invalid")); assertFalse(raw.contains("resilience-family"))
      permission.write(credential("other-family")); assertNull(saved.forRestore())
      permission.write(credential(expires=System.currentTimeMillis()-1)); assertNull(saved.forRestore())
      val mixed=JSONArray().put(camera()).put(camera().put("id","other-camera").put("familyId","other-family"))
      assertTrue(runCatching { saved.save(mixed) }.isFailure)
      assertTrue(saved.isCurrent(revision)); saved.clear(); assertFalse(saved.isCurrent(revision))
      assertNull(saved.forRestore()); assertFalse(File(context.noBackupFilesDir,"monitor-session.json").exists())
      write("resilience-session-result.json",JSONObject().put("encrypted",true).put("scopeChecked",true).put("expiryChecked",true).put("explicitStopClears",true))
    } finally { saved.clear(); permission.clear() }
  }
  @Test fun unchangedRecoveryStateDoesNotRewriteEncryptedCameraSettings() {
    val saved=MonitorSessionStore(context)
    try {
      val revision=saved.save(JSONArray().put(camera()))
      saved.markRecovery("starting")
      val file=File(context.noBackupFilesDir,"monitor-session.json")
      val first=file.readText()
      saved.markRecovery("starting")
      assertEquals(first,file.readText())
      saved.markRecovery("ready")
      assertNotEquals(first,file.readText())
      assertTrue(saved.isCurrent(revision))
      val ready=file.readText(); saved.markRecovery("ready"); assertEquals(ready,file.readText())
      write("resilience-state-write-result.json",JSONObject().put("sameStatePreservesCiphertext",true).put("stateChangePersists",true).put("revisionPreserved",true))
    } finally { saved.clear() }
  }
  @Test fun encryptedSessionAndDevicePermissionRestoreTheirAtomicBackups() {
    val saved=MonitorSessionStore(context); val permission=MonitorCredentialStore(context)
    try {
      val revision=saved.save(JSONArray().put(camera())); permission.write(credential())
      for (name in listOf("monitor-session.json","monitor-credential.json")) {
        val file=File(context.noBackupFilesDir,name)
        assertTrue(file.renameTo(File(context.noBackupFilesDir,"$name.bak")))
        assertFalse(file.exists())
      }
      assertNotNull(saved.forRestore()); assertTrue(saved.isCurrent(revision))
      assertTrue(File(context.noBackupFilesDir,"monitor-session.json").exists())
      assertTrue(File(context.noBackupFilesDir,"monitor-credential.json").exists())
      write("resilience-encrypted-backup-result.json",JSONObject().put("sessionRestored",true).put("permissionRestored",true).put("revisionPreserved",true))
    } finally { saved.clear(); permission.clear() }
  }
  @Test fun prepareLiveSessionForSystemRecovery() {
    val base = InstrumentationRegistry.getArguments().getString("baseUrl") ?: error("baseUrl required")
    context.startActivity(Intent(context,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    MonitorCredentialStore(context).write(credential())
    val saved=MonitorSessionStore(context); val sources=JSONArray().put(camera(base+"/live/live.m3u8"))
    val revision=saved.save(sources)
    context.startForegroundService(Intent(context,MonitoringForegroundService::class.java).putExtra("cameras",sources.toString()).putExtra("monitorRevision",revision))
    val started=SystemClock.elapsedRealtime()
    while (SystemClock.elapsedRealtime()-started<runtime.long("readTimeoutMs")*4 && (MonitoringState.cameras["resilience-camera"]?.optLong("lastAnalysisAt") ?: 0)<=0) SystemClock.sleep(runtime.long("frameIntervalMs"))
    val state=checkNotNull(MonitoringState.cameras["resilience-camera"])
    assertTrue(state.optLong("lastAnalysisAt")>0); assertNotNull(saved.forRestore())
    write("resilience-before-recovery.json",JSONObject().put("lastAnalysisAt",state.getLong("lastAnalysisAt")).put("pid",android.os.Process.myPid()))
  }
  @Test fun imageRecoveryReacquiresARealPersonAfterControlledPrimaryLoss() {
    val args=InstrumentationRegistry.getArguments()
    val base=args.getString("baseUrl") ?: error("baseUrl required")
    val path=args.getString("fallPath") ?: error("fallPath required")
    assertTrue(runtime.values.getBoolean("poseRecoveryEnabled"))
    var hideNext=false; var hidden=0; var recovered=0; var fell=false
    val analyzer=LocalPoseAnalyzer(context,runtime) { observations, _ ->
      if (hideNext && observations.isNotEmpty()) { hideNext=false; hidden++; emptyList() } else observations
    }
    analyzer.prepare("controlled-loss")
    val ended=java.util.concurrent.CountDownLatch(1)
    val worker=java.util.concurrent.Executors.newSingleThreadExecutor()
    val errors=java.util.concurrent.ConcurrentLinkedQueue<String>()
    val dispatcher=CameraFrameDispatcher(worker,runtime.int("maxPendingFrames"),runtime.long("maxPendingFrameAgeMs")) { bitmap,timestamp ->
      try {
        val before=hidden; val result=analyzer.analyze("controlled-loss",bitmap,timestamp)
        if (hidden>before && result.getJSONObject("diagnostics").getInt("recoveryInferences")>0 && result.getInt("peopleCount")>0) recovered++
        if (result.getString("status")=="possible_fall" && hidden==0) hideNext=true
        fell=fell || result.getBoolean("fallDetected")
      } catch (error: Exception) { errors.add(error.javaClass.simpleName) }
    }
    val session=CameraStreamSession(context,base+path,runtime,{ state -> if (state=="ended") ended.countDown() },{ bitmap,time -> dispatcher.submit(bitmap,time) })
    try {
      assertTrue(ended.await(runtime.long("readTimeoutMs")*4,java.util.concurrent.TimeUnit.MILLISECONDS))
      assertTrue(dispatcher.awaitIdle(runtime.long("readTimeoutMs")))
    } finally {
      session.close(); dispatcher.close(); worker.shutdown(); assertTrue(worker.awaitTermination(runtime.long("readTimeoutMs"),java.util.concurrent.TimeUnit.MILLISECONDS)); analyzer.close()
    }
    write("resilience-image-recovery-result.json",JSONObject().put("controlledPrimaryLoss",hidden).put("recoveredOnLoss",recovered).put("fallDetected",fell).put("errors",JSONArray(errors.toList())))
    assertTrue(errors.isEmpty()); assertEquals(1,hidden); assertTrue(recovered>0); assertTrue(fell)
  }
  @Test fun storagePressurePreservesEventMetadataWithoutEvictingOlderEvidence() {
    val store=CameraEventStore(context,runtime.int("maxPendingEvents"),EvidenceStorageRules(1,1,1)); store.clear()
    val bitmap=Bitmap.createBitmap(4,4,Bitmap.Config.ARGB_8888)
    try {
      val event=store.add(camera(),JSONObject().put("reason","ทดสอบพื้นที่รูปไม่พอ"),bitmap,true)
      assertEquals(1,store.read().length()); assertTrue(event.isNull("imageUri")); assertEquals("storage_pressure",event.getString("evidenceState"))
      assertEquals(1,store.health().withoutEvidence); assertEquals(0,store.health().discarded)
      write("resilience-storage-result.json",JSONObject().put("metadataSaved",true).put("photoOmitted",true).put("discarded",0))
    } finally { store.clear(); bitmap.recycle() }
  }
  @Test fun legacyIndexMigratesOnceAndRetainsItsImage() {
    CameraEventStore(context,runtime.int("maxPendingEvents")).clear()
    val directory=File(context.noBackupFilesDir,"camera-events")
    val db=android.database.sqlite.SQLiteDatabase.openDatabase(File(directory,"outbox.db").absolutePath,null,android.database.sqlite.SQLiteDatabase.OPEN_READWRITE)
    db.use { it.delete("metadata","name IN (?,?)",arrayOf("legacy_imported","legacy_discarded")) }
    val id=java.util.UUID.randomUUID().toString(); val image=File(directory,"$id.jpg"); image.writeBytes(byteArrayOf(-1,-40,-1,-39))
    val event=JSONObject().put("id",id).put("createdAt",System.currentTimeMillis()).put("imageUri",android.net.Uri.fromFile(image).toString())
      .put("cameraId","legacy-camera").put("cameraName","ทดสอบย้ายคิว").put("familyId","resilience-family").put("userId","resilience-user")
      .put("analysis",JSONObject().put("reason","ทดสอบย้ายคิวเดิม"))
    File(directory,"events.json.bak").writeText(JSONArray().put(event).toString())
    val store=CameraEventStore(context,runtime.int("maxPendingEvents"))
    try {
      assertEquals(id,store.read().getJSONObject(0).getString("id")); assertTrue(image.isFile)
      assertFalse(File(directory,"events.json").exists()); assertEquals(1,CameraEventStore(context,runtime.int("maxPendingEvents")).read().length())
      write("resilience-migration-result.json",JSONObject().put("legacyEventPreserved",true).put("imagePreserved",true).put("reimportDuplicates",0))
    } finally { store.clear() }
  }
}

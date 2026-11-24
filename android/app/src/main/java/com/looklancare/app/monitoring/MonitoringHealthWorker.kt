package com.looklancare.app.monitoring

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.SystemClock
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.looklancare.app.MainActivity
import com.looklancare.app.R
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Local health alerts keep working with screen off; no camera URLs/names on lock screen. */
class MonitoringHealthWorker(private val context: Context, private val events: CameraEventStore,
                            private val inputs: () -> List<CameraHealthInput>) : AutoCloseable {
  private val config = JSONObject(context.assets.open("monitoring/health.json").bufferedReader().use { it.readText() })
  private val policy = MonitoringHealthPolicy(HealthRules(config.getLong("startupGraceMs"), config.getLong("frameStaleMs"),
    config.getLong("analysisStaleMs"), config.getLong("unchangedContentMs"), config.getLong("problemDebounceMs"),
    config.getLong("recoveryDebounceMs"), config.getLong("notificationCooldownMs"), config.getDouble("queueNearFullRatio")))
  private val gate = HealthNotificationGate(config.getLong("notificationCooldownMs"))
  private val executor = Executors.newSingleThreadScheduledExecutor()
  private val closed = AtomicBoolean(false)
  private val lifecycle = Any()
  private val manager = NotificationManagerCompat.from(context)
  private val notificationId = config.getInt("notificationId")
  init {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
    val channel = NotificationChannel(config.getString("channelId"), "ปัญหาระบบเฝ้าระวัง", NotificationManager.IMPORTANCE_DEFAULT)
      .apply { description = "เตือนเมื่อกล้อง AI หรือคิวเหตุจำเป็นต้องตรวจสอบ"; setShowBadge(true) }
    context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }
    schedule()
  }
  private fun schedule() {
    if (!closed.get()) runCatching { executor.schedule({ inspect(); schedule() }, config.getLong("pollMs"), TimeUnit.MILLISECONDS) }
  }
  private fun inspect() {
    if (closed.get()) return
    try {
      val cameras = inputs()
      val queue = events.health()
      val now = SystemClock.elapsedRealtime()
      val problems = if (cameras.isEmpty()) { policy.clear(); emptySet() } else policy.evaluate(cameras, queue, now)
      synchronized(lifecycle) {
      if (closed.get()) return
      MonitoringState.publishHealth(problems, queue)
      if (problems.isEmpty()) { gate.shouldPost(problems, now); manager.cancel(notificationId); return }
      if (!gate.shouldPost(problems, now) || !manager.areNotificationsEnabled()) return
      val androidManager = context.getSystemService(NotificationManager::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && androidManager.getNotificationChannel(config.getString("channelId"))?.importance == NotificationManager.IMPORTANCE_NONE) return
      val messages = problems.map { problem -> when (problem.issue) {
        HealthIssue.CAMERA_UNAVAILABLE -> "รับภาพกล้องไม่ได้ การตรวจอาจขาดช่วง"
        HealthIssue.VIDEO_ENDED -> "วิดีโอสิ้นสุด ไม่มีภาพใหม่ให้ตรวจ"
        HealthIssue.IMAGE_UNCHANGED -> "ภาพไม่เปลี่ยน โปรดตรวจว่ากล้องยังส่งภาพสด"
        HealthIssue.AI_UNAVAILABLE -> "AI วิเคราะห์ภาพไม่ได้"
        HealthIssue.ANALYSIS_STALE -> "ภาพมาแต่ AI ไม่มีผลใหม่"
        HealthIssue.EVENT_SAVE_FAILED -> "บันทึกภาพเหตุไม่สำเร็จ โปรดตรวจพื้นที่เครื่อง"
        HealthIssue.QUEUE_NEAR_FULL -> "มีเหตุรอส่งจำนวนมาก ${queue.pending} เหตุ ตรวจอินเทอร์เน็ตและสถานะส่ง"
        HealthIssue.QUEUE_DISCARDED -> "มีเหตุในคิวเก่าถูกลบ ${queue.discarded} เหตุเพราะคิวเต็ม"
        HealthIssue.EVIDENCE_UNAVAILABLE -> "มี ${queue.withoutEvidence} เหตุที่ไม่มีภาพ แต่ข้อมูลเหตุยังเก็บไว้ โปรดตรวจพื้นที่เครื่อง"
      } }.distinct().joinToString("\n")
      val open = PendingIntent.getActivity(context, config.getInt("openAppRequestCode"),
        Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      val notification = NotificationCompat.Builder(context, config.getString("channelId"))
        .setSmallIcon(R.drawable.notification_icon).setContentTitle("ระบบเฝ้าระวังต้องตรวจสอบ")
        .setContentText("เปิด LookLanCare เพื่อตรวจสถานะกล้องและการส่งเหตุ")
        .setStyle(NotificationCompat.BigTextStyle().bigText(messages)).setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
        .setContentIntent(open).setOnlyAlertOnce(true).setAutoCancel(true).setCategory(NotificationCompat.CATEGORY_ERROR).build()
      if (!closed.get()) { manager.notify(notificationId, notification); gate.posted(problems, now) }
      }
    } catch (_: Exception) { /* Health inspection must not stop pose inference or event delivery. */ }
  }
  override fun close() = synchronized(lifecycle) {
    closed.set(true); executor.shutdownNow(); manager.cancel(notificationId)
    MonitoringState.clearHealth()
  }
}

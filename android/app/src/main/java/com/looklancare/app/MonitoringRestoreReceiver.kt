package com.looklancare.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.looklancare.app.monitoring.MonitorSessionStore
import org.json.JSONObject

class MonitoringRestoreReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
    val store = MonitorSessionStore(context)
    if (!store.status().optBoolean("desired")) return
    if (store.forRestore() == null) { notifyNeedsAppOpen(context, store); return }
    try {
      val resume = Intent(context, MonitoringForegroundService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(resume) else context.startService(resume)
    } catch (_: Exception) { notifyNeedsAppOpen(context, store) }
  }
  companion object {
  fun notifyNeedsAppOpen(context: Context, store: MonitorSessionStore) {
    store.markRecovery("needs_app_open")
    runCatching {
      val config = JSONObject(context.assets.open("monitoring/restart.json").bufferedReader().use { it.readText() })
      val manager = NotificationManagerCompat.from(context)
      if (!manager.areNotificationsEnabled()) return
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.getSystemService(NotificationManager::class.java)
        .createNotificationChannel(NotificationChannel(config.getString("channelId"), "เริ่มเฝ้าระวังอีกครั้ง", NotificationManager.IMPORTANCE_DEFAULT))
      val open = PendingIntent.getActivity(context, config.getInt("openAppRequestCode"), Intent(context, MainActivity::class.java)
        .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      manager.notify(config.getInt("notificationId"), NotificationCompat.Builder(context, config.getString("channelId"))
        .setSmallIcon(R.drawable.notification_icon).setContentTitle("เปิด LookLanCare เพื่อเริ่มเฝ้าระวังอีกครั้ง")
        .setContentText("ระบบยังไม่ยืนยันว่ากล้องและ AI กลับมาทำงานแล้ว").setContentIntent(open)
        .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setAutoCancel(true).build())
    }
  }
  }
}

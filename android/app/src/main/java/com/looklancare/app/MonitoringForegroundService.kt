package com.looklancare.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

class MonitoringForegroundService : Service() {
  override fun onCreate() {
    super.onCreate()
    createNotificationChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    startForeground(NOTIFICATION_ID, createNotification())
    getSharedPreferences(PREFERENCES_NAME, MODE_PRIVATE)
      .edit()
      .putBoolean(KEY_RUNNING, true)
      .apply()
    return START_STICKY
  }

  override fun onDestroy() {
    getSharedPreferences(PREFERENCES_NAME, MODE_PRIVATE)
      .edit()
      .putBoolean(KEY_RUNNING, false)
      .apply()
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val channel = NotificationChannel(
      CHANNEL_ID,
      "สถานะการเฝ้าระวัง",
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = "แสดงเมื่อ LookLanCare กำลังตรวจภาพกล้องเบื้องหลัง"
      setShowBadge(false)
    }
    getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
  }

  private fun createNotification(): Notification {
    val openAppIntent = Intent(this, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    val pendingIntent = PendingIntent.getActivity(
      this,
      OPEN_APP_REQUEST_CODE,
      openAppIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.notification_icon)
      .setContentTitle("LookLanCare กำลังเฝ้าระวัง")
      .setContentText("ปิดหน้าจอได้ ระบบจะตรวจภาพและแจ้งเมื่อพบเหตุผิดปกติ")
      .setContentIntent(pendingIntent)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .build()
  }

  companion object {
    const val PREFERENCES_NAME = "looklancare_monitoring"
    const val KEY_RUNNING = "is_running"
    private const val CHANNEL_ID = "looklancare-monitoring-status"
    private const val NOTIFICATION_ID = 4101
    private const val OPEN_APP_REQUEST_CODE = 4102
  }
}

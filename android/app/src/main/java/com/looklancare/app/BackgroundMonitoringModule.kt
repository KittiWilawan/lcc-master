package com.looklancare.app

import android.content.Intent
import android.os.Build
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class BackgroundMonitoringModule(
  private val context: ReactApplicationContext,
) : ReactContextBaseJavaModule(context) {
  override fun getName(): String = "BackgroundMonitoring"

  @ReactMethod
  fun start(promise: Promise) {
    try {
      val intent = Intent(context, MonitoringForegroundService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("BACKGROUND_MONITORING_START_FAILED", error)
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    try {
      context.stopService(Intent(context, MonitoringForegroundService::class.java))
      context.getSharedPreferences(MonitoringForegroundService.PREFERENCES_NAME, android.content.Context.MODE_PRIVATE)
        .edit()
        .putBoolean(MonitoringForegroundService.KEY_RUNNING, false)
        .apply()
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("BACKGROUND_MONITORING_STOP_FAILED", error)
    }
  }

  @ReactMethod
  fun isRunning(promise: Promise) {
    val running = context
      .getSharedPreferences(MonitoringForegroundService.PREFERENCES_NAME, android.content.Context.MODE_PRIVATE)
      .getBoolean(MonitoringForegroundService.KEY_RUNNING, false)
    promise.resolve(running)
  }
}

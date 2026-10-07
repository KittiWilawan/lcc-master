package com.looklancare.app.monitoring

import android.content.Context
import org.json.JSONObject

data class MonitoringConfig(val values: JSONObject) {
  fun int(key: String): Int = values.getInt(key).also { require(it > 0) { "Invalid $key" } }
  fun long(key: String): Long = values.getLong(key).also { require(it > 0) { "Invalid $key" } }
  fun probability(key: String): Float = values.getDouble(key).toFloat().also {
    require(it.isFinite() && it > 0f && it <= 1f) { "Invalid $key" }
  }

  companion object {
    fun load(context: Context): MonitoringConfig = MonitoringConfig(
      JSONObject(context.assets.open("monitoring/runtime.json").bufferedReader().use { it.readText() }),
    )
  }
}

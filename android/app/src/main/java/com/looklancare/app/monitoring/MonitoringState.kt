package com.looklancare.app.monitoring

import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

object MonitoringState {
  @Volatile var running = false
  @Volatile var observer: ((JSONObject) -> Unit)? = null
  val cameras = ConcurrentHashMap<String, JSONObject>()
  val previews = ConcurrentHashMap.newKeySet<String>()
  fun publish(cameraId: String, update: JSONObject) {
    cameras[cameraId] = update
    observer?.invoke(update)
  }
}

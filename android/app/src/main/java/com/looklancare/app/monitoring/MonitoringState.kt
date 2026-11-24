package com.looklancare.app.monitoring

import org.json.JSONObject
import org.json.JSONArray
import java.util.concurrent.ConcurrentHashMap

object MonitoringState {
  @Volatile var running = false
  @Volatile var configuredScope: MonitorScope? = null
  @Volatile var deliveryRefresh: (() -> Unit)? = null
  @Volatile var observer: ((JSONObject) -> Unit)? = null
  val cameras = ConcurrentHashMap<String, JSONObject>()
  val previews = ConcurrentHashMap.newKeySet<String>()
  @Volatile private var healthProblems: Set<HealthProblem> = emptySet()
  @Volatile private var queueHealth: QueueHealthInput? = null
  fun decorated(update: JSONObject): JSONObject {
    val result = JSONObject(update.toString())
    val id = result.optString("cameraId")
    result.put("healthIssues", JSONArray(healthProblems.filter { it.cameraId == null || it.cameraId == id }.map { it.issue.name }))
    queueHealth?.let { result.put("pendingEventCount", it.pending).put("queueCapacity", it.capacity).put("queueDiscardedEvents", it.discarded).put("eventsWithoutEvidence", it.withoutEvidence) }
    return result
  }
  fun publishHealth(problems: Set<HealthProblem>, queue: QueueHealthInput) {
    val changed = healthProblems != problems || queueHealth != queue
    healthProblems = problems.toSet(); queueHealth = queue
    if (changed) cameras.values.forEach { notifyObserver(decorated(it)) }
  }
  fun clearHealth() { healthProblems = emptySet(); queueHealth = null }
  fun publish(cameraId: String, update: JSONObject) {
    cameras[cameraId] = update
    notifyObserver(decorated(update))
  }
  private fun notifyObserver(update: JSONObject) { runCatching { observer?.invoke(update) } }
}

package com.looklancare.app.monitoring

enum class HealthIssue { CAMERA_UNAVAILABLE, VIDEO_ENDED, IMAGE_UNCHANGED, AI_UNAVAILABLE, ANALYSIS_STALE, EVENT_SAVE_FAILED, QUEUE_NEAR_FULL, QUEUE_DISCARDED, EVIDENCE_UNAVAILABLE }
data class HealthRules(val startupGraceMs: Long, val frameStaleMs: Long, val analysisStaleMs: Long,
                       val unchangedContentMs: Long, val problemDebounceMs: Long, val recoveryDebounceMs: Long,
                       val notificationCooldownMs: Long, val queueNearFullRatio: Double) {
  init { require(listOf(startupGraceMs, frameStaleMs, analysisStaleMs, unchangedContentMs, problemDebounceMs,
    recoveryDebounceMs, notificationCooldownMs).all { it > 0 }); require(queueNearFullRatio > 0 && queueNearFullRatio < 1) }
}
data class CameraHealthInput(val id: String, val startedAt: Long, val state: String,
                             val frameAt: Long, val analysisAt: Long, val contentAt: Long, val saveFailed: Boolean)
data class QueueHealthInput(val pending: Int, val capacity: Int, val discarded: Int, val withoutEvidence: Int = 0) {
  init { require(pending >= 0 && capacity > 0 && discarded >= 0 && withoutEvidence >= 0) }
}
data class HealthProblem(val cameraId: String?, val issue: HealthIssue)

/** Monotonic times and real decoder/inference progress, independent of JS and UI. */
class MonitoringHealthPolicy(private val rules: HealthRules) {
  private data class Boundary(var since: Long, var active: Boolean = false, var recoveringAt: Long? = null)
  private val boundaries = mutableMapOf<HealthProblem, Boundary>()
  private var previousTime = 0L
  fun evaluate(cameras: List<CameraHealthInput>, queue: QueueHealthInput, now: Long): Set<HealthProblem> {
    require(now > 0)
    if (now < previousTime) boundaries.clear()
    previousTime = now
    val present = cameras.map { it.id }.toSet()
    boundaries.keys.removeAll { it.cameraId != null && it.cameraId !in present }
    val observed = mutableSetOf<HealthProblem>()
    cameras.forEach { camera ->
      val runningLongEnough = now - camera.startedAt >= rules.startupGraceMs
      val frameStale = camera.frameAt > 0 && now - camera.frameAt > rules.frameStaleMs
      when {
        camera.state == "ended" -> observed.add(HealthProblem(camera.id, HealthIssue.VIDEO_ENDED))
        frameStale || (camera.frameAt == 0L && runningLongEnough) -> observed.add(HealthProblem(camera.id, HealthIssue.CAMERA_UNAVAILABLE))
        camera.state == "ai_error" -> observed.add(HealthProblem(camera.id, HealthIssue.AI_UNAVAILABLE))
        camera.frameAt > 0 && ((camera.analysisAt > 0 && now - camera.analysisAt > rules.analysisStaleMs) ||
          (camera.analysisAt == 0L && runningLongEnough)) -> observed.add(HealthProblem(camera.id, HealthIssue.ANALYSIS_STALE))
        camera.contentAt > 0 && now - camera.contentAt > rules.unchangedContentMs -> observed.add(HealthProblem(camera.id, HealthIssue.IMAGE_UNCHANGED))
      }
      if (camera.saveFailed) observed.add(HealthProblem(camera.id, HealthIssue.EVENT_SAVE_FAILED))
    }
    if (queue.pending >= kotlin.math.ceil(queue.capacity * rules.queueNearFullRatio).toInt()) observed.add(HealthProblem(null, HealthIssue.QUEUE_NEAR_FULL))
    if (queue.discarded > 0 && queue.pending > 0) observed.add(HealthProblem(null, HealthIssue.QUEUE_DISCARDED))
    if (queue.withoutEvidence > 0) observed.add(HealthProblem(null, HealthIssue.EVIDENCE_UNAVAILABLE))
    observed.forEach { problem ->
      val boundary = boundaries.getOrPut(problem) { Boundary(now) }
      boundary.recoveringAt = null
      if (now - boundary.since >= rules.problemDebounceMs) boundary.active = true
    }
    boundaries.entries.removeAll { (problem, boundary) ->
      if (problem in observed) false else if (!boundary.active) true else {
        if (boundary.recoveringAt == null) boundary.recoveringAt = now
        now - checkNotNull(boundary.recoveringAt) >= rules.recoveryDebounceMs
      }
    }
    return boundaries.filterValues { it.active }.keys.toSet()
  }
  fun clear() { boundaries.clear(); previousTime = 0 }
}

/** One aggregate alert; unchanged failures do not alert repeatedly. */
class HealthNotificationGate(private val cooldownMs: Long) {
  private var last: Set<HealthProblem> = emptySet()
  private var sentAt: Long? = null
  fun shouldPost(problems: Set<HealthProblem>, now: Long): Boolean {
    if (problems.isEmpty()) { last = emptySet(); return false }
    if (problems == last) return false
    val previous = sentAt
    if (previous != null && now >= previous && now - previous < cooldownMs) return false
    return true
  }
  fun posted(problems: Set<HealthProblem>, now: Long) { last = problems.toSet(); sentAt = now }
}

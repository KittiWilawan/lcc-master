package com.looklancare.app.enrollment

import kotlin.math.sqrt

/** Ephemeral continuity evidence. Never identifies a name or verifies an identity document. */
data class FaceEvidence(val embedding: DoubleArray, val liveScore: Double?) {
  override fun toString() = "FaceEvidence(redacted)"
}
data class FaceAssuranceRules(val similarity: Double, val anchorFrames: Int, val liveThreshold: Double,
  val liveFrames: Int, val liveMaxGapMs: Long)

object FaceVectors {
  fun normalized(value: DoubleArray): DoubleArray? {
    if (value.isEmpty() || value.any { !it.isFinite() }) return null
    val norm = sqrt(value.sumOf { it * it })
    if (!norm.isFinite() || norm <= 0) return null
    return DoubleArray(value.size) { value[it] / norm }
  }
  fun cosine(first: DoubleArray, second: DoubleArray): Double? {
    if (first.size != second.size) return null
    val a = normalized(first) ?: return null
    val b = normalized(second) ?: return null
    return a.indices.sumOf { a[it] * b[it] }.coerceIn(-1.0, 1.0)
  }
}

class FaceAssurance(private val rules: FaceAssuranceRules) {
  private val anchors = mutableListOf<DoubleArray>()
  private var liveCount = 0
  private var lastLive: Long? = null
  val anchored: Boolean get() = anchors.size >= rules.anchorFrames
  init {
    require(rules.similarity in -1.0..1.0 && rules.anchorFrames > 0 && rules.liveThreshold in 0.0..1.0)
    require(rules.liveFrames > 0 && rules.liveMaxGapMs > 0)
  }
  fun clear() { anchors.forEach { it.fill(0.0) }; anchors.clear(); liveCount = 0; lastLive = null }
  fun interrupt() { liveCount = 0; lastLive = null }
  fun assess(evidence: FaceEvidence?, front: Boolean, now: Long): String? {
    val vector = evidence?.embedding?.let(FaceVectors::normalized) ?: return "checking_face"
    if (anchors.any { (FaceVectors.cosine(it, vector) ?: -1.0) < rules.similarity }) return "identity_changed"
    // Anchor the original frontal face only. Later frames cannot drift or replace the template.
    if (!anchored) {
      if (!front) return "look_front"
      val score = evidence.liveScore
      if (score == null || !score.isFinite() || score !in 0.0..1.0) { interrupt(); return "checking_live" }
      if (score < rules.liveThreshold) { interrupt(); return "suspected_spoof" }
      if (lastLive != null && now - lastLive!! > rules.liveMaxGapMs) liveCount = 0
      lastLive = now; liveCount++
      if (liveCount < rules.liveFrames) return "checking_live"
      anchors.add(vector)
      if (!anchored) return "checking_face"
    }
    // Every frontal frame must still pass the passive model, including the captured frame.
    if (front) {
      val score = evidence.liveScore
      if (score == null || !score.isFinite() || score !in 0.0..1.0) return "checking_live"
      if (score < rules.liveThreshold) return "suspected_spoof"
    }
    return null
  }
}

data class FaceChallengeRules(val turnHoldMs: Long, val returnHoldMs: Long, val timeoutMs: Long,
  val minTurnDegrees: Double, val maxTurnDegrees: Double)

/** Randomized action order is supplied by infrastructure; this class has no RNG or camera dependency. */
class FaceChallenge(private val rules: FaceChallengeRules, private val actions: List<String>, private val motion: ScanRules) {
  private var index = 0
  private var returning = false
  private var started: Long? = null
  private var stable: Long? = null
  private var open = false
  private var closed: Long? = null
  val complete: Boolean get() = index >= actions.size
  val expectsBlink: Boolean get() = !complete && !returning && actions[index] == "blink"
  val awaitingBlinkClosure: Boolean get() = expectsBlink && open
  init {
    require(actions.isNotEmpty() && actions.toSet().size == actions.size && actions.contains("blink"))
    require(actions.all { it == "blink" || it == "left" || it == "right" })
    require(rules.turnHoldMs > 0 && rules.returnHoldMs > 0 && rules.timeoutMs > rules.turnHoldMs)
    require(rules.minTurnDegrees > 0 && rules.maxTurnDegrees >= rules.minTurnDegrees)
  }
  fun interrupt() { stable = null; open = false; closed = null }
  fun next(face: FaceObservation, now: Long, front: Boolean): String? {
    if (complete) return null
    val start = started ?: now.also { started = it }
    if (now - start > rules.timeoutMs) return "challenge_timeout"
    if (returning) {
      if (!front || face.blinkLeft > motion.blinkOpen || face.blinkRight > motion.blinkOpen) {
        interrupt(); return "look_front"
      }
      val held = stable ?: now.also { stable = it }
      if (now - held < rules.returnHoldMs) return "look_front"
      returning = false; index++; interrupt()
      return if (complete) null else next(face, now, front)
    }
    val action = actions[index]
    if (action == "blink") {
      if (!front) { interrupt(); return "look_front" }
      if (face.blinkLeft <= motion.blinkOpen && face.blinkRight <= motion.blinkOpen) {
        val since = closed
        if (open && since != null && now - since in motion.blinkMinMs..motion.blinkMaxMs) {
          returning = true; interrupt(); return "look_front"
        }
        closed = null; open = true
      } else if (open && face.blinkLeft >= motion.blinkClosed && face.blinkRight >= motion.blinkClosed) {
        if (closed == null) closed = now
        if (now - closed!! > motion.blinkMaxMs) interrupt()
      }
      return if (closed == null) "blink" else "open_eyes"
    }
    val range = if (action == "left") rules.minTurnDegrees..rules.maxTurnDegrees else -rules.maxTurnDegrees..-rules.minTurnDegrees
    if (face.yaw !in range) { stable = null; return "challenge_$action" }
    val held = stable ?: now.also { stable = it }
    if (now - held >= rules.turnHoldMs) { returning = true; interrupt(); return "look_front" }
    return "challenge_$action"
  }
}

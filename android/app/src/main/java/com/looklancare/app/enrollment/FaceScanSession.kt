package com.looklancare.app.enrollment

import kotlin.math.abs
import kotlin.math.hypot

/** Domain state machine. No camera, Android, model, network or stored identity dependency. */
data class FaceObservation(
  val count: Int, val left: Double = 0.0, val top: Double = 0.0, val width: Double = 0.0, val height: Double = 0.0,
  val yaw: Double = 0.0, val pitch: Double = 0.0, val roll: Double = 0.0,
  val blinkLeft: Double = 0.0, val blinkRight: Double = 0.0, val qualityIssue: String? = null,
  val evidence: FaceEvidence? = null,
)
data class ScanPose(val key: String, val minYaw: Double, val maxYaw: Double)
data class ScanRules @JvmOverloads constructor(
  val minWidth: Double, val maxWidth: Double, val centerX: Double, val centerY: Double,
  val toleranceX: Double, val toleranceY: Double, val maxPitch: Double, val maxRoll: Double,
  val stableMs: Long, val maxGapMs: Long, val lostMs: Long, val maxCenterJump: Double,
  val blinkOpen: Double, val blinkClosed: Double, val blinkMinMs: Long, val blinkMaxMs: Long,
  val maxHeight: Double, val edgeMargin: Double, val multipleConfirmFrames: Int,
  val blinkTransitionMs: Long = 0,
)
data class ScanDecision(val hint: String, val pose: String, val progress: Double = 0.0, val capture: String? = null, val reset: Boolean = false)

object FaceAlignment {
  fun issue(face: FaceObservation, rules: ScanRules): String? {
    val x = face.left + face.width / 2; val y = face.top + face.height / 2
    return when {
      !listOf(face.left, face.top, face.width, face.height, face.yaw, face.pitch, face.roll, face.blinkLeft, face.blinkRight).all { it.isFinite() } -> "no_face"
      face.width <= 0 || face.height <= 0 || face.left < 0 || face.top < 0 || face.left + face.width > 1 || face.top + face.height > 1 -> "cropped"
      face.width > rules.maxWidth || face.height > rules.maxHeight -> "near"
      face.left < rules.edgeMargin || face.top < rules.edgeMargin || face.left + face.width > 1 - rules.edgeMargin || face.top + face.height > 1 - rules.edgeMargin -> "cropped"
      face.qualityIssue != null -> face.qualityIssue
      face.width < rules.minWidth -> "far"
      abs(x - rules.centerX) > rules.toleranceX || abs(y - rules.centerY) > rules.toleranceY -> "center"
      abs(face.pitch) > rules.maxPitch || abs(face.roll) > rules.maxRoll -> "level"
      else -> null
    }
  }
}

class FaceScanSession(private val rules: ScanRules, private val poses: List<ScanPose>, private val front: ScanPose = poses.first(),
  assuranceRules: FaceAssuranceRules? = null, private val challengeFactory: (() -> FaceChallenge)? = null) : AutoCloseable {
  init { require(poses.isNotEmpty() && rules.stableMs > 0 && rules.lostMs > rules.maxGapMs && rules.multipleConfirmFrames > 0) }
  private var index = 0
  private var phase = "align"
  private var stableSince: Long? = null
  private var lastFrame: Long? = null
  private var lastSeen: Long? = null
  private var center: Pair<Double, Double>? = null
  private var closedSince: Long? = null
  private var eyesWereOpen = false
  private var multipleFrames = 0
  private var multipleConfirmed = false
  private var blinkTransitionSince: Long? = null
  private val assurance = assuranceRules?.let { FaceAssurance(it) }
  private var challenge = challengeFactory?.invoke()
  val complete: Boolean get() = index >= poses.size
  override fun close() { assurance?.clear() }
  fun restart() {
    index = 0; phase = "align"; stableSince = null; lastFrame = null; lastSeen = null; center = null; closedSince = null; eyesWereOpen = false
    multipleFrames = 0; multipleConfirmed = false
    blinkTransitionSince = null
    assurance?.clear(); challenge = challengeFactory?.invoke()
  }
  private fun interruptAction() {
    blinkTransitionSince = null
    stableSince = null; closedSince = null; eyesWereOpen = false; assurance?.interrupt(); challenge?.interrupt()
  }

  fun next(face: FaceObservation, now: Long): ScanDecision {
    if (complete) return ScanDecision("complete", poses.last().key, 1.0)
    val previousFrame = lastFrame
    require(previousFrame == null || now > previousFrame) { "Frame timestamps must increase" }
    lastFrame = now
    if (face.qualityIssue == "camera_stalled") {
      restart(); lastFrame = now
      return ScanDecision("camera_stalled", poses.first().key, reset = true)
    }
    val stale = previousFrame != null && now - previousFrame > rules.lostMs
    if (stale || (lastSeen != null && now - lastSeen!! > rules.lostMs)) {
      restart(); lastFrame = now
      return ScanDecision("reset", poses.first().key, reset = true)
    }
    if (previousFrame != null && now - previousFrame > rules.maxGapMs) {
      interruptAction(); multipleFrames = 0; multipleConfirmed = false
    }
    if (face.count != 1) {
      if (face.count > 1) {
        interruptAction()
        if (multipleConfirmed) return ScanDecision("multiple", poses.first().key)
        multipleFrames++
        // Never capture an uncertain frame. Only destruction of existing drafts is debounced.
        if (multipleFrames < rules.multipleConfirmFrames) return ScanDecision("checking_scene", poses[index].key)
        restart(); lastFrame = now
        multipleConfirmed = true
        return ScanDecision("multiple", poses.first().key, reset = true)
      }
      multipleFrames = 0; multipleConfirmed = false
      interruptAction()
      return ScanDecision(if (face.count > 1) "multiple" else "no_face", poses[index].key)
    }
    multipleFrames = 0; multipleConfirmed = false
    if (!listOf(face.left, face.top, face.width, face.height, face.yaw, face.pitch, face.roll, face.blinkLeft, face.blinkRight).all { it.isFinite() }) {
      restart(); lastFrame = now
      return ScanDecision("no_face", poses.first().key, reset = true)
    }
    val x = face.left + face.width / 2; val y = face.top + face.height / 2
    val previousCenter = center
    if (previousCenter != null && hypot(x - previousCenter.first, y - previousCenter.second) > rules.maxCenterJump) {
      restart(); lastFrame = now; lastSeen = now; center = x to y
      return ScanDecision("reset", poses.first().key, reset = true)
    }
    center = x to y; lastSeen = now
    val expectingBlink = (assurance == null || assurance.anchored) &&
      (phase == "blink" || (phase != "capture" && challenge?.expectsBlink == true))
    val isFront = face.yaw in front.minYaw..front.maxYaw
    val openedBefore = if (challenge != null) challenge!!.awaitingBlinkClosure else eyesWereOpen
    val partialClosure = face.blinkLeft > rules.blinkOpen && face.blinkRight > rules.blinkOpen &&
      !(face.blinkLeft >= rules.blinkClosed && face.blinkRight >= rules.blinkClosed)
    val transitionalTexture = expectingBlink && openedBefore && isFront && face.qualityIssue == "eyes_blur" && partialClosure
    if (!transitionalTexture) blinkTransitionSince = null
    val transitionAllowed = transitionalTexture && rules.blinkTransitionMs > 0 &&
      now - (blinkTransitionSince ?: now.also { blinkTransitionSince = it }) <= rules.blinkTransitionMs
    val closedEyeTexture = expectingBlink && face.qualityIssue == "eyes_blur" &&
      face.blinkLeft >= rules.blinkClosed && face.blinkRight >= rules.blinkClosed
    val issue = FaceAlignment.issue(if (closedEyeTexture || transitionAllowed) face.copy(qualityIssue = null) else face, rules)
    if (issue != null) {
      if (issue == "occluded_eyes" || issue == "occluded_lower" || issue == "eyes_dark" || issue == "lower_dark" || issue == "features_missing") {
        restart(); lastFrame = now; lastSeen = now; center = x to y
        return ScanDecision(issue, poses.first().key, reset = true)
      }
      interruptAction(); return ScanDecision(issue, poses[index].key)
    }
    val assuranceIssue = assurance?.assess(face.evidence, isFront, now)
    if (assuranceIssue != null) {
      if (assuranceIssue == "identity_changed" || assuranceIssue == "suspected_spoof") {
        restart(); lastFrame = now
        return ScanDecision(assuranceIssue, poses.first().key, reset = true)
      }
      stableSince = null; closedSince = null; eyesWereOpen = false; challenge?.interrupt()
      return ScanDecision(assuranceIssue, poses[index].key)
    }
    if (phase != "capture" && challenge != null) {
      val instruction = challenge!!.next(face, now, isFront)
      if (instruction == "challenge_timeout") {
        restart(); lastFrame = now; return ScanDecision(instruction, poses.first().key, reset = true)
      }
      if (instruction != null) return ScanDecision(instruction, poses[index].key)
      phase = "capture"; stableSince = null
    }
    // A front-facing action check precedes every session, including a single side replacement.
    if (phase != "capture") {
      if (face.yaw !in front.minYaw..front.maxYaw) {
        stableSince = null; closedSince = null; eyesWereOpen = false
        return ScanDecision("look_front", poses[index].key)
      }
      if (phase == "align") {
        if (face.blinkLeft > rules.blinkOpen || face.blinkRight > rules.blinkOpen) { stableSince = null; return ScanDecision("open_eyes", poses[index].key) }
        val start = stableSince ?: now.also { stableSince = it }
        val progress = ((now - start).toDouble() / rules.stableMs).coerceIn(0.0, 1.0)
        if (progress < 1) return ScanDecision("hold", poses[index].key, progress)
        phase = "blink"; stableSince = null; eyesWereOpen = true
      }
      if (face.blinkLeft >= rules.blinkClosed && face.blinkRight >= rules.blinkClosed && eyesWereOpen) {
        if (closedSince == null) closedSince = now
        if (now - closedSince!! > rules.blinkMaxMs) { closedSince = null; eyesWereOpen = false }
        return ScanDecision("open_eyes", poses[index].key)
      }
      if (face.blinkLeft <= rules.blinkOpen && face.blinkRight <= rules.blinkOpen) {
        val closed = closedSince
        if (closed != null && now - closed in rules.blinkMinMs..rules.blinkMaxMs) {
          phase = "capture"; stableSince = null; closedSince = null
        } else { closedSince = null; eyesWereOpen = true }
      }
      if (phase != "capture") return ScanDecision("blink", poses[index].key)
    }
    val target = poses[index]
    // Movement observations can never bypass the strict quality check on a stored reference.
    if (face.qualityIssue != null) { stableSince = null; return ScanDecision(face.qualityIssue, target.key) }
    if (face.yaw !in target.minYaw..target.maxYaw) { stableSince = null; return ScanDecision("turn_${target.key}", target.key) }
    if (face.blinkLeft > rules.blinkOpen || face.blinkRight > rules.blinkOpen) { stableSince = null; return ScanDecision("open_eyes", target.key) }
    val start = stableSince ?: now.also { stableSince = it }
    val progress = ((now - start).toDouble() / rules.stableMs).coerceIn(0.0, 1.0)
    if (progress < 1) return ScanDecision("hold", target.key, progress)
    index++; stableSince = null
    return ScanDecision(if (complete) "complete" else "turn_${poses[index].key}", if (complete) target.key else poses[index].key,
      if (complete) 1.0 else 0.0, capture = target.key)
  }
}

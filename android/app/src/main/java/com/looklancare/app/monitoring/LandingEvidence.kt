package com.looklancare.app.monitoring

import kotlin.math.abs
import kotlin.math.hypot

data class LandingPolicy(
  val chains: List<List<Int>>, val visibility: Float, val windowMs: Long, val gapMs: Long,
  val minScaleRatio: Float, val maxTravel: Float, val proneCosine: Float,
  val shoulderDrop: Float, val centerDrop: Float, val boxDrop: Float, val maxFootShift: Float,
  val clearTorsoVisibility: Float, val partialLegVisibility: Float, val uprightReferenceCount: Int,
  val standingCosine: Float, val stableFootShift: Float
) {
  init {
    require(chains.isNotEmpty() && chains.all { it.size >= 3 && it.all { index -> index >= 0 } })
    require(uprightReferenceCount > 0 && standingCosine in proneCosine..1f && stableFootShift in 0f..maxFootShift)
    require(windowMs >= gapMs && gapMs > 0 && visibility in 0f..1f)
    require(clearTorsoVisibility in visibility..1f && partialLegVisibility > 0f && partialLegVisibility < visibility)
    require(minScaleRatio > 0 && minScaleRatio <= 1 && proneCosine > 0 && proneCosine < 1)
    require(maxTravel > 0 && shoulderDrop > 0 && centerDrop > 0 && boxDrop > 0 && boxDrop < 1 && maxFootShift > 0)
  }
}

/** Anatomical corroboration for an already suspected fall, scoped to a single person. */
class LandingEvidence @JvmOverloads constructor(private val policy: LandingPolicy, private val restEvidence: RestingPoseEvidence? = null) {
  var deferForRest = false
    private set
  private data class Sample(val time: Long, val shoulder: Float, val center: Float, val x: Float,
    val length: Float, val cosine: Float, val top: Float, val bottom: Float, val width: Float, val clearTorso: Boolean)
  private val history = ArrayDeque<Sample>()
  var clearCollapse = false
    private set
  fun clear() {
    history.clear()
    restEvidence?.clear()
    deferForRest = false
    clearCollapse = false
  }

  fun observe(points: List<PosePoint>, bounds: PoseBounds, aspect: Float, time: Long): Boolean {
    clearCollapse = false
    history.lastOrNull()?.let { if (time <= it.time || time - it.time > policy.gapMs) history.clear() }
    while (history.isNotEmpty() && time - history.first().time > policy.windowMs) history.removeFirst()
    deferForRest = restEvidence?.shouldDefer(points, aspect, time) ?: false
    val fullChain = policy.chains.maxByOrNull { chain ->
      minOf(points[chain[0]].visibility, points[chain[1]].visibility, points[chain[2]].visibility)
    } ?: return false
    val fullPose = fullChain.take(3).all { points[it].visibility >= policy.visibility }
    val chain = if (fullPose) fullChain else {
      if (history.isEmpty() || policy.chains.any { minOf(points[it[0]].visibility, points[it[1]].visibility) < policy.clearTorsoVisibility }) return false
      if (policy.chains.none { it.size >= 4 && minOf(points[it[2]].visibility, points[it[3]].visibility) >= policy.partialLegVisibility }) return false
      policy.chains.maxBy { minOf(points[it[0]].visibility, points[it[1]].visibility) }
    }
    val shoulder = points[chain[0]]
    val hip = points[chain[1]]
    val dy = hip.y - shoulder.y
    val length = hypot((hip.x - shoulder.x) * aspect, dy)
    if (length <= 0f || !length.isFinite()) return false
    val current = Sample(time, shoulder.y, (shoulder.y + hip.y) / 2, (shoulder.x + hip.x) * aspect / 2,
      length, dy / length, bounds.top, bounds.bottom, (bounds.right - bounds.left) * aspect,
      fullPose && minOf(shoulder.visibility, hip.visibility) >= policy.clearTorsoVisibility)
    // Sitting or bending can resemble a fall while the torso remains upright.
    // Require the same descent relative to multiple distinct earlier frames in that case.
    val requiredReferences = if (current.cosine > policy.proneCosine) policy.uprightReferenceCount else 1
    var references = 0
    for (previous in history) {
      val sameScale = minOf(length, previous.length) >= policy.minScaleRatio * maxOf(length, previous.length)
      val nearby = abs(current.x - previous.x) <= policy.maxTravel * previous.length
      val bothProne = abs(current.cosine) <= policy.proneCosine && abs(previous.cosine) <= policy.proneCosine
      val descended = current.top > previous.top &&
        current.shoulder - previous.shoulder >= policy.shoulderDrop * previous.length &&
        current.center - previous.center >= policy.centerDrop * previous.length
      val height = previous.bottom - previous.top
      val compressed = current.bottom - current.top <= (1 - policy.boxDrop) * height &&
        abs(current.bottom - previous.bottom) <= policy.maxFootShift * height
      val startedUpright = previous.cosine > policy.proneCosine
      val tiltedOnLanding = height > previous.width && current.cosine <= policy.proneCosine &&
        current.top - previous.top >= policy.boxDrop * height
      val landing = if (fullPose) bothProne || (compressed && (startedUpright || tiltedOnLanding))
        else startedUpright && compressed && tiltedOnLanding && abs(current.cosine) <= policy.proneCosine
      if (!sameScale || !nearby || !descended || !landing) continue
      references++
      if (current.clearTorso && previous.clearTorso && previous.cosine > policy.standingCosine &&
        abs(current.cosine) <= policy.proneCosine && tiltedOnLanding && compressed &&
        current.width > current.bottom - current.top &&
        abs(current.bottom - previous.bottom) <= policy.stableFootShift * height) clearCollapse = true
      if (references >= requiredReferences && clearCollapse) break
    }
    // An occluded landing may finish a fall, but cannot start another person's descent history.
    if (fullPose) history.addLast(current)
    return references >= requiredReferences
  }
}

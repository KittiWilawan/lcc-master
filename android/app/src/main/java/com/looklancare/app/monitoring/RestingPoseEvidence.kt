package com.looklancare.app.monitoring

import kotlin.math.abs
import kotlin.math.hypot

data class RestingPosePolicy(
  val minTorsoLength: Double,
  val foldedKnee: Double,
  val extendedKnee: Double,
  val minHipDrop: Double,
  val minSamples: Int,
  val minRestFraction: Double,
  val horizontalSamples: Int,
  val maxHipSpread: Double,
  val shrinkRatio: Double,
) {
  init {
    require(minTorsoLength > 0 && minHipDrop > 0 && minSamples > 0)
    require(foldedKnee.isFinite() && extendedKnee.isFinite() && foldedKnee < extendedKnee)
    require(minRestFraction > 0 && minRestFraction <= 1)
    require(horizontalSamples > 1 && maxHipSpread > 0 && shrinkRatio > 0 && shrinkRatio < 1)
  }
}

/** Per-person evidence that a resting body has not begun a new descent. */
class RestingPoseEvidence(private val landing: LandingPolicy, private val policy: RestingPosePolicy) {
  private data class Sample(val time: Long, val hip: Double, val length: Double, val resting: Boolean, val extendedOnTilt: Boolean)
  private val history = ArrayDeque<Sample>()

  private val horizontalHistory = ArrayDeque<Sample>()

  fun clear() {
    history.clear()
    horizontalHistory.clear()
  }

  private fun missingTorso(): Boolean {
    horizontalHistory.clear()
    return false
  }

  private fun heldHorizontal(hip: Double, length: Double, tilted: Boolean): Boolean {
    if (horizontalHistory.size < policy.horizontalSamples) return false
    val torso = horizontalHistory.sumOf { it.length } / horizontalHistory.size
    val highest = horizontalHistory.minOf { it.hip }
    val lowest = horizontalHistory.maxOf { it.hip }
    val margin = policy.maxHipSpread * torso
    if (lowest - highest > margin) return false
    return (tilted && hip <= highest + margin) ||
      (length < policy.shrinkRatio * torso && hip <= lowest + margin)
  }

  fun shouldDefer(points: List<PosePoint>, aspect: Float, time: Long): Boolean {
    val last = history.lastOrNull()
    if (last != null && (time <= last.time || time - last.time > landing.gapMs)) clear()
    while (history.isNotEmpty() && time - history.first().time > landing.windowMs) history.removeFirst()

    while (horizontalHistory.isNotEmpty() && time - horizontalHistory.first().time > landing.windowMs) {
      horizontalHistory.removeFirst()
    }
    val chain = landing.chains.maxBy { minOf(points[it[0]].visibility, points[it[1]].visibility) }
    val shoulder = points[chain[0]]
    val hip = points[chain[1]]
    if (minOf(shoulder.visibility, hip.visibility) < landing.visibility) return missingTorso()
    val dy = hip.y.toDouble() - shoulder.y
    val length = hypot((hip.x.toDouble() - shoulder.x) * aspect, dy)
    if (!length.isFinite() || length < policy.minTorsoLength) return missingTorso()
    val cosine = dy / length
    val knee = points[chain[2]].takeIf { it.visibility >= landing.visibility }?.let { (it.y.toDouble() - hip.y) / length }
    val folded = knee?.let { it <= policy.foldedKnee } ?: (cosine <= 0)
    val priorRest = history.count { it.resting }
    val first = history.firstOrNull()
    val defer = folded && first != null && priorRest >= policy.minSamples &&
      priorRest >= policy.minRestFraction * history.size && history.none { it.extendedOnTilt } &&
      (maxOf(hip.y.toDouble(), history.maxOf { it.hip }) - first.hip) / first.length < policy.minHipDrop

    val tilted = abs(cosine) <= landing.proneCosine
    val alreadyHorizontal = heldHorizontal(hip.y.toDouble(), length, tilted)
    val sample = Sample(time, hip.y.toDouble(), length, tilted || (knee != null && knee <= policy.foldedKnee),
      tilted && knee != null && knee > policy.extendedKnee)
    history.addLast(sample)
    if (tilted) {
      if (horizontalHistory.size == policy.horizontalSamples) horizontalHistory.removeFirst()
      horizontalHistory.addLast(sample)
    } else {
      horizontalHistory.clear()
    }
    return defer || alreadyHorizontal
  }
}


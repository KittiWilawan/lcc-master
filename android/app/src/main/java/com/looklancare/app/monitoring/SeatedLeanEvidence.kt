package com.looklancare.app.monitoring

import kotlin.math.hypot

data class SeatedLeanPolicy(
  val minTorso: Double, val uprightCosine: Double, val tiltCosine: Double,
  val shoulderDrop: Double, val hipToShoulder: Double, val hipDrop: Double, val foldedKnee: Double,
  val minReferences: Int, val originalCeiling: Double, val verifierCeiling: Double, val continuationDrop: Double,
) {
  init {
    require(minTorso > 0 && tiltCosine in -1.0..1.0 && uprightCosine > tiltCosine && uprightCosine <= 1)
    require(shoulderDrop > 0 && hipToShoulder in 0.0..1.0 && hipDrop > 0 && foldedKnee.isFinite())
    require(minReferences > 1 && originalCeiling in 0.0..1.0 && verifierCeiling in 0.0..1.0 && continuationDrop > 0)
  }
}

/** Distinguishes a supported forward bend or recline from a continuing descent on the same track. */
class SeatedLeanEvidence(private val landing: LandingPolicy, private val policy: SeatedLeanPolicy) {
  private data class Pose(val time: Long, val hip: Double, val shoulder: Double, val length: Double,
                          val cosine: Double, val knee: Double?)
  private val history = ArrayDeque<Pose>()
  private var lastLean: Pose? = null

  fun clear() {
    history.clear()
    lastLean = null
  }

  private fun pose(points: List<PosePoint>, aspect: Float, time: Long): Pose? {
    val side = landing.chains.maxBy { minOf(points[it[0]].visibility, points[it[1]].visibility) }
    val shoulder = points[side[0]]
    val hip = points[side[1]]
    if (minOf(shoulder.visibility, hip.visibility) < landing.visibility) return null
    val dy = hip.y.toDouble() - shoulder.y
    val length = hypot((hip.x.toDouble() - shoulder.x) * aspect, dy)
    if (!length.isFinite() || length < policy.minTorso) return null
    val knee = points[side[2]].takeIf { it.visibility >= landing.visibility }?.let { (it.y.toDouble() - hip.y) / length }
    return Pose(time, hip.y.toDouble(), shoulder.y.toDouble(), length, dy / length, knee)
  }

  private fun median(samples: List<Pose>, value: (Pose) -> Double): Double {
    val sorted = samples.map(value).sorted()
    return (sorted[(sorted.size - 1) / 2] + sorted[sorted.size / 2]) / 2
  }

  private fun isLean(now: Pose): Boolean {
    if (now.cosine > policy.tiltCosine) return false
    val seated = history.filter { it.cosine >= policy.uprightCosine && it.knee != null }
    if (seated.size < policy.minReferences || seated.none { it.knee!! <= policy.foldedKnee }) return false
    val length = median(seated) { it.length }
    val shoulderDrop = (now.shoulder - median(seated) { it.shoulder }) / length
    val hipDrop = (now.hip - median(seated) { it.hip }) / length
    return shoulderDrop >= policy.shoulderDrop && hipDrop <= policy.hipDrop && hipDrop <= policy.hipToShoulder * shoulderDrop
  }

  fun observe(points: List<PosePoint>, aspect: Float, time: Long, original: Double?, verifier: Double?): Boolean {
    val last = history.lastOrNull()
    if (last != null && (time <= last.time || time - last.time > landing.gapMs)) clear()
    while (history.isNotEmpty() && time - history.first().time > landing.windowMs) history.removeFirst()
    val now = pose(points, aspect, time) ?: run { clear(); return false }
    val prior = lastLean
    val lean = original != null && original < policy.originalCeiling && verifier != null &&
      verifier < policy.verifierCeiling && isLean(now)
    val continuation = verifier != null && verifier < policy.verifierCeiling && prior != null && time > prior.time && time - prior.time <= landing.gapMs &&
      now.cosine <= policy.tiltCosine && now.hip - prior.hip <= policy.continuationDrop * prior.length
    lastLean = if (lean) now else null
    history.addLast(now)
    return lean || continuation
  }
}

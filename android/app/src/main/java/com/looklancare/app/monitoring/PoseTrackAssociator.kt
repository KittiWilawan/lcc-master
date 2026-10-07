package com.looklancare.app.monitoring

import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.ln

data class PoseBounds(val left: Float, val top: Float, val right: Float, val bottom: Float) {
  val x get() = (left + right) / 2
  val y get() = (top + bottom) / 2
  val diagonal get() = hypot(right - left, bottom - top)
  val area get() = (right - left) * (bottom - top)
  fun overlap(other: PoseBounds): Float {
    val intersection = (minOf(right, other.right) - maxOf(left, other.left)).coerceAtLeast(0f) *
      (minOf(bottom, other.bottom) - maxOf(top, other.top)).coerceAtLeast(0f)
    val union = area + other.area - intersection
    return if (union > 0f) intersection / union else 0f
  }
}

data class TrackAssociationPolicy(
  val maxGapMs: Long, val baseDistance: Float, val scaleDistance: Float, val distanceCap: Float,
  val velocitySmoothing: Float, val speedCap: Float, val distanceWeight: Float,
  val overlapWeight: Float, val sizeWeight: Float, val unmatchedCost: Float, val candidatesPerPose: Int,
  val appearanceWeight: Float = 0f, val appearanceSmoothing: Float = 1f,
) {
  init {
    require(maxGapMs > 0 && baseDistance > 0f && scaleDistance > 0f && distanceCap >= baseDistance)
    require(velocitySmoothing in 0f..1f && speedCap > 0f && unmatchedCost > 0f)
    require(listOf(distanceWeight, overlapWeight, sizeWeight).all { it.isFinite() && it >= 0f })
    require(distanceWeight + overlapWeight + sizeWeight > 0f)
    require(candidatesPerPose > 0)
    require(appearanceWeight.isFinite() && appearanceWeight >= 0f && appearanceSmoothing in 0f..1f)
  }
}

/** Geometry continuity only: a track identifier is not a person's identity. */
class PoseTrackAssociator(private val policy: TrackAssociationPolicy) {
  private data class Track(val id: Int, var bounds: PoseBounds, var timestamp: Long,
                           var velocityX: Float = 0f, var velocityY: Float = 0f, var appearance: FloatArray? = null)
  private val tracks = mutableListOf<Track>()
  private var nextId = 0
  private var lastTimestamp = 0L
  val activeIds get() = tracks.map { it.id }.toSet()

  fun associate(observations: List<PoseBounds>, timestamp: Long, appearances: List<FloatArray?> = List(observations.size) { null }): IntArray {
    require(timestamp > lastTimestamp)
    require(observations.all { it.right > it.left && it.bottom > it.top && listOf(it.left, it.top, it.right, it.bottom).all(Float::isFinite) })
    validateAppearances(observations, appearances)
    lastTimestamp = timestamp
    tracks.removeAll { timestamp - it.timestamp > policy.maxGapMs }
    val assignments = assignments(observations, appearances, timestamp)
    return IntArray(observations.size) { index ->
      val observation = observations[index]
      val assigned = assignments[index]
      val track = if (assigned >= 0) tracks[assigned] else Track(nextId++, observation, timestamp).also { tracks.add(it) }
      if (timestamp > track.timestamp) {
        val seconds = (timestamp - track.timestamp) / 1000f
        val alpha = policy.velocitySmoothing
        track.velocityX = ((1 - alpha) * track.velocityX + alpha * (observation.x - track.bounds.x) / seconds)
          .coerceIn(-policy.speedCap, policy.speedCap)
        track.velocityY = ((1 - alpha) * track.velocityY + alpha * (observation.y - track.bounds.y) / seconds)
          .coerceIn(-policy.speedCap, policy.speedCap)
      }
      appearances[index]?.let { fresh ->
        val previous = track.appearance
        track.appearance = if (previous == null || previous.size != fresh.size) fresh.copyOf()
          else FloatArray(fresh.size) { previous[it] * (1 - policy.appearanceSmoothing) + fresh[it] * policy.appearanceSmoothing }
      }
      track.bounds = observation
      track.timestamp = timestamp
      track.id
    }
  }

  /** Preview the same one-to-one assignment without advancing observations or evidence. */
  fun missingBounds(observations: List<PoseBounds>, timestamp: Long,
                    appearances: List<FloatArray?> = List(observations.size) { null }): List<PoseBounds> {
    require(timestamp > lastTimestamp)
    validateAppearances(observations, appearances)
    tracks.removeAll { timestamp - it.timestamp > policy.maxGapMs }
    val used = assignments(observations, appearances, timestamp).filter { it >= 0 }.toSet()
    return tracks.indices.filter { it !in used }.map { index ->
      val track = tracks[index]
      val seconds = (timestamp - track.timestamp) / 1000f
      val dx = track.velocityX * seconds
      val dy = track.velocityY * seconds
      PoseBounds(track.bounds.left + dx, track.bounds.top + dy, track.bounds.right + dx, track.bounds.bottom + dy)
    }
  }

  private fun validateAppearances(observations: List<PoseBounds>, appearances: List<FloatArray?>) {
    require(observations.size == appearances.size)
    require(appearances.filterNotNull().all { values -> values.isNotEmpty() && values.all { it.isFinite() && it >= 0f } && values.sum() > 0f })
  }

  private fun assignments(observations: List<PoseBounds>, appearances: List<FloatArray?>, timestamp: Long): List<Int> {
    val costs = observations.mapIndexed { index, observation -> tracks.map { track -> cost(track, observation, timestamp, appearances[index]) } }
    val candidates = costs.map { row -> row.indices.filter { row[it].isFinite() }.sortedBy { row[it] }.take(policy.candidatesPerPose) }
    val memo = mutableMapOf<Pair<Int, Set<Int>>, Pair<Float, List<Int>>>()
    fun solve(index: Int, used: Set<Int>): Pair<Float, List<Int>> {
      if (index == observations.size) return 0f to emptyList()
      val key = index to used
      memo[key]?.let { return it }
      val unmatched = solve(index + 1, used)
      var best = (policy.unmatchedCost + unmatched.first) to (listOf(-1) + unmatched.second)
      candidates[index].filter { it !in used }.forEach { candidate ->
        val remaining = solve(index + 1, used + candidate)
        val score = costs[index][candidate] + remaining.first
        if (score < best.first) best = score to (listOf(candidate) + remaining.second)
      }
      memo[key] = best
      return best
    }
    return solve(0, emptySet()).second
  }

  private fun cost(track: Track, observation: PoseBounds, timestamp: Long, appearance: FloatArray?): Float {
    val seconds = (timestamp - track.timestamp) / 1000f
    val predictedX = track.bounds.x + track.velocityX * seconds
    val predictedY = track.bounds.y + track.velocityY * seconds
    val distance = hypot(predictedX - observation.x, predictedY - observation.y)
    val gate = maxOf(policy.baseDistance, maxOf(track.bounds.diagonal, observation.diagonal) * policy.scaleDistance)
      .coerceAtMost(policy.distanceCap)
    if (distance > gate) return Float.POSITIVE_INFINITY
    val sizeChange = abs(ln(observation.area / track.bounds.area)).coerceAtMost(1f)
    val previous = track.appearance
    val previousTotal = previous?.sum() ?: 0f
    val appearanceTotal = appearance?.sum() ?: 0f
    val appearanceDistance = if (previous != null && appearance != null && previous.size == appearance.size)
      previous.indices.sumOf { abs(previous[it] / previousTotal - appearance[it] / appearanceTotal).toDouble() }.toFloat() / 2 else 0f
    return policy.distanceWeight * distance / gate + policy.overlapWeight * (1 - track.bounds.overlap(observation)) +
      policy.sizeWeight * sizeChange + policy.appearanceWeight * appearanceDistance
  }
}

data class FallEvidencePolicy(val threshold: Double, val confirmations: Int, val maxGapMs: Long,
                              val rearmSamples: Int, val cooldownMs: Long) {
  init { require(threshold in 0.0..1.0 && confirmations > 0 && maxGapMs > 0 && rearmSamples > 0 && cooldownMs > 0) }
}

/** A missed pose cannot trigger an alert; only a fresh scored observation can. */
class FallEvidence(private val policy: FallEvidencePolicy) {
  var confirmations = 0; private set
  private var lastHigh = 0L
  private var normalSamples = 0
  private var alerted = false
  private var lastAlert = 0L
  fun expire(timestamp: Long) {
    if (timestamp - lastHigh > policy.maxGapMs) confirmations = 0
  }
  fun observe(probability: Double?, timestamp: Long): Boolean {
    expire(timestamp)
    if (probability == null) return false
    require(probability.isFinite() && probability in 0.0..1.0)
    if (probability >= policy.threshold) {
      confirmations++; lastHigh = timestamp; normalSamples = 0
    } else {
      confirmations = 0; normalSamples++
      if (normalSamples >= policy.rearmSamples) alerted = false
    }
    if (confirmations < policy.confirmations || alerted || (lastAlert != 0L && timestamp - lastAlert < policy.cooldownMs)) return false
    lastAlert = timestamp; alerted = true
    return true
  }
}

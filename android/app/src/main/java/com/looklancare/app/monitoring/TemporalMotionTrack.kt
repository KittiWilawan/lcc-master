package com.looklancare.app.monitoring

import kotlin.math.abs

data class TemporalMotionPolicy(
  val joints: List<Int>, val shoulders: List<Int>, val hips: List<Int>, val visibility: Float,
  val minScale: Double, val windowMs: Long, val gapMs: Long, val add: Double, val veto: Double, val drop: Double,
  val corroborationFloor: Double, val corroborationDrop: Double, val poseCredit: Double,
) {
  init {
    require(joints.isNotEmpty() && hips.size == 2 && shoulders.size == 2)
    require((joints + hips + shoulders).all { it >= 0 })
    require(minScale > 0 && gapMs > 0 && windowMs >= gapMs && visibility in 0f..1f)
    require(add in 0.0..1.0 && veto in 0.0..add && drop > 0)
    require(corroborationFloor in 0.0..veto && corroborationDrop > 0 && corroborationDrop <= drop && poseCredit in 0.0..1.0)
  }
}

class TemporalMotionTrack @JvmOverloads constructor(private val policy: TemporalMotionPolicy, private val forest: PoseForest,
                          private val evidencePolicy: FallEvidencePolicy, private val verifierForest: PoseForest? = null,
                          val verification: FallMotionVerification? = null) {
  private data class MotionScore(val motion: Double, val descent: Double, val verifier: Double?)
  private data class Frame(val time: Long, val shape: DoubleArray, val center: DoubleArray, val scale: Double)
  var originalScore: Double? = null
    private set
  var verifierScore: Double? = null
    private set
  private val history = ArrayDeque<Frame>()
  private data class Observation(val time: Long, val motion: Double, val descent: Double, val pose: Double)
  private var previousObservation: Observation? = null
  private var evidence = FallEvidence(evidencePolicy)

  fun clear() {
    history.clear()
    originalScore = null
    verifierScore = null
    verification?.clear()
    previousObservation = null
    evidence = FallEvidence(evidencePolicy)
  }

  private fun frame(points: List<PosePoint>, time: Long): Frame? {
    val visible = points.filter { it.visibility >= policy.visibility }
    if (visible.isEmpty()) return null
    val top = visible.minOf { it.y.toDouble() }
    val bottom = visible.maxOf { it.y.toDouble() }
    val height = bottom - top
    val width = visible.maxOf { it.x.toDouble() } - visible.minOf { it.x.toDouble() }
    val scale = maxOf(width, height, policy.minScale)
    fun mid(ids: List<Int>, coordinate: (PosePoint) -> Float) = ids.map { coordinate(points[it]).toDouble() }.average()
    val hipX = mid(policy.hips) { it.x }
    val hipY = mid(policy.hips) { it.y }
    val shoulderX = mid(policy.shoulders) { it.x }
    val shoulderY = mid(policy.shoulders) { it.y }
    val shape = buildList<Double> {
      add(width / scale); add(height / scale)
      add((hipY - shoulderY) / scale); add(abs(hipX - shoulderX) / scale)
      for (i in policy.joints) {
        val point = points[i]
        add(if (point.visibility >= policy.visibility) abs(point.x - hipX) / scale else 0.0)
        add(if (point.visibility >= policy.visibility) (point.y - hipY) / scale else 0.0)
      }
      for (i in policy.joints) add(points[i].visibility.toDouble())
    }.toDoubleArray()
    return Frame(time, shape, doubleArrayOf((shoulderX + hipX) / 2, (shoulderY + hipY) / 2, shoulderY, hipY, top, bottom, width, height), scale)
  }

  private fun score(current: Frame): MotionScore? {
    if (history.isNotEmpty() && (current.time <= history.last().time || current.time - history.last().time > policy.gapMs)) history.clear()
    while (history.isNotEmpty() && current.time - history.first().time > policy.windowMs) history.removeFirst()
    history.addLast(current)
    if (history.size < 2) return null
    val changes = history.dropLast(1).map { prior ->
      DoubleArray(current.center.size) { index ->
        val delta = (current.center[index] - prior.center[index]) / prior.scale
        if (index == 0) abs(delta) else delta
      }
    }
    val first = history.first()
    val vector = buildList<Double> {
      for (source in listOf(current, history[(history.size - 3).coerceAtLeast(0)], first)) addAll(source.shape.asList())
      addAll(changes.last().asList()); addAll(changes.first().asList())
      for (i in current.center.indices) add(changes.maxOf { it[i] })
      for (i in current.center.indices) add(changes.minOf { it[i] })
      add((current.time - first.time).toDouble() / policy.windowMs)
    }
    val drop = changes.maxOf { minOf(it[1], it[2]) }
    val features = FloatArray(vector.size) { vector[it].toFloat() }
    return MotionScore(forest.predict(features), drop, verifierForest?.predict(features))
  }

  @JvmOverloads
  fun observe(points: List<PosePoint>, time: Long, probability: Double?, landing: Boolean, collapse: Boolean, deferForRest: Boolean = false): Boolean {
    val result = frame(points, time)?.let(::score)
    originalScore = result?.motion
    verifierScore = result?.verifier
    verification?.observe(time, probability, landing, result?.motion, result?.verifier, result?.descent ?: 0.0)
    val previous = previousObservation?.takeIf { time > it.time && time - it.time <= policy.gapMs }
    previousObservation = if (result != null && probability != null)
      Observation(time, result.motion, result.descent, probability) else null
    if (result == null || probability == null) {
      return evidence.observe(probability, time, !deferForRest && landing && (result == null || result.motion >= policy.veto), collapse, false)
    }

    val (motion, drop) = result
    val descent = maxOf(drop, previous?.descent ?: drop)
    val threshold = evidencePolicy.threshold
    val poseWeakened = previous != null && previous.pose >= threshold && probability < threshold
    val strong = previous != null && previous.motion >= policy.add && motion >= policy.add &&
      descent >= policy.drop && (landing || !poseWeakened)
    val poseSupport = if (motion >= policy.corroborationFloor && descent >= policy.corroborationDrop)
      policy.poseCredit * (probability - threshold).coerceAtLeast(0.0) else 0.0
    return evidence.observe(probability, time, !deferForRest && landing && motion + poseSupport >= policy.veto, collapse, !deferForRest && strong)
  }
}


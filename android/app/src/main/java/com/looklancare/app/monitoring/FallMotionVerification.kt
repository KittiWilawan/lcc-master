package com.looklancare.app.monitoring

data class FallVerificationPolicy @JvmOverloads constructor(
  val threshold: Double, val floor: Double, val margin: Double,
  val originalThreshold: Double, val verifierThreshold: Double, val peak: Double, val drop: Double,
  val currentPoseFloor: Double = 0.0, val originalPeak: Double = 0.0,
) {
  init {
    require(threshold in 0.0..1.0 && floor in 0.0..threshold && margin in 0.0..1.0)
    require(currentPoseFloor in 0.0..1.0 && originalPeak in 0.0..1.0)
    require(originalThreshold in 0.0..1.0 && verifierThreshold in 0.0..peak && peak in 0.0..1.0 && drop > 0)
  }
}

/** State belongs to one continuous person track. Missing samples break the learned confirmation. */
class FallMotionVerification(private val rules: FallVerificationPolicy, private val evidence: FallEvidencePolicy) {
  private data class Sample(val time: Long, val score: Double, val original: Double, val descent: Double, val pose: Double)
  private var previous: Sample? = null
  var allowsLanding = true
    private set
  var additionalFall = false
    private set

  fun clear() {
    previous = null
    allowsLanding = true
    additionalFall = false
  }

  fun observe(time: Long, pose: Double?, landing: Boolean, original: Double?, verifier: Double?, descent: Double) {
    val prior = previous
    clear()
    if (pose == null || original == null || verifier == null) return
    allowsLanding = verifier >= rules.threshold || (verifier >= rules.floor && verifier + rules.margin >= original)
    if (original < rules.originalThreshold || verifier < rules.verifierThreshold) return
    previous = Sample(time, verifier, original, descent, pose)
    if (prior == null || time <= prior.time || time - prior.time > evidence.maxGapMs) return
    val weakening = !landing && pose < evidence.threshold && prior.pose >= evidence.threshold
    additionalFall = !weakening && pose >= rules.currentPoseFloor &&
      maxOf(original, prior.original) >= rules.originalPeak && maxOf(verifier, prior.score) >= rules.peak &&
      maxOf(descent, prior.descent) >= rules.drop
  }
}

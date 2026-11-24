package com.looklancare.app.monitoring

import com.looklancare.app.enrollment.FaceVectors

data class IdentityRules(val threshold: Double, val margin: Double, val confirmations: Int,
                         val maxGapMs: Long, val retentionMs: Long, val templateMatches: Int = 2) {
  init {
    require(threshold in 0.0..1.0 && margin in 0.0..1.0 && confirmations > 1)
    require(maxGapMs > 0 && retentionMs >= maxGapMs)
    require(templateMatches > 0)
  }
}
data class IdentityTemplate(val memberId: String, val name: String, val vectors: List<DoubleArray>) {
  override fun toString() = "IdentityTemplate(redacted)"
}
data class IdentityCandidate(val memberId: String, val name: String, val similarity: Double)
data class PersonIdentity(val memberId: String?, val name: String?, val similarity: Double?, val state: String)

/** Open-set matching. Close alternatives and bad vectors never become a name. */
object IdentityMatcher {
  fun match(vector: DoubleArray, templates: List<IdentityTemplate>, rules: IdentityRules): IdentityCandidate? {
    val scores = templates.mapNotNull { profile ->
      val similarities = profile.vectors.mapNotNull { FaceVectors.cosine(vector, it) }.sortedDescending()
      if (similarities.size < rules.templateMatches) null else
        IdentityCandidate(profile.memberId, profile.name, similarities.take(rules.templateMatches).average()) to
          similarities.take(rules.templateMatches).all { it >= rules.threshold }
    }.sortedByDescending { it.first.similarity }
    val best = scores.firstOrNull() ?: return null
    // Never fall back to a weaker person when the strongest alternative lacks agreement.
    if (!best.second || best.first.similarity < rules.threshold ||
      (scores.size > 1 && best.first.similarity - scores[1].first.similarity < rules.margin)) return null
    return best.first
  }
}

/** A name is earned by fresh face observations, retained briefly, lost on ambiguity. */
class TrackIdentity(private val rules: IdentityRules) {
  private var pending: IdentityCandidate? = null
  private var count = 0
  private var lastObservation = 0L
  private var confirmed: IdentityCandidate? = null
  private var lastConfirmed = 0L
  fun clear() { pending = null; confirmed = null; count = 0; lastObservation = 0; lastConfirmed = 0 }
  fun observe(candidate: IdentityCandidate?, timestamp: Long, ambiguous: Boolean = false, faceObserved: Boolean = true): PersonIdentity {
    require(timestamp > 0)
    if (ambiguous || (lastObservation > 0 && timestamp <= lastObservation)) clear()
    if (ambiguous) return PersonIdentity(null, null, null, "uncertain")
    if (lastObservation > 0 && timestamp - lastObservation > rules.maxGapMs) { pending = null; count = 0 }
    if (confirmed != null && timestamp - lastConfirmed > rules.retentionMs) confirmed = null
    if (faceObserved) {
      // A clear new face with no confident match revokes the previous name immediately.
      if (candidate == null || confirmed?.memberId != candidate.memberId) confirmed = null
      count = if (candidate != null && pending?.memberId == candidate.memberId) count + 1 else if (candidate != null) 1 else 0
      pending = candidate; lastObservation = timestamp
      if (candidate != null && count >= rules.confirmations) { confirmed = candidate; lastConfirmed = timestamp }
    }
    val result = confirmed ?: return PersonIdentity(null, null, candidate?.similarity, "uncertain")
    return PersonIdentity(result.memberId, result.name, result.similarity,
      if (faceObserved) "face_confirmed" else "recent_face")
  }
}

/** Seen faces invalidate a retained name on another track, including after two people separate. */
internal class CrowdFaceClaims(candidates: List<IdentityCandidate?>) {
  private val counts = candidates.filterNotNull().groupingBy { it.memberId }.eachCount()

  fun isAmbiguous(overlapping: Boolean, sharedFace: Boolean, member: String?, lastMember: String?): Boolean {
    if (sharedFace) return true
    if (member != null) return counts[member] != 1
    return overlapping || (lastMember != null && lastMember in counts)
  }
}

/** Reset old temporal evidence on entry, then keep collecting fresh poses in a crowd. */
class AmbiguityBoundary {
  private var active = false
  fun entering(ambiguous: Boolean): Boolean {
    val entered = ambiguous && !active
    active = ambiguous
    return entered
  }
}

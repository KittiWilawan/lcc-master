package com.looklancare.app.enrollment

import org.junit.Assert.*
import org.junit.Test

/** Decision tests use synthetic vectors, not a claim about recognition accuracy. */
class FaceAssuranceTest {
  private val rules = FaceAssuranceRules(.45, 3, .8, 3, 450)
  private val original = FaceEvidence(doubleArrayOf(1.0, 0.0, 0.0), .99)
  private fun anchor(guard: FaceAssurance) {
    for (time in 100L..500L step 100) guard.assess(original, true, time)
    assertTrue(guard.anchored)
  }
  @Test fun missingOrMalformedEvidenceCannotAnchor() {
    for (evidence in listOf(null, original.copy(embedding=doubleArrayOf()), original.copy(embedding=doubleArrayOf(Double.NaN)),
      original.copy(embedding=doubleArrayOf(0.0)), original.copy(liveScore=null), original.copy(liveScore=Double.NaN), original.copy(liveScore=2.0))) {
      val guard=FaceAssurance(rules)
      repeat(20) { assertNotNull(guard.assess(evidence,true,(it+1)*100L)) }
      assertFalse(guard.anchored)
    }
  }
  @Test fun matchingEveryOriginalAnchorBlocksReplacementAndTemplateDrift() {
    val guard=FaceAssurance(rules); anchor(guard)
    assertNull(guard.assess(original.copy(embedding=doubleArrayOf(5.0,0.0,0.0)),false,600))
    val impostor=original.copy(embedding=doubleArrayOf(0.0,1.0,0.0))
    repeat(10) { assertEquals("identity_changed",guard.assess(impostor,false,700+it*100L)) }
    assertNull(guard.assess(original,true,1800))
  }
  @Test fun gapsOrBadPassiveScoresResetConsecutiveEvidence() {
    val guard=FaceAssurance(rules)
    guard.assess(original,true,100); guard.assess(original,true,200)
    assertEquals("checking_live",guard.assess(original,true,1000))
    assertEquals("suspected_spoof",guard.assess(original.copy(liveScore=.1),true,1100))
    assertEquals("checking_live",guard.assess(original,true,1200))
    assertFalse(guard.anchored)
  }
  @Test fun clearingSessionErasesItsAnchorsAndRequiresLiveEvidenceAgain() {
    val guard=FaceAssurance(rules); anchor(guard); guard.clear()
    assertFalse(guard.anchored)
    assertEquals("checking_live",guard.assess(original,true,1000))
  }
  @Test fun malformedDimensionOrLowLiveScoreIsBlockedAfterAnchor() {
    val guard=FaceAssurance(rules); anchor(guard)
    assertEquals("identity_changed",guard.assess(original.copy(embedding=doubleArrayOf(1.0,0.0)),false,600))
    assertEquals("suspected_spoof",guard.assess(original.copy(liveScore=.79),true,700))
  }
}

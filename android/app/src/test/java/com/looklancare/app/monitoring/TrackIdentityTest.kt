package com.looklancare.app.monitoring

import org.junit.Assert.*
import org.junit.Test

class TrackIdentityTest {
  private val rules = IdentityRules(.55, .10, 2, 1500, 3000)
  private val alice = IdentityCandidate("a", "Alice", .9)
  private val bob = IdentityCandidate("b", "Bob", .9)
  @Test fun oneFaceDoesNotBecomeAName() {
    val identity = TrackIdentity(rules)
    assertNull(identity.observe(alice, 100).memberId)
    assertEquals("a", identity.observe(alice, 400).memberId)
  }
  @Test fun visibleDifferentFaceRevokesNameImmediately() {
    val identity = TrackIdentity(rules)
    identity.observe(alice, 100); identity.observe(alice, 400)
    assertNull(identity.observe(bob, 700).memberId)
    assertEquals("b", identity.observe(bob, 1000).memberId)
  }
  @Test fun unmatchedClearFaceDoesNotInheritPreviousName() {
    val identity = TrackIdentity(rules)
    identity.observe(alice, 100); identity.observe(alice, 400)
    assertNull(identity.observe(null, 700, faceObserved = true).memberId)
  }
  @Test fun backTurnRetainsBrieflyThenExpires() {
    val identity = TrackIdentity(rules)
    identity.observe(alice, 100); identity.observe(alice, 400)
    assertEquals("recent_face", identity.observe(null, 1000, faceObserved = false).state)
    assertNull(identity.observe(null, 3401, faceObserved = false).memberId)
  }
  @Test fun overlapAndTimestampRollbackWithdrawIdentity() {
    val identity = TrackIdentity(rules)
    identity.observe(alice, 100); identity.observe(alice, 400)
    assertNull(identity.observe(alice, 700, ambiguous = true).memberId)
    identity.observe(alice, 1000); identity.observe(alice, 1300)
    assertNull(identity.observe(alice, 1200).memberId)
  }
  @Test fun gapsCannotAccumulateConfirmation() {
    val identity = TrackIdentity(rules)
    identity.observe(alice, 100)
    assertNull(identity.observe(alice, 2000).memberId)
  }
  @Test fun similarPeopleCannotBeSelectedByLargestScoreAlone() {
    val profile = IdentityTemplate("a", "Alice", listOf(doubleArrayOf(1.0, 0.0), doubleArrayOf(1.0, 0.0)))
    val lookalike = IdentityTemplate("b", "Bob", listOf(doubleArrayOf(.99, .01), doubleArrayOf(.99, .01)))
    assertNull(IdentityMatcher.match(doubleArrayOf(1.0, 0.0), listOf(profile, lookalike), rules))
    assertEquals("a", IdentityMatcher.match(doubleArrayOf(1.0, 0.0), listOf(profile), rules)?.memberId)
    assertNull(IdentityMatcher.match(doubleArrayOf(0.0, 1.0), listOf(profile), rules))
    assertNull(IdentityMatcher.match(doubleArrayOf(Double.NaN, 0.0), listOf(profile), rules))
    assertNull(IdentityMatcher.match(doubleArrayOf(1.0, 0.0), listOf(profile.copy(vectors = listOf(doubleArrayOf(1.0, 0.0), doubleArrayOf(0.0, 1.0)))), rules))
  }
  @Test fun prolongedOverlapWithdrawsNameAndCannotAlertInSelectedMode() {
    val identity = TrackIdentity(rules); val boundary = AmbiguityBoundary()
    val scope = PersonMonitoringScope(setOf("a"))
    var evidence = FallEvidence(FallEvidencePolicy(.45, 2, 900, 3, 30000))
    identity.observe(alice, 100); identity.observe(alice, 400)
    var alerted = false
    for (now in listOf(700L, 1000L, 1300L)) {
      if (boundary.entering(true)) evidence = FallEvidence(FallEvidencePolicy(.45, 2, 900, 3, 30000))
      val person = identity.observe(alice, now, ambiguous = true)
      assertNull(person.memberId)
      alerted = evidence.observe(if (scope.includes(person.memberId)) .99 else null, now) || alerted
    }
    assertFalse("An ambiguous person is outside a selected-people scope", alerted)
  }
  @Test fun uncertainStrongestPersonDoesNotFallBackToWeakerIdentity() {
    val a = IdentityTemplate("a", "Alice", listOf(doubleArrayOf(.6, .8), doubleArrayOf(.6, .8)))
    val b = IdentityTemplate("b", "Bob", listOf(doubleArrayOf(.99, kotlin.math.sqrt(1 - .99 * .99)),
      doubleArrayOf(.54, kotlin.math.sqrt(1 - .54 * .54))))
    assertNull(IdentityMatcher.match(doubleArrayOf(1.0, 0.0), listOf(a, b), rules))
  }
}

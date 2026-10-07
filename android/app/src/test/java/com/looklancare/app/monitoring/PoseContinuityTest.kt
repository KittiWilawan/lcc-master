package com.looklancare.app.monitoring

import org.junit.Assert.*
import org.junit.Test

class PoseContinuityTest {
  private fun associator() = PoseTrackAssociator(TrackAssociationPolicy(
    1200, 0.2f, 0.7f, 0.45f, 0.5f, 0.8f, 0.65f, 0.25f, 0.1f, 1f, 3))
  private fun evidence() = FallEvidence(FallEvidencePolicy(0.56, 2, 900, 3, 30000))

  @Test fun fastFallKeepsTheTrackAcrossAChangeInBodyShape() {
    val tracker = associator()
    val standing = PoseBounds(0.3f, 0.05f, 0.5f, 0.7f)
    val falling = PoseBounds(0.15f, 0.55f, 0.7f, 0.8f)
    val id = tracker.associate(listOf(standing), 1000).single()
    assertEquals(id, tracker.associate(listOf(falling), 1300).single())
  }

  @Test fun briefOcclusionRetainsContinuityButExpiredTracksAreNotReused() {
    val tracker = associator()
    val person = PoseBounds(0.1f, 0.2f, 0.3f, 0.8f)
    val first = tracker.associate(listOf(person), 1000).single()
    assertEquals(0, tracker.associate(emptyList(), 1300).size)
    assertEquals(first, tracker.associate(listOf(person), 1600).single())
    assertNotEquals(first, tracker.associate(listOf(person), 3000).single())
  }

  @Test fun detectionOrderDoesNotSwapTwoSeparatedPeople() {
    val tracker = associator()
    val left = PoseBounds(0.1f, 0.1f, 0.25f, 0.8f)
    val right = PoseBounds(0.7f, 0.1f, 0.9f, 0.8f)
    val first = tracker.associate(listOf(left, right), 1000)
    val reversed = tracker.associate(listOf(right, left), 1300)
    assertArrayEquals(intArrayOf(first[1], first[0]), reversed)
  }

  @Test fun newDistantPersonCannotInheritOldEvidence() {
    val tracker = associator()
    val first = tracker.associate(listOf(PoseBounds(0.05f, 0.1f, 0.2f, 0.7f)), 1000).single()
    val next = tracker.associate(listOf(PoseBounds(0.75f, 0.1f, 0.95f, 0.7f)), 1300).single()
    assertNotEquals(first, next)
  }

  @Test fun oneHighObservationAndMissingPosesNeverTriggerAnAlert() {
    val state = evidence()
    assertFalse(state.observe(0.99, 1000))
    assertFalse(state.observe(null, 1300))
    assertFalse(state.observe(null, 1600))
    assertEquals(1, state.confirmations)
    assertFalse(state.observe(0.99, 2000))
    assertEquals(1, state.confirmations)
  }

  @Test fun twoFreshHighObservationsCanConfirmAcrossAShortGap() {
    val state = evidence()
    assertFalse(state.observe(0.99, 1000))
    assertFalse(state.observe(null, 1300))
    assertTrue(state.observe(0.99, 1600))
    assertFalse(state.observe(0.99, 1900))
  }

  @Test fun normalObservationBreaksFallConfirmationAndRearmsOnlyAfterCooldown() {
    val state = evidence()
    assertFalse(state.observe(0.99, 1000))
    assertFalse(state.observe(0.01, 1300))
    assertFalse(state.observe(0.99, 1600))
    assertTrue(state.observe(0.99, 1900))
    listOf(2200L, 2500L, 2800L).forEach { assertFalse(state.observe(0.01, it)) }
    assertFalse(state.observe(0.99, 3100))
    assertFalse(state.observe(0.99, 3400))
    assertFalse(state.observe(0.99, 33000))
    assertTrue(state.observe(0.99, 33300))
  }

  @Test fun repeatedTimestampIsRejected() {
    val tracker = associator()
    tracker.associate(emptyList(), 1000)
    assertThrows(IllegalArgumentException::class.java) { tracker.associate(emptyList(), 1000) }
  }
}

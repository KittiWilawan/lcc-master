package com.looklancare.app.monitoring

import org.junit.Assert.*
import org.junit.Test

class MonitoringResilienceTest {
  private val scope = MonitorScope("test-user", "test-family")
  @Test fun recoveryRequiresMatchingScopeAndUnexpiredPermission() {
    assertTrue(MonitoringRestorePolicy.allowed(true, true, scope, scope, 200, 100))
    assertFalse(MonitoringRestorePolicy.allowed(true, true, scope, MonitorScope("other-user", "test-family"), 200, 100))
    assertFalse(MonitoringRestorePolicy.allowed(true, true, scope, MonitorScope("test-user", "other-family"), 200, 100))
    assertFalse(MonitoringRestorePolicy.allowed(true, true, scope, null, 200, 100))
    assertFalse(MonitoringRestorePolicy.allowed(true, true, scope, scope, 100, 100))
  }
  @Test fun intentionalStopOrDisabledRecoveryCannotResume() {
    assertFalse(MonitoringRestorePolicy.allowed(false, true, scope, scope, 200, 100))
    assertFalse(MonitoringRestorePolicy.allowed(true, false, scope, scope, 200, 100))
  }
  @Test fun imageBudgetAndReservedFreeSpaceAreBothEnforcedWithoutOverflow() {
    val rules = EvidenceStorageRules(1000, 100, 500)
    assertTrue(rules.canStore(500, 500, 600))
    assertFalse(rules.canStore(501, 500, 600))
    assertFalse(rules.canStore(0, 500, 599))
    assertFalse(rules.canStore(0, 501, 1000))
    assertFalse(rules.canStore(Long.MAX_VALUE, 100, Long.MAX_VALUE))
  }
  @Test fun recoveryPreviewUsesOnlyRequestedPendingTrackAndDoesNotAdvanceItsEvidence() {
    val policy = TrackAssociationPolicy(1200, .2f, .7f, .45f, .5f, .8f, .65f, .25f, .1f, 1f, 3)
    val associator = PoseTrackAssociator(policy)
    val ids = associator.associate(listOf(PoseBounds(.1f,.1f,.3f,.7f), PoseBounds(.7f,.1f,.9f,.7f)), 100)
    assertEquals(0, associator.missingBounds(emptyList(), 200, eligibleIds = emptySet()).size)
    assertEquals(1, associator.missingBounds(emptyList(), 200, eligibleIds = setOf(ids[1])).size)
    assertTrue(associator.missingBounds(emptyList(), 200, eligibleIds = setOf(ids[1])).single().x > .5f)
    assertEquals(0, associator.missingBounds(emptyList(), 1500, eligibleIds = setOf(ids[1])).size)
  }
}

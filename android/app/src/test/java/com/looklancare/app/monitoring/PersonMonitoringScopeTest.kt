package com.looklancare.app.monitoring

import org.junit.Assert.*
import org.junit.Test

class PersonMonitoringScopeTest {
  @Test fun noActiveTargetsIncludesEveryPersonEvenWithoutAnIdentity() {
    val scope = PersonMonitoringScope(emptySet())
    assertTrue(scope.includes(null)); assertTrue(scope.includes("other")); assertTrue(scope.allPeople)
  }
  @Test fun selectedTargetsExcludeUnknownAndOtherPeople() {
    val scope = PersonMonitoringScope(setOf("grandmother", "grandfather"))
    assertFalse(scope.allPeople); assertFalse(scope.includes(null)); assertFalse(scope.includes("other"))
    assertTrue(scope.includes("grandmother")); assertTrue(scope.includes("grandfather"))
  }
  @Test fun targetRemovedOrDisabledRestoresAllPeopleMode() {
    assertFalse(PersonMonitoringScope(setOf("target")).includes("other"))
    assertTrue(PersonMonitoringScope(emptySet()).includes("other"))
  }
  @Test fun allPeopleModeConfirmsAFallWithoutFaceReferences() {
    val scope = PersonMonitoringScope(emptySet())
    val evidence = FallEvidence(FallEvidencePolicy(.45, 2, 900, 3, 30000))
    assertFalse(evidence.observe(if (scope.includes(null)) .99 else null, 100))
    assertTrue(evidence.observe(if (scope.includes(null)) .99 else null, 400))
  }
  @Test fun missingIdentityNeverAccumulatesFallConfirmationsForATarget() {
    val policy = FallEvidencePolicy(.45, 2, 900, 3, 30000)
    val scope = PersonMonitoringScope(setOf("target"))
    var evidence = FallEvidence(policy)
    for (time in listOf(100L, 400L, 700L)) {
      if (!scope.includes(null)) evidence = FallEvidence(policy)
      assertFalse(evidence.observe(if (scope.includes(null)) .99 else null, time))
    }
    assertFalse(evidence.observe(.99, 1000))
    assertTrue(evidence.observe(.99, 1300))
  }
}

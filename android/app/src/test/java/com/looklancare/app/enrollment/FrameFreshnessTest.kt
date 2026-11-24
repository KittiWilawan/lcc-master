package com.looklancare.app.enrollment

import org.junit.Assert.*
import org.junit.Test

class FrameFreshnessTest {
  @Test fun exactRepeatedContentStallsAndNewContentRecovers() {
    val guard = FrameFreshness(2000)
    val original = byteArrayOf(1,2,3)
    assertFalse(guard.stalled(original,100))
    assertFalse(guard.stalled(original.copyOf(),2099))
    assertTrue(guard.stalled(original.copyOf(),2100))
    assertTrue(guard.stalled(original.copyOf(),2200))
    assertFalse(guard.stalled(byteArrayOf(1,2,4),2300))
  }
  @Test fun callerMutationAndClearCannotRetainAStaleReference() {
    val guard = FrameFreshness(2000)
    val ownedByCaller = byteArrayOf(1,2,3)
    guard.stalled(ownedByCaller,100); ownedByCaller.fill(0)
    assertTrue(guard.stalled(byteArrayOf(1,2,3),2100))
    guard.clear()
    assertFalse(guard.stalled(byteArrayOf(1,2,3),2200))
  }
}

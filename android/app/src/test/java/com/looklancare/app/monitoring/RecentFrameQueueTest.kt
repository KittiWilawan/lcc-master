package com.looklancare.app.monitoring

import org.junit.Assert.*
import org.junit.Test

class RecentFrameQueueTest {
  @Test fun coldStartKeepsThreeRealFramesInTimestampOrderAndDisposesOverflow() {
    val dropped = mutableListOf<Int>(); val queue = RecentFrameQueue<Int>(3, 1800) { dropped.add(it) }
    for (i in 1..5) queue.add(i, i * 300L)
    assertEquals(listOf(1, 2), dropped)
    assertEquals(listOf(3, 4, 5), List(3) { queue.next(1600)!!.value })
    assertTrue(queue.isEmpty())
  }
  @Test fun expiredFramesCannotBeUsedAsFreshEvidence() {
    val dropped = mutableListOf<Int>(); val queue = RecentFrameQueue<Int>(3, 1800) { dropped.add(it) }
    queue.add(1, 100); queue.add(2, 400)
    assertNull(queue.next(2300)); assertEquals(listOf(1, 2), dropped)
  }
  @Test fun scopeOrReconnectClearDisposesEveryPendingFrame() {
    val dropped = mutableListOf<Int>(); val queue = RecentFrameQueue<Int>(3, 1800) { dropped.add(it) }
    queue.add(1, 100); queue.add(2, 400); queue.clear()
    assertTrue(queue.isEmpty()); assertEquals(listOf(1, 2), dropped)
  }
}

package com.looklancare.app.monitoring

import android.graphics.Bitmap
import android.os.SystemClock
import java.util.concurrent.Executor
import java.util.concurrent.atomic.AtomicBoolean

/** One task per camera at a time, requeued fairly on the shared inference executor. */
class CameraFrameDispatcher(private val executor: Executor, maximum: Int, maxAgeMs: Long,
                            private val consume: (Bitmap, Long) -> Unit) : AutoCloseable {
  private val queue = RecentFrameQueue<Bitmap>(maximum, maxAgeMs) { it.recycle() }
  private val scheduled = AtomicBoolean(false)
  private val closed = AtomicBoolean(false)
  private val idle = Object()
  fun submit(bitmap: Bitmap, timestamp: Long) {
    synchronized(idle) {
      if (closed.get()) { bitmap.recycle(); return }
      queue.add(bitmap, timestamp); schedule()
    }
  }
  fun clearPending() { queue.clear() }
  private fun schedule() {
    if (closed.get() || !scheduled.compareAndSet(false, true)) return
    try { executor.execute {
      try {
        val frame = queue.next(SystemClock.elapsedRealtime())
        if (frame != null) try { if (!closed.get()) consume(frame.value, frame.timestamp) } finally { frame.value.recycle() }
      } finally {
        synchronized(idle) {
          scheduled.set(false)
          if (!closed.get() && !queue.isEmpty()) schedule() else idle.notifyAll()
        }
      }
    } } catch (_: java.util.concurrent.RejectedExecutionException) {
      scheduled.set(false); queue.clear(); synchronized(idle) { idle.notifyAll() }
    }
  }
  fun awaitIdle(timeoutMs: Long): Boolean = synchronized(idle) {
    val deadline = SystemClock.elapsedRealtime() + timeoutMs
    while (scheduled.get() || !queue.isEmpty()) {
      val remaining = deadline - SystemClock.elapsedRealtime(); if (remaining <= 0) return@synchronized false
      idle.wait(remaining)
    }
    true
  }
  override fun close() { synchronized(idle) { closed.set(true); queue.clear(); idle.notifyAll() } }
}

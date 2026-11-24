package com.looklancare.app.monitoring

import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Network and new-event wakeups take precedence over the retry calculated by an in-flight drain. */
internal class DeliveryScheduler(private val fallbackMs: Long, private val drain: () -> Long) : AutoCloseable {
  private val executor = Executors.newSingleThreadScheduledExecutor()
  private val requested = AtomicBoolean(false)
  private var next: ScheduledFuture<*>? = null

  fun request() {
    if (!requested.compareAndSet(false, true)) return
    try {
      executor.execute {
        requested.set(false)
        next?.cancel(false)
        runDrain()
      }
    } catch (_: RejectedExecutionException) { requested.set(false) }
  }

  private fun runDrain() {
    val delay = try { drain() } catch (_: Exception) { fallbackMs }
    if (!executor.isShutdown) {
      try { next = executor.schedule(::runDrain, delay, TimeUnit.MILLISECONDS) }
      catch (_: RejectedExecutionException) { /* Closed while the drain was completing. */ }
    }
  }

  override fun close() { executor.shutdownNow() }
}

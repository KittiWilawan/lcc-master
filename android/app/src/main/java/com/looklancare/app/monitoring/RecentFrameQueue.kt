package com.looklancare.app.monitoring

data class TimedFrame<T>(val value: T, val timestamp: Long)

/** Bounded real frames only; old backlog cannot become fresh temporal evidence. */
class RecentFrameQueue<T>(private val maximum: Int, private val maxAgeMs: Long, private val dispose: (T) -> Unit) {
  private val frames = ArrayDeque<TimedFrame<T>>()
  init { require(maximum > 0 && maxAgeMs > 0) }
  @Synchronized fun add(value: T, timestamp: Long) {
    require(timestamp > 0)
    frames.addLast(TimedFrame(value, timestamp))
    while (frames.size > maximum) dispose(frames.removeFirst().value)
    expire(timestamp)
  }
  @Synchronized fun next(now: Long): TimedFrame<T>? { expire(now); return if (frames.isEmpty()) null else frames.removeFirst() }
  @Synchronized fun isEmpty() = frames.isEmpty()
  @Synchronized fun clear() { while (frames.isNotEmpty()) dispose(frames.removeFirst().value) }
  private fun expire(now: Long) { while (frames.isNotEmpty() && now - frames.first().timestamp > maxAgeMs) dispose(frames.removeFirst().value) }
}

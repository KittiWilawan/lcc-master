package com.looklancare.app.enrollment

/** A content stall is a camera health condition, not proof of a presentation attack. */
class FrameFreshness(private val maxUnchangedMs: Long) {
  private var previous: ByteArray? = null
  private var unchangedSince: Long? = null
  init { require(maxUnchangedMs > 0) }
  fun stalled(signature: ByteArray, now: Long): Boolean {
    require(signature.isNotEmpty())
    if (previous?.contentEquals(signature) != true) {
      previous?.fill(0); previous = signature.copyOf(); unchangedSince = now
    }
    return now - (unchangedSince ?: now) >= maxUnchangedMs
  }
  fun clear() { previous?.fill(0); previous = null; unchangedSince = null }
}

package com.looklancare.app.monitoring

import kotlin.math.abs
import kotlin.math.ceil

data class MotionPolicy(val columns: Int, val rows: Int, val lumaDelta: Int,
                        val minChangedFraction: Double, val minChangedCells: Int,
                        val discoveryMinCells: Int, val discoveryExtent: Float, val retentionMs: Long) {
  init {
    require(columns > 1 && rows > 1 && lumaDelta in 1..255 && retentionMs > 0)
    require(minChangedFraction > 0 && minChangedFraction <= 1 && minChangedCells > 0)
    require(discoveryMinCells >= minChangedCells && discoveryExtent > 0f && discoveryExtent <= 1f)
  }
}

/** Low-resolution camera-local motion. Coordinates stay in the original normalized frame. */
class SceneMotion(private val policy: MotionPolicy) {
  private val cols = policy.columns
  private val rows = policy.rows
  private val lastChange = LongArray(cols * rows)
  private val pending = BooleanArray(cols * rows)
  private val queue = IntArray(cols * rows)
  private var previous: ByteArray? = null
  private var now = 0L
  private var lastRegion: PoseBounds? = null
  private var regionSeenAt = 0L

  fun update(luma: ByteArray, timestamp: Long) {
    require(luma.size == lastChange.size && timestamp > 0)
    val before = previous
    if (before == null || timestamp <= now || timestamp - now > policy.retentionMs) {
      lastChange.fill(0)
      lastRegion = null
    } else {
      // A uniform exposure adjustment should not look like a moving person.
      val delta = luma.indices.sumOf { (luma[it].toInt() and 255) - (before[it].toInt() and 255) } / luma.size
      for (i in luma.indices) {
        val change = (luma[i].toInt() and 255) - (before[i].toInt() and 255)
        if (abs(change - delta) >= policy.lumaDelta) lastChange[i] = timestamp
      }
    }
    previous = luma.copyInto(before ?: ByteArray(luma.size))
    now = timestamp
  }

  private fun recent(i: Int) = lastChange[i] > 0 && now - lastChange[i] <= policy.retentionMs

  private inline fun visit(bounds: PoseBounds, action: (Int) -> Unit) {
    val left = (bounds.left * cols).toInt().coerceIn(0, cols)
    val top = (bounds.top * rows).toInt().coerceIn(0, rows)
    val right = ceil(bounds.right * cols).toInt().coerceIn(0, cols)
    val bottom = ceil(bounds.bottom * rows).toInt().coerceIn(0, rows)
    for (y in top until bottom) for (x in left until right) action(y * cols + x)
  }

  fun supports(bounds: PoseBounds): Boolean {
    var changed = 0
    var total = 0
    visit(bounds) { i -> total++; if (recent(i)) changed++ }
    return changed >= policy.minChangedCells && changed >= total * policy.minChangedFraction
  }

  fun belongsTo(region: PoseBounds, candidate: PoseBounds): Boolean =
    supports(candidate) && ((region.x in candidate.left..candidate.right && region.y in candidate.top..candidate.bottom) ||
      (candidate.x in region.left..region.right && candidate.y in region.top..region.bottom))

  /** Only propose a search. A pose, its own history and the classifier must still confirm a fall. */
  fun uncovered(occupied: List<PoseBounds>): PoseBounds? {
    for (i in pending.indices) pending[i] = now > 0 && lastChange[i] == now
    for (bounds in occupied) visit(bounds) { pending[it] = false }
    var largest = policy.discoveryMinCells - 1
    var region: PoseBounds? = null
    for (seed in pending.indices) {
      if (!pending[seed]) continue
      var head = 0
      var tail = 1
      pending[seed] = false
      queue[0] = seed
      var left = cols; var top = rows; var right = 0; var bottom = 0
      while (head < tail) {
        val i = queue[head++]
        val x = i % cols; val y = i / cols
        left = minOf(left, x); right = maxOf(right, x + 1)
        top = minOf(top, y); bottom = maxOf(bottom, y + 1)
        if (x > 0 && pending[i-1]) { pending[i-1] = false; queue[tail++] = i-1 }
        if (x+1 < cols && pending[i+1]) { pending[i+1] = false; queue[tail++] = i+1 }
        if (y > 0 && pending[i-cols]) { pending[i-cols] = false; queue[tail++] = i-cols }
        if (y+1 < rows && pending[i+cols]) { pending[i+cols] = false; queue[tail++] = i+cols }
      }
      if (tail > largest) {
        largest = tail
        region = PoseBounds(left.toFloat()/cols, top.toFloat()/rows, right.toFloat()/cols, bottom.toFloat()/rows)
      }
    }
    if (region != null) {
      lastRegion = region
      regionSeenAt = now
      return region
    }
    // A person can stop moving on impact. Finish the short confirmation window at the last location.
    return lastRegion?.takeIf { last ->
      now - regionSeenAt <= policy.retentionMs && occupied.none { last.x in it.left..it.right && last.y in it.top..it.bottom }
    }
  }

  fun searchCrop(region: PoseBounds, width: Int, height: Int, margin: Float, minPixels: Int): PoseCrop? {
    val extent = maxOf((region.right - region.left) * width, (region.bottom - region.top) * height,
      minOf(width, height) * policy.discoveryExtent / margin)
    val halfWidth = extent / (2 * width)
    val halfHeight = extent / (2 * height)
    return PoseCrop.around(PoseBounds(region.x-halfWidth, region.y-halfHeight, region.x+halfWidth, region.y+halfHeight),
      width, height, margin, minPixels)
  }
}

/** Veto only a clearly visible standing chain. Missing joints provide no evidence either way. */
class UprightPose(private val chains: List<List<Int>>, private val minVisibility: Float, private val verticalCosine: Float) {
  init {
    require(minVisibility in 0f..1f && verticalCosine > 0f && verticalCosine <= 1f)
    require(chains.isNotEmpty() && chains.all { it.size == 4 && it.distinct().size == it.size && it.all { i -> i >= 0 } })
  }

  fun visible(points: List<PosePoint>, width: Int, height: Int): Boolean = chains.any { chain ->
    chain.indices.drop(1).all { index ->
      val upper = points.getOrNull(chain[index - 1])
      val lower = points.getOrNull(chain[index])
      if (upper == null || lower == null || minOf(upper.visibility, lower.visibility) < minVisibility) false
      else {
        val dx = (lower.x - upper.x) * width
        val dy = (lower.y - upper.y) * height
        dy > 0 && dy >= kotlin.math.hypot(dx, dy) * verticalCosine
      }
    }
  }
}

data class DescentPolicy(val windowMs: Long, val maxGapMs: Long, val minimumDescent: Float, val maximumFootShift: Float) {
  init { require(windowMs >= maxGapMs && maxGapMs > 0 && minimumDescent > 0f && minimumDescent < 1f && maximumFootShift in 0f..1f) }
}

/** A brief drop in model score during landing can be paired with the preceding high score on this same track. */
class FallTransition(private val policy: DescentPolicy) {
  private data class Sample(val at: Long, val box: PoseBounds, val rawScore: Double)
  private val recent = ArrayDeque<Sample>()
  fun clear() = recent.clear()

  fun score(box: PoseBounds, aspect: Float, timestamp: Long, raw: Double, pendingHigh: Boolean, threshold: Double): Double {
    val preceding = recent.lastOrNull()
    if (preceding != null && (timestamp <= preceding.at || timestamp - preceding.at > policy.maxGapMs)) clear()
    while (recent.isNotEmpty() && timestamp - recent.first().at > policy.windowMs) recent.removeFirst()
    val last = recent.lastOrNull()
    val height = box.bottom - box.top
    val width = (box.right - box.left) * aspect
    val paired = if (raw < threshold && pendingHigh && last != null && last.rawScore >= threshold &&
      width > height && recent.any { sample ->
        val start = sample.box
        val startHeight = start.bottom - start.top
        startHeight > (start.right - start.left) * aspect &&
          box.top - start.top >= startHeight * policy.minimumDescent &&
          height <= startHeight * (1f - policy.minimumDescent) &&
          abs(box.bottom - start.bottom) <= startHeight * policy.maximumFootShift
      }) (raw + last.rawScore) / 2 else raw
    recent.addLast(Sample(timestamp, box, raw))
    return paired
  }
}

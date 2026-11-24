package com.looklancare.app.enrollment

/** Least-squares similarity alignment from model landmarks to the embedding model template. */
object FaceSimilarityTransform {
  /** OpenCV landmarks address pixel centres at integer coordinates; Canvas uses half-pixel centres. */
  fun forCanvas(transform: FloatArray): FloatArray {
    require(transform.size == 9)
    return transform.copyOf().apply {
      this[2] += .5f - .5f * (this[0] + this[1])
      this[5] += .5f - .5f * (this[3] + this[4])
    }
  }
  fun fit(source: List<ImagePoint>, target: List<ImagePoint>): FloatArray {
    require(source.size == target.size && source.size >= 2)
    require((source + target).all { it.x.isFinite() && it.y.isFinite() })
    val sx = source.map { it.x }.average(); val sy = source.map { it.y }.average()
    val tx = target.map { it.x }.average(); val ty = target.map { it.y }.average()
    var denominator = 0.0; var rotationA = 0.0; var rotationB = 0.0
    for (i in source.indices) {
      val x = source[i].x - sx; val y = source[i].y - sy
      val u = target[i].x - tx; val v = target[i].y - ty
      denominator += x * x + y * y
      rotationA += x * u + y * v; rotationB += x * v - y * u
    }
    require(denominator > 0 && denominator.isFinite())
    val a = rotationA / denominator; val b = rotationB / denominator
    require(a.isFinite() && b.isFinite() && a * a + b * b > 0)
    return floatArrayOf(a.toFloat(), -b.toFloat(), (tx - a * sx + b * sy).toFloat(),
      b.toFloat(), a.toFloat(), (ty - b * sx - a * sy).toFloat(), 0f, 0f, 1f)
  }
}

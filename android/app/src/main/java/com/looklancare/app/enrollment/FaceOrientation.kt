package com.looklancare.app.enrollment

import kotlin.math.asin
import kotlin.math.atan2
import kotlin.math.sqrt

data class FaceOrientation(val yaw: Double, val pitch: Double, val roll: Double) {
  companion object {
    /** MediaPipe's flat column-major matrix contains uniform scale as well as rotation. */
    fun fromMatrix(matrix: FloatArray): FaceOrientation {
      require(matrix.size == 16 && matrix.all { it.isFinite() })
      val scale = sqrt(matrix[0].toDouble() * matrix[0] + matrix[1].toDouble() * matrix[1] + matrix[2].toDouble() * matrix[2])
      require(scale > 0)
      return FaceOrientation(Math.toDegrees(asin((-matrix[2] / scale).coerceIn(-1.0, 1.0))),
        Math.toDegrees(atan2(matrix[6].toDouble(), matrix[10].toDouble())),
        Math.toDegrees(atan2(matrix[1].toDouble(), matrix[0].toDouble())))
    }
  }
}

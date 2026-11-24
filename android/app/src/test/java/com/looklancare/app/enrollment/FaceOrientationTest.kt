package com.looklancare.app.enrollment

import org.junit.Assert.*
import org.junit.Test
import kotlin.math.cos
import kotlin.math.sin

class FaceOrientationTest {
  @Test fun yawDirectionAndAngleAreIndependentOfDistanceScale() {
    for (degrees in listOf(-32.0, 0.0, 26.0)) for (scale in listOf(.7, 1.0, 1.3)) {
      val angle = Math.toRadians(degrees)
      val matrix = floatArrayOf(cos(angle).toFloat(), 0f, -sin(angle).toFloat(), 0f, 0f, 1f, 0f, 0f, sin(angle).toFloat(), 0f, cos(angle).toFloat(), 0f, 0f, 0f, 0f, 1f)
      for (column in 0..2) for (row in 0..2) matrix[column * 4 + row] *= scale.toFloat()
      val rotation = FaceOrientation.fromMatrix(matrix)
      assertEquals(degrees, rotation.yaw, .001); assertEquals(0.0, rotation.pitch, .001); assertEquals(0.0, rotation.roll, .001)
    }
  }
  @Test fun invalidTransformationCannotBecomeValidPose() {
    for (matrix in listOf(FloatArray(16), FloatArray(4), FloatArray(16) { Float.NaN })) {
      try { FaceOrientation.fromMatrix(matrix); fail("Invalid matrix must be rejected") } catch (_: IllegalArgumentException) { }
    }
  }
}

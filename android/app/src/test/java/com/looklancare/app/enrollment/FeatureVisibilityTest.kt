package com.looklancare.app.enrollment

import org.junit.Assert.*
import org.junit.Test

class FeatureVisibilityTest {
  private val clear = FeatureDetail("eye", .8, 25.0)
  @Test fun brightnessAndTextureHaveDifferentFailureReasons() {
    assertEquals(FeatureVisibilityIssue.BLUR, FeatureVisibility.assess(listOf(clear.copy(sharpness=1.0), clear), .25, 15.0, 2))
    assertEquals(FeatureVisibilityIssue.DARK, FeatureVisibility.assess(listOf(clear.copy(brightnessRatio=.1), clear), .25, 15.0, 2))
    assertNull(FeatureVisibility.assess(listOf(clear, clear), .25, 15.0, 2))
  }
  @Test fun sidePoseCanUseTheVisibleEyeButMalformedEvidenceFailsClosed() {
    assertNull(FeatureVisibility.assess(listOf(clear, clear.copy(brightnessRatio=.1)), .25, 15.0, 1))
    assertEquals(FeatureVisibilityIssue.MISSING, FeatureVisibility.assess(emptyList(), .25, 15.0, 1))
    assertEquals(FeatureVisibilityIssue.MISSING, FeatureVisibility.assess(listOf(clear.copy(sharpness=Double.NaN)), .25, 15.0, 1))
  }
}

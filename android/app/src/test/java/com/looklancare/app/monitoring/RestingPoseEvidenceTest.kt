package com.looklancare.app.monitoring

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RestingPoseEvidenceTest {
  private val landing = LandingPolicy(listOf(listOf(0, 1, 2)), .35f, 1800, 900, .4f, 3f, .55f,
    .6f, .4f, .3f, .6f, .65f, .25f, 2, .82f, .4f)
  private val gate = RestingPoseEvidence(landing, RestingPosePolicy(.05, .1, .3, .08, 2, .5, 4, .4, .5))
  private fun sample(time: Long, hip: Float, visibility: Float = 1f): Boolean {
    val points = listOf(PosePoint(.4f, hip - .2f, 0f, visibility), PosePoint(.4f, hip, 0f, visibility),
      PosePoint(.5f, hip - .04f, 0f, visibility))
    return gate.shouldDefer(points, 1f, time)
  }
  @Test fun supportedRestEndsWhenHipsDescend() {
    assertFalse(sample(0, .7f))
    assertFalse(sample(300, .7f))
    assertTrue(sample(600, .69f))
    assertFalse(sample(900, .80f))
  }
  @Test fun alreadyHorizontalPoseDoesNotHideAFurtherDescent() {
    fun lying(time: Long, y: Float): Boolean {
      val points = listOf(PosePoint(.3f, y, 0f, 1f), PosePoint(.55f, y, 0f, 1f),
        PosePoint(.65f, y + .2f, 0f, 1f))
      return gate.shouldDefer(points, 1f, time)
    }
    for (frame in 0..3) assertFalse(lying(frame * 300L, .65f))
    assertTrue(lying(1200, .65f))
    assertFalse(lying(1500, .82f))
  }
  @Test fun hiddenHipsMissingTimeAndNewIdentityCannotSuppressANewFall() {
    sample(0, .7f)
    sample(300, .7f)
    assertFalse(sample(600, .7f, 0f))
    assertFalse(sample(1500, .7f))
    assertFalse(sample(1800, .7f))
    assertTrue(sample(2100, .7f))
    gate.clear()
    assertFalse(sample(2400, .7f))
  }
}


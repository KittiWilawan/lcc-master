package com.looklancare.app.monitoring

import org.junit.Assert.*
import org.junit.Test

class SeatedLeanEvidenceTest {
  private val landing = LandingPolicy(listOf(listOf(0,1,2)), .35f, 1800, 900,
    .4f, 3f, .55f, .6f, .4f, .3f, .6f, .65f, .25f, 2, .82f, .4f)
  private val rule = SeatedLeanPolicy(.05,.55,.35,.65,.45,.85,-.15,4,.75,.58,.4)
  private val track = SeatedLeanEvidence(landing, rule)
  private fun sample(t: Long, shoulderX: Float, shoulderY: Float, hip: Float, score: Double = .4, visibility: Float = 1f) =
    track.observe(listOf(PosePoint(shoulderX,shoulderY,0f,visibility), PosePoint(.5f,hip,0f,1f),
      PosePoint(.55f,hip-.07f,0f,1f)),1f,t,.7,score)
  private fun seated() { for (i in 1..4) assertFalse(sample(i*300L,.5f,.3f,.6f)) }
  @Test fun supportedLeanAndImmediateContinuation() {
    seated()
    assertTrue(sample(1500,.2f,.58f,.6f))
    assertTrue(sample(1800,.2f,.62f,.64f))
    assertFalse(sample(2100,.2f,.89f,.92f))
  }
  @Test fun strongVerificationReleasesADeferredLeanImmediately() {
    seated()
    assertTrue(sample(1500,.2f,.58f,.6f))
    assertFalse(sample(1800,.2f,.62f,.64f,score=.95))
  }
  @Test fun clearMissingTorsoAndStaleTimeBreakHistory() {
    seated()
    assertFalse(sample(1500,.2f,.58f,.6f,visibility=0f))
    assertFalse(sample(1800,.2f,.58f,.6f))
    track.clear()
    seated()
    assertFalse(sample(2500,.2f,.58f,.6f))
  }
  @Test fun strongIndependentMotionOrDroppingHipsRemainEligible() {
    seated()
    assertFalse(sample(1500,.2f,.58f,.6f,score=.9))
    assertFalse(sample(1800,.2f,.86f,.90f))
  }
  @Test fun onlyTightenRotatedSearchNearEitherSide() {
    val center = PoseCrop(80,10,80,60)
    val left = PoseCrop(8,10,80,60)
    val right = PoseCrop(152,10,80,60)
    assertSame(center, center.searchArea(.5,true,240))
    assertEquals(left.centered(.5),left.searchArea(.5,true,240))
    assertEquals(right.centered(.5),right.searchArea(.5,true,240))
    assertEquals(center.centered(.5),center.searchArea(.5,false,240))
  }
  @Test fun tighterSearchRestoresCoordinatesInTheOriginalFrame() {
    val parent = PoseCrop(50,20,100,80)
    val inner = parent.centered(.5)
    assertEquals(PoseCrop(75,40,50,40),inner)
    val point = inner.restore(listOf(PosePoint(.5f,.5f,0f,1f)),200,100,-90).single()
    assertEquals(.5f,point.x,.0001f)
    assertEquals(.6f,point.y,.0001f)
    assertSame(parent,parent.centered(1.0))
  }
}

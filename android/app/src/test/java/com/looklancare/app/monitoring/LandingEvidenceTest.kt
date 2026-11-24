package com.looklancare.app.monitoring

import org.junit.Assert.*
import org.junit.Test

class LandingEvidenceTest {
  private val gate = LandingEvidence(LandingPolicy(listOf(listOf(0,1,2,3)), .35f, 1800, 900, .4f, 3f, .55f, .6f, .4f, .3f, .6f, .65f, .25f, 2, .82f, .4f))
  private fun observe(time: Long, y: Float, side: Boolean = false, vis: Float = 1f): Boolean {
    val hipX = if (side) .5f else .3f
    val hipY = if (side) y else y + .2f
    val points = listOf(PosePoint(.3f,y,0f,vis), PosePoint(hipX,hipY,0f,vis), PosePoint(.55f,hipY+.1f,0f,vis))
    return gate.observe(points + points.last(), PoseBounds(.3f,y,.55f,hipY+.1f),1f,time)
  }
  @Test fun sustainedDescentNeedsFreshScoredInScopeSamplesAndSharesTheCooldown() {
    val evidence = FallEvidence(FallEvidencePolicy(.45,2,900,3,30000))
    assertFalse(evidence.observe(.07,100,true,true))
    assertFalse(evidence.observe(.07,100,true,true))
    assertFalse(evidence.observe(null,200,true,true))
    assertFalse(evidence.observe(.07,300,true,true))
    assertFalse(evidence.observe(.07,500,false,true))
    assertFalse(evidence.observe(.07,800,true,true))
    assertFalse(evidence.observe(.07,1800,true,true))
    assertTrue(evidence.observe(.07,2100,true,true))
    assertFalse(evidence.observe(.98,2400,true))
    assertFalse(evidence.observe(.99,2700,true))
  }
  @Test fun clearCollapseRequiresAnUprightStartAndWideLanding() {
    val top = listOf(PosePoint(.3f,.1f,0f,1f), PosePoint(.3f,.3f,0f,1f),PosePoint(.3f,.6f,0f,1f))
    val low = listOf(PosePoint(.3f,.5f,0f,1f), PosePoint(.5f,.5f,0f,1f),PosePoint(.55f,.6f,0f,1f))
    val floor = PoseBounds(.25f,.45f,.69f,.65f)
    gate.observe(top + top.last(),PoseBounds(.25f,.1f,.4f,.65f),1f,100)
    gate.observe(low + low.last(),floor,1f,400)
    assertTrue(gate.clearCollapse)
    gate.clear()
    gate.observe(low + low.last(),floor,1f,700)
    assertFalse(gate.clearCollapse)
  }
  @Test fun seatedPoseAndHiddenJointsCannotCorroborate() {
    assertFalse(observe(100,.3f)); assertFalse(observe(400,.3f)); assertFalse(observe(700,.6f,true,.2f))
  }
  @Test fun observedDescentCanCorroborate() {
    assertFalse(observe(100,.1f)); assertTrue(observe(400,.4f,true))
  }
  @Test fun sidewaysTorsoMustDescendBeforeCorroborating() {
    assertFalse(observe(100,.3f,true)); assertFalse(observe(400,.3f,true))
    assertTrue(observe(700,.5f,true))
  }
  @Test fun translatingUprightBodyWithoutCompressionIsInsufficient() {
    assertFalse(observe(100,.1f)); assertFalse(observe(400,.4f))
  }
  @Test fun uprightCompressionNeedsTwoDistinctEarlierReferenceFrames() {
    fun upright(time: Long, shoulder: Float, bottom: Float): Boolean {
      val joints = listOf(shoulder, shoulder + .15f, bottom - .05f, bottom)
        .map { PosePoint(.4f, it, 0f, 1f) }
      return gate.observe(joints, PoseBounds(.3f, shoulder, .5f, bottom), 1f, time)
    }
    assertFalse(upright(100, .1f, .9f))
    assertFalse(upright(400, .45f, .9f))
    assertFalse(upright(700, .45f, .9f))
    gate.clear()
    assertFalse(upright(100, .1f, .9f))
    assertFalse(upright(100, .1f, .9f))
    assertFalse(upright(400, .45f, .9f))
    gate.clear()
    assertFalse(upright(100, .1f, .9f))
    assertFalse(upright(400, .12f, .9f))
    assertTrue(upright(700, .45f, .9f))
  }

  @Test fun expiredOrResetTrackNeedsFreshObservations() {
    assertFalse(observe(100,.1f)); assertFalse(observe(1300,.4f,true))
    gate.clear(); assertFalse(observe(1600,.4f,true))
  }
  @Test fun unverifiedScoresDoNotSpendTheAlertCooldown() {
    val evidence = FallEvidence(FallEvidencePolicy(.5,2,900,3,30000))
    assertFalse(evidence.observe(.9,100,false)); assertFalse(evidence.observe(.9,400,false))
    assertTrue(evidence.observe(.9,700,true)); assertFalse(evidence.observe(.9,1000,true))
  }
  @Test fun partialLegCanFinishOnlyAPreviouslyVisibleDescent() {
    fun landing(t: Long, ankle: Float) = gate.observe(listOf(PosePoint(.3f,.42f,0f,1f),PosePoint(.5f,.42f,0f,1f),
      PosePoint(.5f,.45f,0f,.3f),PosePoint(.5f,.46f,0f,ankle)), PoseBounds(.3f,.42f,.55f,.46f),1f,t)
    assertFalse(landing(100,.3f))
    assertFalse(observe(400,.1f))
    assertFalse(landing(700,.1f))
    assertTrue(landing(1000,.3f))
    assertFalse(landing(1600,.3f))
  }
}

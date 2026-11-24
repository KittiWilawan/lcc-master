package com.looklancare.app.enrollment

import org.junit.Assert.*
import org.junit.Test

/** Synthetic observations exercise state transitions, not model accuracy. */
class FaceScanSessionTest {
  private val rules = ScanRules(.22, .64, .5, .44, .16, .18, 18.0, 18.0, 800, 450, 1500, .18, .35, .55, 80, 1200, .82, .025, 3)
  private val front = ScanPose("front", -12.0, 12.0)
  private val poses = listOf(front, ScanPose("left", 18.0, 42.0), ScanPose("right", -42.0, -18.0))
  private val face = FaceObservation(1, .3, .2, .4, .48)
  private fun ready(session: FaceScanSession): Long {
    for (time in 100L..1000L step 100) assertNull(session.next(face, time).capture)
    assertNull(session.next(face.copy(blinkLeft = .9, blinkRight = .9), 1100).capture)
    assertNull(session.next(face.copy(blinkLeft = .9, blinkRight = .9), 1200).capture)
    assertNull(session.next(face, 1300).capture)
    return 1300
  }
  @Test fun steadyPhotoCannotPassMovementCheck() {
    val session = FaceScanSession(rules, poses)
    for (time in 100L..10000L step 100) assertNull(session.next(face, time).capture)
    assertFalse(session.complete)
  }
  @Test fun tallFacesAndInsufficientEdgeMarginCannotPassAlignment() {
    val tall = FaceScanSession(rules,poses).next(face.copy(top=.01,height=.98),100)
    assertEquals("near",tall.hint)
    val edge = FaceScanSession(rules,poses).next(face.copy(top=.01),100)
    assertEquals("cropped",edge.hint)
    assertNull(tall.capture); assertNull(edge.capture)
  }
  @Test fun obscuredFeaturesInvalidateTheCompletedMovementCheck() {
    for (issue in listOf("occluded_eyes","occluded_lower")) {
      val session=FaceScanSession(rules,poses)
      ready(session)
      val blocked=session.next(face.copy(qualityIssue=issue),1400)
      assertEquals(issue,blocked.hint); assertTrue(blocked.reset)
      for (time in 1500L..4000L step 100) assertNull(session.next(face,time).capture)
    }
  }
  @Test fun openEyeScoresObservedInTheRealPortraitCanReachTheBlinkPrompt() {
    val session = FaceScanSession(rules, poses)
    var result: ScanDecision? = null
    for (time in 100L..1000L step 100) result = session.next(face.copy(blinkLeft = .27, blinkRight = .26), time)
    assertEquals("blink", result!!.hint); assertNull(result.capture)
  }
  @Test fun collectsThreeCorrectAnglesOnceAfterBlink() {
    val session = FaceScanSession(rules, poses)
    val captured = mutableListOf<String>()
    ready(session)
    for ((range, yaw) in listOf(1400L..2300L to 0.0, 2400L..3300L to 26.0, 3400L..4300L to -26.0)) {
      for (time in range step 100) session.next(face.copy(yaw = yaw), time).capture?.let { captured.add(it) }
    }
    assertEquals(listOf("front", "left", "right"), captured)
    assertTrue(session.complete)
    assertNull(session.next(face, 5000).capture)
  }
  @Test fun wrongAngleAndPoorQualityCannotTriggerCapture() {
    val session = FaceScanSession(rules, poses)
    ready(session)
    for (time in 1400L..2400L step 100) assertNull(session.next(face.copy(qualityIssue = "dark"), time).capture)
    for (time in 2500L..3500L step 100) assertNull(session.next(face.copy(yaw = 26.0), time).capture)
    for (time in 3600L..4600L step 100) assertNull(session.next(face.copy(qualityIssue = "blur"), time).capture)
    assertFalse(session.complete)
  }
  @Test fun noFaceMultiplePeopleAndTrackingJumpInvalidateActionCheck() {
    for (invalid in listOf(FaceObservation(0), FaceObservation(2), face.copy(left = .7))) {
      val session = FaceScanSession(rules, poses)
      ready(session)
      val result = if (invalid.count > 1) (1400L..1600L step 100).map { session.next(invalid,it) }.last()
        else session.next(invalid, if (invalid.count == 0) 3000 else 1400)
      assertTrue(result.reset)
      for (time in 3100L..5000L step 100) assertNull(session.next(face, time).capture)
    }
  }
  @Test fun aBlinkMustHaveOpenClosedOpenSequence() {
    val session = FaceScanSession(rules, poses)
    for (time in 100L..5000L step 100) assertNull(session.next(face.copy(blinkLeft = .9, blinkRight = .9), time).capture)
    for (time in 5100L..7000L step 100) assertNull(session.next(face, time).capture)
    assertFalse(session.complete)
  }
  @Test fun aFrameGapResetsTheHoldTimerAndRestartClearsCompletion() {
    val session = FaceScanSession(rules, listOf(front))
    ready(session)
    assertNull(session.next(face, 1900).capture)
    assertNull(session.next(face, 2000).capture)
    for (time in 2100L..2800L step 100) session.next(face, time)
    assertTrue(session.complete)
    session.restart()
    assertFalse(session.complete)
    assertNull(session.next(face, 3000).capture)
  }
  @Test fun sideReplacementRequiresFrontActionThenCorrectSide() {
    val session = FaceScanSession(rules, listOf(poses[1]), front)
    ready(session)
    for (time in 1400L..2500L step 100) assertNull(session.next(face, time).capture)
    val captures = (2600L..3500L step 100).mapNotNull { session.next(face.copy(yaw = 26.0), it).capture }
    assertEquals(listOf("left"), captures)
  }
}

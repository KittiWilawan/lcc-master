package com.looklancare.app.enrollment

import org.junit.Assert.*
import org.junit.Test

class FaceScanRegressionTest {
  private val rules = ScanRules(.22,.64,.5,.44,.16,.18,18.0,18.0,800,450,1500,.18,.35,.55,80,1200,.82,.025,3,300)
  @Test fun transientExtraFaceBlocksCaptureWithoutErasingTheOriginalIdentity() {
    val feed=Feed(session())
    try {
      feed.next(trusted,6)
      val pending=feed.next(FaceObservation(2),2)
      assertEquals("checking_scene",pending.hint); assertFalse(pending.reset); assertNull(pending.capture)
      // A one-face result is still checked against the original person after the uncertainty.
      val changed=feed.next(trusted.copy(evidence=FaceEvidence(doubleArrayOf(0.0,1.0),.99)))
      assertEquals("identity_changed",changed.hint); assertTrue(changed.reset)
    } finally { feed.scan.close() }
  }
  @Test fun persistentMultipleFacesResetOnceAndRemainBlocked() {
    val feed=Feed(session())
    try {
      feed.next(trusted,6)
      assertEquals("checking_scene",feed.next(FaceObservation(2),2).hint)
      val confirmed=feed.next(FaceObservation(2))
      assertEquals("multiple",confirmed.hint); assertTrue(confirmed.reset)
      val blocked=feed.next(FaceObservation(2),20)
      assertEquals("multiple",blocked.hint); assertFalse(blocked.reset); assertTrue(feed.captured.isEmpty())
      feed.next(trusted,20); assertTrue(feed.captured.isEmpty()); assertFalse(feed.scan.complete)
    } finally { feed.scan.close() }
  }
  private val poses = listOf(ScanPose("front",-12.0,12.0),ScanPose("left",18.0,42.0),ScanPose("right",-42.0,-18.0))
  private val trusted = FaceObservation(1,.3,.2,.4,.48,evidence=FaceEvidence(doubleArrayOf(1.0,0.0),.99))
  private fun session() = FaceScanSession(rules,poses,poses.first(),FaceAssuranceRules(.45,3,.8,3,450)) {
    FaceChallenge(FaceChallengeRules(250,250,30000,18.0,30.0),listOf("blink","left"),rules)
  }
  private class Feed(val scan: FaceScanSession) {
    var now = 0L
    val captured = mutableListOf<String>()
    fun next(face: FaceObservation, count: Int=1): ScanDecision {
      var result: ScanDecision? = null
      repeat(count) { now+=100; result=scan.next(face,now); result!!.capture?.let(captured::add) }
      return result!!
    }
  }
  @Test fun intermediateSoftEyelidFrameDoesNotEraseAPendingBlink() {
    val feed = Feed(session())
    try {
      assertEquals("blink", feed.next(trusted, 10).hint)
      feed.next(trusted.copy(blinkLeft=.44, blinkRight=.37, qualityIssue="eyes_blur"))
      feed.next(trusted.copy(blinkLeft=.75, blinkRight=.70, qualityIssue="eyes_blur"))
      assertEquals("challenge_left", feed.next(trusted, 5).hint)
      assertTrue(feed.captured.isEmpty())
    } finally { feed.scan.close() }
  }
  @Test fun prolongedSoftEyesCannotKeepAnOldBlinkAlive() {
    val feed = Feed(session())
    try {
      feed.next(trusted, 10)
      assertEquals("eyes_blur", feed.next(trusted.copy(blinkLeft=.44, blinkRight=.37, qualityIssue="eyes_blur"), 6).hint)
      feed.next(trusted.copy(blinkLeft=.9, blinkRight=.9, qualityIssue="eyes_blur"))
      assertEquals("blink", feed.next(trusted, 5).hint)
      assertTrue(feed.captured.isEmpty())
    } finally { feed.scan.close() }
  }
  @Test fun transitionStillRequiresSamePersonPassiveEvidenceAndProperGeometry() {
    val transitional = trusted.copy(blinkLeft=.44, blinkRight=.37, qualityIssue="eyes_blur")
    for ((face, expected) in listOf(
      transitional.copy(evidence=FaceEvidence(doubleArrayOf(0.0,1.0),.99)) to "identity_changed",
      transitional.copy(evidence=FaceEvidence(doubleArrayOf(1.0,0.0),.1)) to "suspected_spoof",
      transitional.copy(evidence=null) to "checking_face",
      transitional.copy(left=-.05,width=1.1) to "cropped",
      transitional.copy(qualityIssue="dark") to "dark",
      transitional.copy(blinkRight=.1) to "eyes_blur"
    )) {
      val feed = Feed(session())
      try { feed.next(trusted,10); assertEquals(expected,feed.next(face).hint); assertTrue(feed.captured.isEmpty()) }
      finally { feed.scan.close() }
    }
  }
  @Test fun requestedBlinkCanUseSoftClosedEyelidsButReferencesStayStrict() {
    val feed=Feed(session())
    try {
      assertEquals("blink",feed.next(trusted,6).hint)
      val closed=trusted.copy(blinkLeft=.9,blinkRight=.9,qualityIssue="eyes_blur")
      assertEquals("open_eyes",feed.next(closed,2).hint)
      feed.next(trusted,4)
      assertEquals("challenge_left",feed.next(trusted).hint)
      feed.next(trusted.copy(yaw=25.0),4); feed.next(trusted,4)
      // The action was completed, but local blur must never become a reference.
      val soft=feed.next(trusted.copy(qualityIssue="eyes_blur"),12)
      assertEquals("eyes_blur",soft.hint); assertFalse(soft.reset); assertTrue(feed.captured.isEmpty())
      feed.next(trusted,10); feed.next(trusted.copy(yaw=25.0),10); feed.next(trusted.copy(yaw=-25.0),10)
      assertEquals(listOf("front","left","right"),feed.captured); assertTrue(feed.scan.complete)
    } finally { feed.scan.close() }
  }
  @Test fun blinkExceptionCannotBypassIdentityPassiveOrWholeFrameQuality() {
    for (invalid in listOf(
      trusted.copy(qualityIssue="dark"), trusted.copy(qualityIssue="blur"), trusted.copy(qualityIssue="eyes_dark"),
      trusted.copy(qualityIssue="lower_blur"), trusted.copy(qualityIssue="features_missing"),
      trusted.copy(qualityIssue="eyes_blur",evidence=null),
      trusted.copy(qualityIssue="eyes_blur",evidence=FaceEvidence(doubleArrayOf(0.0,1.0),.99)),
      trusted.copy(qualityIssue="eyes_blur",evidence=FaceEvidence(doubleArrayOf(1.0,0.0),.1)))) {
      val feed=Feed(session())
      try {
        feed.next(trusted,6)
        val result=feed.next(invalid.copy(blinkLeft=.9,blinkRight=.9),2)
        assertNull(result.capture); assertNotEquals("open_eyes",result.hint)
        feed.next(trusted,14)
        assertTrue(feed.captured.isEmpty()); assertFalse(feed.scan.complete)
      } finally { feed.scan.close() }
    }
  }
  @Test fun cameraStallClearsDraftsAndRequiresActionsAgain() {
    val feed=Feed(session())
    try {
      feed.next(trusted,6); feed.next(trusted.copy(blinkLeft=.9,blinkRight=.9),2); feed.next(trusted,5)
      feed.next(trusted.copy(yaw=25.0),4); feed.next(trusted,14)
      assertEquals(listOf("front"),feed.captured)
      val stalled=feed.next(FaceObservation(0,qualityIssue="camera_stalled"))
      assertTrue(stalled.reset); assertEquals("camera_stalled",stalled.hint)
      feed.captured.clear(); feed.next(trusted,20)
      assertTrue(feed.captured.isEmpty()); assertFalse(feed.scan.complete)
    } finally { feed.scan.close() }
  }
  @Test fun aSoftClosedEyeFrameCannotAnchorOrSubstituteForTheWrongAction() {
    val feed=Feed(session())
    val closed=trusted.copy(qualityIssue="eyes_blur",blinkLeft=.9,blinkRight=.9)
    try {
      assertEquals("eyes_blur",feed.next(closed,6).hint)
      feed.next(trusted,6); feed.next(closed,2); feed.next(trusted,5)
      assertEquals("eyes_blur",feed.next(closed).hint)
      assertTrue(feed.captured.isEmpty())
    } finally { feed.scan.close() }
  }
}

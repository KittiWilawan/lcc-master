package com.looklancare.app.enrollment

import org.junit.Assert.*
import org.junit.Test

class FaceChallengeTest {
  private val motion=ScanRules(.22,.64,.5,.44,.16,.18,18.0,18.0,800,450,1500,.18,.35,.55,80,1200,.82,.025,3)
  private val rules=FaceChallengeRules(250,250,30000,18.0,30.0)
  private val face=FaceObservation(1,.3,.2,.4,.48)
  @Test fun staticFaceAndWrongDirectionCannotFinishRandomAction() {
    val challenge=FaceChallenge(rules,listOf("left","blink"),motion)
    for (time in 100L..5000L step 100) assertEquals("challenge_left",challenge.next(face,time,true))
    for (time in 5100L..7000L step 100) assertEquals("challenge_left",challenge.next(face.copy(yaw=-25.0),time,false))
    assertFalse(challenge.complete)
  }
  @Test fun bothActionOrdersRequireOpenCloseOpenAndReturnToFront() {
    for (order in listOf(listOf("left","blink"),listOf("blink","right"))) {
      val challenge=FaceChallenge(rules,order,motion)
      var now=0L
      fun feed(value:FaceObservation, front:Boolean, frames:Int) { repeat(frames) { now+=100; challenge.next(value,now,front) } }
      for (action in order) {
        if (action=="blink") {
          feed(face,true,1); feed(face.copy(blinkLeft=.9,blinkRight=.9),true,2); feed(face,true,1)
        } else feed(face.copy(yaw=if(action=="left")25.0 else -25.0),false,4)
        assertFalse(challenge.complete)
        feed(face,true,4)
      }
      assertTrue(challenge.complete)
    }
  }
  @Test fun interruptedClosedEyeCannotCountAsAnAction() {
    val challenge=FaceChallenge(rules,listOf("blink","left"),motion)
    challenge.next(face,100,true); challenge.next(face.copy(blinkLeft=.9,blinkRight=.9),200,true)
    challenge.interrupt()
    assertEquals("blink",challenge.next(face,400,true)); assertFalse(challenge.complete)
  }
  @Test fun actionDeadlineFailsClosed() {
    val challenge=FaceChallenge(rules,listOf("blink","right"),motion)
    challenge.next(face,100,true)
    assertEquals("challenge_timeout",challenge.next(face,30200,true))
  }
  @Test fun missingBiometricEvidenceCannotFinishProductionSession() {
    val poses=listOf(ScanPose("front",-12.0,12.0),ScanPose("left",18.0,42.0),ScanPose("right",-42.0,-18.0))
    val session=FaceScanSession(motion,poses,poses.first(),FaceAssuranceRules(.45,3,.8,3,450)) {
      FaceChallenge(rules,listOf("blink","left"),motion)
    }
    for(time in 100L..5000L step 100) assertNull(session.next(face,time).capture)
    assertFalse(session.complete)
  }
  @Test fun secureFlowCapturesAllAnglesAndRejectsSamePositionReplacement() {
    val poses=listOf(ScanPose("front",-12.0,12.0),ScanPose("left",18.0,42.0),ScanPose("right",-42.0,-18.0))
    fun session()=FaceScanSession(motion,poses,poses.first(),FaceAssuranceRules(.45,3,.8,3,450)) {
      FaceChallenge(rules,listOf("left","blink"),motion)
    }
    val trusted=face.copy(evidence=FaceEvidence(doubleArrayOf(1.0,0.0),.99))
    for(swap in listOf(false,true)) {
      val scan=session(); val captured=mutableListOf<String>(); var now=0L
      fun feed(value:FaceObservation,frames:Int) { repeat(frames) { now+=100; scan.next(value,now).capture?.let(captured::add) } }
      feed(trusted,6); feed(trusted.copy(yaw=25.0),4); feed(trusted,4)
      feed(trusted.copy(blinkLeft=.9,blinkRight=.9),2); feed(trusted,14)
      assertEquals(listOf("front"),captured)
      if(swap) {
        now+=100
        val decision=scan.next(trusted.copy(yaw=25.0,evidence=FaceEvidence(doubleArrayOf(0.0,1.0),null)),now)
        assertEquals("identity_changed",decision.hint); assertTrue(decision.reset); assertNull(decision.capture)
        feed(trusted.copy(yaw=25.0),12); assertFalse(scan.complete)
      } else {
        feed(trusted.copy(yaw=25.0),10); feed(trusted.copy(yaw=-25.0),10)
        assertEquals(listOf("front","left","right"),captured); assertTrue(scan.complete)
      }
      scan.close()
    }
  }
}

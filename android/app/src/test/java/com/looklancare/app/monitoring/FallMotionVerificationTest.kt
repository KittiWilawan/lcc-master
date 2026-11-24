package com.looklancare.app.monitoring

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FallMotionVerificationTest {
  private val verification = FallMotionVerification(
    FallVerificationPolicy(.36, .16, .16, .65, .50, .88, .20),
    FallEvidencePolicy(.7, 2, 900, 2, 5000))
  private fun sample(t: Long, original: Double? = .8, verifier: Double? = .9,
                     pose: Double? = .8, descent: Double = .25, landing: Boolean = false) =
    verification.observe(t, pose, landing, original, verifier, descent)

  @Test fun additionalFallNeedsIndependentPeaksAndCurrentPoseOnTheSameTrack() {
    val subject = FallMotionVerification(FallVerificationPolicy(.36, .16, .16, .65, .50, .93, .20, .85, .85),
      FallEvidencePolicy(.45, 2, 900, 2, 5000))
    subject.observe(100, .5, false, .88, .94, .25)
    subject.observe(400, .80, false, .70, .65, .05)
    assertFalse(subject.additionalFall)
    subject.observe(700, .90, false, .70, .96, .30)
    assertFalse(subject.additionalFall)
    subject.observe(1000, .90, false, .86, .62, .05)
    assertTrue(subject.additionalFall)
    subject.clear()
    subject.observe(1100, .95, false, .95, .95, .25)
    assertFalse(subject.additionalFall)
    subject.observe(2400, .95, false, .95, .95, .25)
    assertFalse(subject.additionalFall)
  }

  @Test fun landingUsesAbsoluteSupportOrAgreementAndPreservesMissingEvidence() {
    sample(100, .65, .22)
    assertFalse(verification.allowsLanding)
    sample(400, .30, .19)
    assertTrue(verification.allowsLanding)
    sample(700, .1, .15)
    assertFalse(verification.allowsLanding)
    sample(1000, .85, .36)
    assertTrue(verification.allowsLanding)
    sample(1300, null, null)
    assertTrue(verification.allowsLanding)
    assertFalse(verification.additionalFall)
  }

  @Test fun confirmationNeedsTwoFreshSamplesWithDescent() {
    sample(100, descent = .05)
    assertFalse(verification.additionalFall)
    sample(400, descent = .12)
    assertFalse(verification.additionalFall)
    sample(700, verifier = .60)
    assertTrue(verification.additionalFall)
    sample(1000, verifier = .60)
    assertFalse(verification.additionalFall)
    sample(1300, pose = null)
    sample(1600)
    assertFalse(verification.additionalFall)
  }

  @Test fun staleTracksWeakeningPostureAndMissingAgreementCannotConfirm() {
    sample(100)
    sample(1100)
    assertFalse(verification.additionalFall)
    sample(1400, pose = .6)
    assertFalse(verification.additionalFall)
    sample(1700, original = .60)
    sample(2000)
    assertFalse(verification.additionalFall)
    verification.clear()
    sample(2300)
    assertFalse(verification.additionalFall)
    sample(2600, pose = .6, landing = true)
    assertTrue(verification.additionalFall)
  }
}

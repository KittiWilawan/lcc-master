package com.looklancare.app.monitoring

import org.junit.Assert.*
import org.junit.Test

class SceneMotionTest {
  private val policy = MotionPolicy(12, 8, 12, 0.1, 2, 3, 0.4f, 900)
  private val left = PoseBounds(0f, 0f, 0.5f, 1f)
  private val right = PoseBounds(0.5f, 0f, 1f, 1f)
  private fun frame(base: Int, moving: Boolean = false) = ByteArray(96) { i ->
    (if (moving && i % 12 in 8..10 && i / 12 in 2..4) base + 90 else base).toByte()
  }

  @Test fun lightingAndMotionElsewhereDoNotVerifyAStaticBox() {
    val scene = SceneMotion(policy)
    scene.update(frame(20), 100)
    scene.update(frame(70), 400)
    assertFalse(scene.supports(left))
    assertNull(scene.uncovered(emptyList()))
    scene.update(frame(70, true), 700)
    assertFalse(scene.supports(left))
    assertTrue(scene.supports(right))
  }

  @Test fun uncoveredMovementCanBeDiscoveredWithoutConsumingAnExistingBox() {
    val scene = SceneMotion(policy)
    scene.update(frame(20), 100)
    scene.update(frame(20, true), 400)
    assertNull(scene.uncovered(listOf(right)))
    val region = requireNotNull(scene.uncovered(listOf(left)))
    assertTrue(scene.belongsTo(region, right))
    assertFalse(scene.belongsTo(region, left))
    val crop = requireNotNull(scene.searchCrop(region, 640, 360, 2f, 40))
    assertTrue(crop.left >= 0 && crop.top >= 0 && crop.left + crop.width <= 640 && crop.top + crop.height <= 360)
  }

  @Test fun aPauseRetainsRecentMotionButNotAStaleDiscovery() {
    val scene = SceneMotion(policy)
    scene.update(frame(10), 100)
    scene.update(frame(10, true), 400)
    scene.update(frame(10, true), 700)
    assertTrue(scene.supports(right))
    assertNull(scene.uncovered(emptyList()))
    scene.update(frame(10), 2000)
    assertFalse(scene.supports(right))
  }

  @Test fun inconsistentOrOccludedPostureCannotVetoAFall() {
    val check = UprightPose(listOf(listOf(0, 1, 2, 3)), 0.65f, 0.82f)
    val standing = List(4) { PosePoint(0.5f, 0.15f + 0.2f * it, 0f, 0.95f) }
    assertTrue(check.visible(standing, 640, 360))
    assertFalse(check.visible(standing.map { PosePoint(it.y, it.x, 0f, it.visibility) }, 640, 360))
    assertFalse(check.visible(standing.dropLast(1) + standing.last().copy(visibility = 0.1f), 640, 360))
    assertFalse(check.visible(standing.take(2), 640, 360))
  }

  @Test fun recentlyDiscoveredPersonCanBeSearchedAfterLandingBesideAnotherPerson() {
    val scene = SceneMotion(policy)
    scene.update(frame(20), 100)
    scene.update(frame(20, true), 400)
    val region = requireNotNull(scene.uncovered(listOf(left)))
    scene.update(frame(20, true), 700)
    assertEquals(region, scene.uncovered(listOf(left)))
    assertNull(scene.uncovered(listOf(right)))
    scene.update(frame(20, true), 1200)
    scene.update(frame(20, true), 1500)
    assertNull(scene.uncovered(listOf(left)))
    val thin = PoseBounds(0.45f, 0.4f, 0.58f, 0.44f)
    assertNull(PoseCrop.around(thin, 640, 320, 2.25f, 48))
    assertNotNull(scene.searchCrop(thin, 640, 320, 2.25f, 48))
  }

  @Test fun landingNeedsASupportedHighFromTheSameUninterruptedTrack() {
    val transition = FallTransition(DescentPolicy(1800, 900, 0.3f, 0.4f))
    val up = PoseBounds(0.45f, 0.2f, 0.51f, 0.5f)
    val low = PoseBounds(0.4f, 0.41f, 0.56f, 0.5f)
    transition.score(up, 1.8f, 100, 0.2, false, 0.45)
    transition.score(low, 1.8f, 400, 0.8, false, 0.45)
    assertEquals(0.5, transition.score(low, 1.8f, 700, 0.2, true, 0.45), 0.00001)
    assertEquals(0.2, transition.score(low, 1.8f, 1000, 0.2, true, 0.45), 0.00001)
    transition.clear()
    assertEquals(0.2, transition.score(low, 1.8f, 1300, 0.2, true, 0.45), 0.00001)
    transition.score(up, 1.8f, 1600, 0.8, false, 0.45)
    assertEquals(0.2, transition.score(low, 1.8f, 2800, 0.2, true, 0.45), 0.00001)
  }
}

package com.looklancare.app.monitoring

import org.junit.Assert.*
import org.junit.Test

class PoseRecoveryTest {
  private fun pose(offset: Float = 0f, quality: Float = 0.9f, reversed: Boolean = false): PoseObservation {
    val points = List(12) { index ->
      val x = (if (reversed) 11 - index else index).toFloat() / 40 + 0.3f + offset
      PosePoint(x, index.toFloat() / 20 + 0.15f, 0f, quality)
    }
    return checkNotNull(PoseObservation.create(points, 12, 0.35f))
  }
  private val reducer = PoseObservationReducer(PoseDuplicatePolicy(0.65f, 0.08f, 8, 0.35f))

  @Test fun duplicateSkeletonKeepsOnlyTheBetterObservation() {
    val weak = pose(quality = 0.5f)
    val strong = pose(offset = 0.005f)
    assertEquals(listOf(strong), reducer.reduce(listOf(weak, strong)))
  }

  @Test fun overlappingDifferentSkeletonsAreBothRetained() {
    val first = pose()
    val second = pose(reversed = true)
    assertEquals(1f, first.bounds.overlap(second.bounds), 0.00001f)
    assertEquals(2, reducer.reduce(listOf(first, second)).size)
  }

  @Test fun tooFewSharedVisibleJointsCannotMergePeople() {
    val first = pose()
    val partial = first.copy(points = first.points.mapIndexed { index, point -> point.copy(visibility = if (index < 3) 1f else 0f) })
    assertEquals(2, reducer.reduce(listOf(first, partial)).size)
  }

  @Test fun cropRotationRestoresOriginalImageAndDepthCoordinates() {
    val crop = PoseCrop(20, 10, 80, 40)
    val upright = PosePoint(0.25f, 0.75f, 0.1f, 0.9f)
    val expected = crop.restore(listOf(upright), 200, 100, 0).single()
    val clockwise = PosePoint(1 - upright.y, upright.x, upright.z * crop.width / crop.height, upright.visibility)
    val counterclockwise = PosePoint(upright.y, 1 - upright.x, upright.z * crop.width / crop.height, upright.visibility)
    for ((rotation, point) in listOf(90 to clockwise, -90 to counterclockwise)) {
      val actual = crop.restore(listOf(point), 200, 100, rotation).single()
      assertEquals(expected.x, actual.x, 0.00001f)
      assertEquals(expected.y, actual.y, 0.00001f)
      assertEquals(expected.z, actual.z, 0.00001f)
      assertEquals(expected.visibility, actual.visibility, 0f)
    }
    assertEquals(0.2f, expected.x, 0.00001f)
    assertEquals(0.4f, expected.y, 0.00001f)
  }

  @Test fun cropIsClippedAtImageEdgesWithoutStretchingCoordinates() {
    val crop = checkNotNull(PoseCrop.around(PoseBounds(-0.1f, 0.7f, 0.3f, 1.1f), 200, 100, 2f, 20))
    assertEquals(0, crop.left)
    assertEquals(100, crop.top + crop.height)
    val edge = crop.restore(listOf(PosePoint(1f, 1f, 0f, 1f)), 200, 100, 0).single()
    assertEquals(1f, edge.y, 0f)
    assertNull(PoseCrop.around(PoseBounds(1.2f, 1.2f, 1.3f, 1.3f), 200, 100, 1f, 20))
  }

  private fun tracker() = PoseTrackAssociator(TrackAssociationPolicy(1200, 0.2f, 0.7f, 0.45f, 0.5f, 0.8f,
    0.65f, 0.25f, 0.1f, 1f, 3, 0.45f, 0.2f))

  @Test fun clothingDescriptorKeepsTracksWhenPeopleOverlapAndOrderReverses() {
    val tracker = tracker()
    val sameBounds = PoseBounds(0.3f, 0.1f, 0.6f, 0.9f)
    val red = floatArrayOf(1f, 0f)
    val blue = floatArrayOf(0f, 1f)
    val first = tracker.associate(listOf(sameBounds, sameBounds), 1000, listOf(red, blue))
    val next = tracker.associate(listOf(sameBounds, sameBounds), 1300, listOf(blue, red))
    assertArrayEquals(intArrayOf(first[1], first[0]), next)
  }

  @Test fun recoveryPreviewDoesNotAdvanceTrackingOrReuseExpiredPeople() {
    val tracker = tracker()
    val first = PoseBounds(0.1f, 0.1f, 0.3f, 0.9f)
    val second = PoseBounds(0.6f, 0.1f, 0.8f, 0.9f)
    val ids = tracker.associate(listOf(first, second), 1000)
    assertEquals(listOf(first), tracker.missingBounds(listOf(second), 1300))
    assertEquals(listOf(first), tracker.missingBounds(listOf(second), 1300))
    assertEquals(ids[1], tracker.associate(listOf(second), 1300).single())
    assertTrue(tracker.missingBounds(emptyList(), 3000).isEmpty())
  }
}

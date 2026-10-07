package com.looklancare.app.monitoring

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream

class PoseFeaturesTest {
  @Test fun invariantCoordinatesIgnoreTranslationAndUniformScale() {
    val extractor = PoseFeatures(33, 0.35f, 0.05f, "invariant")
    val original = List(33) { index -> PosePoint(index / 50f, (index % 8) / 10f, index / 100f, 1f) }
    val moved = original.map { PosePoint(it.x * 2f + 0.1f, it.y * 2f + 0.2f, it.z * 2f + 0.3f, it.visibility) }
    val first = extractor.sequence(listOf(extractor.normalize(original)))
    val second = extractor.sequence(listOf(extractor.normalize(moved)))
    assertArrayEquals(first, second, 1e-5f)
  }
  @Test fun emptyPoseWindowsRemainFinite() {
    val extractor = PoseFeatures(33, 0.35f, 0.05f, "invariant_temporal")
    val result = extractor.sequence(List(4) { FloatArray(extractor.frameSize) })
    assertEquals(1452, result.size); assertTrue(result.all { it.isFinite() && it == 0f })
  }
  @Test fun threeFrameTemporalFeaturesPreserveImageMotion() {
    val extractor = PoseFeatures(33, 0.35f, 0.05f, "temporal")
    val original = List(33) { index -> PosePoint(index / 50f, (index % 8) / 10f, index / 100f, 1f) }
    val moved = original.map { PosePoint(it.x + 0.1f, it.y + 0.2f, it.z, it.visibility) }
    val first = extractor.normalize(original)
    val result = extractor.sequence(listOf(first, first, extractor.normalize(moved)))
    assertEquals(1242, result.size)
    val secondDelta = 3 * extractor.frameSize + extractor.frameSize
    assertEquals(0.1f, result[secondDelta + 33 * 4], 1e-5f)
    assertEquals(0.2f, result[secondDelta + 33 * 4 + 1], 1e-5f)
  }
  @Test fun invalidLandmarksAreRejected() {
    val extractor = PoseFeatures(33, 0.35f, 0.05f, "temporal")
    assertThrows(IllegalArgumentException::class.java) { extractor.normalize(List(33) { PosePoint(Float.NaN, 0f, 0f, 1f) }) }
  }
  @Test fun corruptedTreeCyclesAreRejected() {
    val bytes = ByteArrayOutputStream()
    DataOutputStream(bytes).use { output ->
      output.writeInt(1); output.writeInt(1); output.writeInt(1); output.writeInt(1)
      output.writeInt(0); output.writeInt(0); output.writeInt(0); output.writeDouble(0.5); output.writeDouble(0.5)
    }
    assertThrows(IllegalArgumentException::class.java) { PoseForest(ByteArrayInputStream(bytes.toByteArray())) }
  }
}

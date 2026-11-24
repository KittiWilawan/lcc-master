package com.looklancare.app.imaging

import org.junit.Assert.*
import org.junit.Test

class FrameSizingTest {
  @Test fun fullHdSnapshotRetainsEnoughPixelsForTheAnalysisFrame() {
    val sample = FrameSizing.decodeSample(1920, 1080, 640)
    assertEquals(2, sample)
    assertEquals(640 to 360, FrameSizing.fit(1920 / sample, 1080 / sample, 640))
  }

  @Test fun referencePhotoKeepsItsConfiguredDetailWithoutEnlargingTheInput() {
    assertEquals(1, FrameSizing.decodeSample(1280, 720, 960))
    assertEquals(960 to 540, FrameSizing.fit(1280, 720, 960))
    assertEquals(640 to 480, FrameSizing.fit(640, 480, 960))
  }

  @Test fun portraitAndLargeSnapshotsAreBoundedWithoutPrematureDownsampling() {
    for ((width, height) in listOf(1080 to 1920, 4032 to 3024, 1280 to 720)) {
      val sample = FrameSizing.decodeSample(width, height, 640)
      assertTrue(maxOf(width, height) / sample >= 640)
      assertTrue(maxOf(width, height) / sample < 1280)
      assertEquals(640, FrameSizing.fit(width / sample, height / sample, 640).let { maxOf(it.first, it.second) })
    }
  }

  @Test fun smallFramesAreNeverUpscaledAndThinFramesRemainValid() {
    assertEquals(1, FrameSizing.decodeSample(320, 240, 640))
    assertEquals(320 to 240, FrameSizing.fit(320, 240, 640))
    assertEquals(640 to 1, FrameSizing.fit(8000, 1, 640))
  }

  @Test fun extremeMetadataDoesNotOverflowTheSamplingLoop() {
    assertEquals(1073741824, FrameSizing.decodeSample(Int.MAX_VALUE, 1, 1))
  }

  @Test fun lowResolutionStreamCannotPassFacePixelLimitsByBeingEnlarged() {
    assertEquals(320 to 240, FrameSizing.fitVideo(320, 240, 1f, 640))
    assertEquals(640 to 360, FrameSizing.fitVideo(1920, 1080, 1f, 640))
  }

  @Test fun nonSquareVideoPixelsKeepDisplayAspectWithoutInventingExtraPixels() {
    assertEquals(640 to 240, FrameSizing.fitVideo(640, 480, 2f, 640))
    assertEquals(320 to 480, FrameSizing.fitVideo(640, 480, 0.5f, 640))
    assertEquals(320 to 240, FrameSizing.fitVideo(320, 240, Float.NaN, 640))
    assertEquals(320 to 240, FrameSizing.fitVideo(320, 240, 0f, 640))
  }

  @Test fun invalidDimensionsAreRejected() {
    for (dimensions in listOf(Triple(0, 10, 640), Triple(10, -1, 640), Triple(10, 10, 0))) {
      assertThrows(IllegalArgumentException::class.java) { FrameSizing.decodeSample(dimensions.first, dimensions.second, dimensions.third) }
      assertThrows(IllegalArgumentException::class.java) { FrameSizing.fit(dimensions.first, dimensions.second, dimensions.third) }
    }
  }
}

package com.looklancare.app.enrollment

import org.junit.Assert.*
import org.junit.Test

class SceneFaceGeometryTest {
  private val rules=FaceSceneRules(.5,.25,.25,.3,.5,2,2.0)
  @Test fun verificationContextPreservesTheCentreAndClipsToImageEdges() {
    val middle=FaceRegion(.3,.2,.2,.2).expanded(2.0)
    assertEquals(.2,middle.left,.000001); assertEquals(.1,middle.top,.000001)
    assertEquals(.4,middle.width,.000001); assertEquals(.4,middle.height,.000001)
    val edge = FaceRegion(.0,.0,.1,.1).expanded(2.0)
    assertEquals(0.0, edge.left, 0.000001); assertEquals(0.0, edge.top, 0.000001)
    assertEquals(.15, edge.width, 0.000001); assertEquals(.15, edge.height, 0.000001)
  }
  @Test fun overlappingCropsOfTheSameFaceAreMerged() {
    val face=FaceRegion(.3,.2,.3,.4)
    assertTrue(face.sameFace(FaceRegion(.29,.19,.32,.42),rules))
  }
  @Test fun smallBackgroundFaceAndNeighbourAreKeptSeparate() {
    val face=FaceRegion(.3,.2,.3,.4)
    assertFalse(face.sameFace(FaceRegion(.85,.03,.05,.08),rules))
    assertFalse(face.sameFace(FaceRegion(.63,.2,.3,.4),rules))
    // A small separate face inside a larger region is not silently merged merely due to containment.
    assertFalse(face.sameFace(FaceRegion(.4,.3,.05,.08),rules))
  }
}

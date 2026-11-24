package com.looklancare.app.enrollment

import org.junit.Assert.*
import org.junit.Test

class FaceSimilarityTransformTest {
  @Test fun canvasPixelCentresMapToTheSameIntegerCentreAsOpenCv() {
    val original=floatArrayOf(0f,-2f,30f,2f,0f,10f,0f,0f,1f)
    val canvas=FaceSimilarityTransform.forCanvas(original)
    val x=2f; val y=3f
    assertEquals(original[0]*x+original[1]*y+original[2]+.5f,canvas[0]*(x+.5f)+canvas[1]*(y+.5f)+canvas[2],.00001f)
    assertEquals(original[3]*x+original[4]*y+original[5]+.5f,canvas[3]*(x+.5f)+canvas[4]*(y+.5f)+canvas[5],.00001f)
    assertEquals(30f,original[2],0f)
  }
  @Test fun recoversRotationScaleAndTranslationFromIndependentPointPairs() {
    val source=listOf(ImagePoint(2.0,3.0),ImagePoint(8.0,3.0),ImagePoint(5.0,7.0),ImagePoint(3.0,9.0),ImagePoint(7.0,9.0))
    val expected=floatArrayOf(0f,-2f,30f,2f,0f,10f,0f,0f,1f)
    val target=source.map { ImagePoint(-2*it.y+30,2*it.x+10) }
    assertArrayEquals(expected,FaceSimilarityTransform.fit(source,target),.00001f)
  }
  @Test fun zeroSpreadAndNonFiniteLandmarksCannotCreateAModelInput() {
    for(points in listOf(listOf(ImagePoint(1.0,1.0),ImagePoint(1.0,1.0)),listOf(ImagePoint(Double.NaN,1.0),ImagePoint(2.0,2.0)))) {
      assertThrows(IllegalArgumentException::class.java) { FaceSimilarityTransform.fit(points,listOf(ImagePoint(2.0,3.0),ImagePoint(3.0,4.0))) }
    }
  }
}

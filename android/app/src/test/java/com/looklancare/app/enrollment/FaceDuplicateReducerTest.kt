package com.looklancare.app.enrollment

import org.junit.Assert.*
import org.junit.Test

class FaceDuplicateReducerTest {
  private val policy = FaceDuplicatePolicy(.75,.12,.85,.12)
  private fun mesh(x: Double, y: Double) = listOf(ImagePoint(x,y),ImagePoint(x+.1,y+.05),ImagePoint(x+.05,y+.15))
  @Test fun almostIdenticalTrackedMeshesAreOneFace() {
    val kept = FaceDuplicateReducer.indices(listOf(FaceRegion(.3,.2,.3,.4),FaceRegion(.31,.21,.29,.39)),listOf(mesh(.3,.2),mesh(.31,.21)),policy)
    assertEquals(listOf(0),kept)
  }
  @Test fun separatePeopleAndOverlappingFacesRemainSeparate() {
    for (offset in listOf(.15,.4)) assertEquals(2,FaceDuplicateReducer.indices(
      listOf(FaceRegion(.2,.2,.3,.4),FaceRegion(.2+offset,.2,.3,.4)),listOf(mesh(.2,.2),mesh(.2+offset,.2)),policy).size)
  }
  @Test fun differentMeshesCannotBeMergedByBoundingBoxAlone() {
    assertEquals(2,FaceDuplicateReducer.indices(listOf(FaceRegion(.3,.2,.3,.4),FaceRegion(.3,.2,.3,.4)),
      listOf(mesh(.3,.2),mesh(.4,.3)),policy).size)
  }
  @Test fun missingOrInvalidGeometryNeverCreatesAConfidentDuplicate() {
    assertEquals(2,FaceDuplicateReducer.indices(listOf(FaceRegion(.3,.2,.3,.4),FaceRegion(.3,.2,.3,.4)),
      listOf(emptyList(),emptyList()),policy).size)
  }
}

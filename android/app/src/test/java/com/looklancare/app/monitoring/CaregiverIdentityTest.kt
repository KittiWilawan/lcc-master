package com.looklancare.app.monitoring

import java.io.File
import org.junit.Assert.*
import org.junit.Test

class CaregiverIdentityTest {
  private val alice = IdentityCandidate("a", "A", .95)
  private val bob = IdentityCandidate("b", "B", .95)

  @Test fun crossingNeedsFreshAgreementAndExclusiveFaceOwnership() {
    val claims = CrowdFaceClaims(listOf(alice, bob))
    val id = TrackIdentity(IdentityRules(.55,.10,2,1500,3000))
    fun observe(t: Long, shared: Boolean) = id.observe(alice,t,claims.isAmbiguous(true,shared,alice.memberId,null))
    assertNull(observe(100,false).memberId)
    assertEquals("a",observe(400,false).memberId)
    assertNull(observe(700,true).memberId)
    assertNull(observe(1000,false).memberId)
    assertEquals("a",observe(1300,false).memberId)
  }

  @Test fun nameCannotRemainOnAnotherTrackOrOnTwoMatchingFaces() {
    assertTrue(CrowdFaceClaims(listOf(alice)).isAmbiguous(false,false,null,"a"))
    assertTrue(CrowdFaceClaims(listOf(alice,alice)).isAmbiguous(false,false,"a",null))
    assertTrue(CrowdFaceClaims(emptyList()).isAmbiguous(true,false,null,"a"))
    assertFalse(CrowdFaceClaims(listOf(bob)).isAmbiguous(false,false,null,"a"))
  }

  @Test fun corruptMissingOrOversizeImageCanBeOmittedFromEvent() {
    val file = File.createTempFile("evidence-test", ".jpg")
    try {
      val uri = file.toURI().toString()
      assertNull(readDeliveryImage(uri,4))
      file.writeBytes(byteArrayOf(1,2)); assertNull(readDeliveryImage(uri,4))
      val bytes = byteArrayOf(0xff.toByte(),0xd8.toByte(),1)
      file.writeBytes(bytes); assertNull(readDeliveryImage(uri,2))
      assertArrayEquals(bytes,readDeliveryImage(uri,4))
      assertNull(readDeliveryImage("not a URI",4))
    } finally { file.delete() }
    assertNull(readDeliveryImage(file.toURI().toString(),4))
  }
}

package com.looklancare.app.enrollment

import android.graphics.BitmapFactory
import android.os.SystemClock
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import kotlin.math.abs

/** Public image fixtures only. This verifies Android model parity, not real camera liveness. */
class FaceSecurityEvaluationTest {
  private val context=InstrumentationRegistry.getInstrumentation().targetContext
  @Test fun modelParityIdentityPairsAndPassiveSamples() {
    require(context.packageName.endsWith(".faceaudit.release"))
    val root=File(context.getExternalFilesDir(null),"face-security")
    val manifest=JSONObject(File(root,"desktop-results.json").readText()).getJSONArray("fixtures")
    val parity=JSONArray(File(root,"security-parity.json").readText())
    val config=FaceScanConfig.load(context)
    val groups=config.security.getJSONObject("identity").getJSONArray("landmarkGroups")
    val rows=JSONArray(); var reference:DoubleArray?=null
    val vectors=mutableMapOf<String,DoubleArray>()
    try {
      FaceSecurityModels(context,config.security).use { models ->
        for(i in 0 until parity.length()) {
          val target=parity.getJSONObject(i); val name=target.getString("name")
          val source=(0 until manifest.length()).map { manifest.getJSONObject(it) }.single { it.getString("name")==name }
          val bitmap=BitmapFactory.decodeFile(File(root,"$name.jpg").absolutePath)
          assertNotNull(bitmap)
          val points=MutableList(478) { ImagePoint(0.0,0.0) }
          val original=target.getJSONArray("sourcePoints")
          for(group in 0 until groups.length()) {
            val p=original.getJSONArray(group)
            val indices=groups.getJSONArray(group)
            for(j in 0 until indices.length()) points[indices.getInt(j)]=ImagePoint(p.getDouble(0)/bitmap.width,p.getDouble(1)/bitmap.height)
          }
          val bounds=source.getJSONArray("faceBounds")
          val face=FaceObservation(1,bounds.getDouble(0),bounds.getDouble(1),bounds.getDouble(2),bounds.getDouble(3))
          try {
            val start=SystemClock.elapsedRealtimeNanos()
            val evidence=models.inspect(bitmap,points,face,true)
            val elapsed=(SystemClock.elapsedRealtimeNanos()-start)/1_000_000.0
            assertFalse(bitmap.isRecycled)
            val expected=target.getJSONArray("embedding").let { a -> DoubleArray(a.length()) { a.getDouble(it) } }
            val parityCosine=FaceVectors.cosine(expected,evidence.embedding)!!
            assertTrue("Android/Python aligned embedding parity $name=$parityCosine",parityCosine>.98)
            assertNotNull(evidence.liveScore); assertTrue(evidence.liveScore!! in 0.0..1.0)
            vectors[name]=evidence.embedding
            if(name=="aligned-clear") reference=evidence.embedding
            val cosine=FaceVectors.cosine(reference!!,evidence.embedding)!!
            val kind=source.getString("kind")
            if(kind=="same") assertTrue("Same source portrait under variations: $name",cosine>=config.assuranceRules.similarity)
            if(kind=="different") assertTrue("Different public individuals: $name",cosine<config.assuranceRules.similarity)
            if(kind=="author_live") assertTrue(evidence.liveScore!!>=config.assuranceRules.liveThreshold)
            if(kind=="author_spoof") assertTrue(evidence.liveScore!!<config.assuranceRules.liveThreshold)
            rows.put(JSONObject().put("name",name).put("kind",kind).put("parityCosine",parityCosine)
              .put("cosineToReference",cosine).put("liveScore",evidence.liveScore)
              .put("desktopLiveDelta",abs(evidence.liveScore!!-source.getDouble("liveScore"))).put("elapsedMs",elapsed))
          } finally { bitmap.recycle() }
        }
      }
      // The continuity domain rejects a different person's real model embedding at identical coordinates.
      val guard=FaceAssurance(config.assuranceRules)
      for(time in 100L..600L step 100) guard.assess(FaceEvidence(reference!!,.99),true,time)
      assertTrue(guard.anchored)
      assertEquals("identity_changed",guard.assess(FaceEvidence(vectors.getValue("control-person-1"),null),false,700))
      guard.clear()
      // Repeat through the actual VIDEO landmark/quality/scene adapter used by the camera.
      val pipeline=JSONArray(); var pipelineReference:DoubleArray?=null
      for(i in 0 until manifest.length()) {
        val source=manifest.getJSONObject(i); val kind=source.getString("kind")
        if(kind!="reference" && kind!="same" && kind!="different") continue
        val name=source.getString("name")
        val bitmap=BitmapFactory.decodeFile(File(root,"$name.jpg").absolutePath)
        try {
          FaceScanAnalyzer(context,config).use { analyzer ->
            var observed=FaceObservation(0)
            repeat(3) { observed=analyzer.inspect(bitmap,(it+1)*100L) }
            assertEquals(1,observed.count); assertNull(observed.qualityIssue)
            val evidence=observed.evidence
            assertNotNull("Valid production image must have model evidence: $name",evidence)
            if(kind=="reference") pipelineReference=evidence!!.embedding.copyOf()
            val similarity=FaceVectors.cosine(pipelineReference!!,evidence!!.embedding)!!
            if(kind=="same") assertTrue(similarity>=config.assuranceRules.similarity)
            if(kind=="different") assertTrue(similarity<config.assuranceRules.similarity)
            pipeline.put(JSONObject().put("name",name).put("kind",kind).put("cosineToReference",similarity)
              .put("liveScore",evidence.liveScore ?: JSONObject.NULL).put("yaw",observed.yaw))
            evidence.embedding.fill(0.0)
          }
        } finally { bitmap.recycle() }
      }
      pipelineReference?.fill(0.0)
      File(root,"android-pipeline-results.json").writeText(JSONObject().put("fixtures",pipeline).toString(2))
    } finally {
      File(root,"android-results.json").writeText(JSONObject().put("fixtures",rows).put("completedFixtures",rows.length()).toString(2))
      vectors.values.forEach { it.fill(0.0) }
    }
    assertEquals(parity.length(),rows.length())
  }
}

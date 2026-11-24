package com.looklancare.app.enrollment

import android.graphics.BitmapFactory
import android.os.SystemClock
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.MessageDigest

/** Exercises the delivered native models/domain on clip frames. It does not simulate optical screen replay. */
class FaceVideoAuditTest {
  private val context=InstrumentationRegistry.getInstrumentation().targetContext
  @Test fun evaluatePublicClipsAndDerivedReplayScenarios() {
    require(context.packageName.endsWith(".faceaudit.release"))
    val external=requireNotNull(context.getExternalFilesDir(null)).canonicalFile
    val root=File(external,InstrumentationRegistry.getArguments().getString("auditDirectory","face-video-audit")).canonicalFile
    require(root.path.startsWith(external.path+File.separator))
    val manifest=JSONObject(File(root,"manifest.json").readText())
    val config=FaceScanConfig.load(context)
    val bytes=context.assets.open("enrollment/scan.json").use { it.readBytes() }
    val hash=MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    require(hash==manifest.getString("scanConfigSha256"))
    val cases=manifest.getJSONArray("cases"); val rows=JSONArray()
    val challengeValues=config.security.getJSONObject("challenge")
    val challengeRules=FaceChallengeRules(challengeValues.getLong("turnHoldMs"),challengeValues.getLong("returnHoldMs"),
      challengeValues.getLong("timeoutMs"),challengeValues.getDouble("minTurnDegrees"),challengeValues.getDouble("maxTurnDegrees"))
    try {
      for(i in 0 until cases.length()) {
        val input=cases.getJSONObject(i); val frames=input.getJSONArray("frames")
        val plans=manifest.getJSONObject("config").getJSONArray("challenges")
        val sessions=mutableListOf(config.session("all"))
        val sessionNames=mutableListOf("production_random")
        for(j in 0 until plans.length()) {
          val plan=plans.getJSONArray(j).let { a -> (0 until a.length()).map { a.getString(it) } }
          sessions.add(FaceScanSession(config.rules,config.poses,config.poses.first { it.key=="front" },config.assuranceRules) {
            FaceChallenge(challengeRules,plan,config.rules)
          })
          sessionNames.add(plan.joinToString("_"))
        }
        val observedFrames=JSONArray()
        val captureEvents=sessions.map { JSONArray() }
        val activeCaptureEvents=sessions.map { JSONArray() }.toMutableList()
        val roundIds=IntArray(sessions.size)
        try {
          FaceScanAnalyzer(context,config).use { analyzer ->
            for(frameIndex in 0 until frames.length()) {
              val frame=frames.getJSONObject(frameIndex)
              val bitmap=BitmapFactory.decodeFile(File(root,frame.getString("file")).absolutePath)
              assertNotNull("Frame decode ${input.getString("id")}/$frameIndex",bitmap)
              var evidence:FaceEvidence?=null
              try {
                val at=frame.getLong("timeMs")
                val start=SystemClock.elapsedRealtimeNanos()
                val observed=analyzer.inspect(bitmap,at); evidence=observed.evidence
                val decisions=JSONArray()
                for(j in sessions.indices) {
                  val result=sessions[j].next(observed,at)
                  if(result.reset) { activeCaptureEvents[j]=JSONArray(); roundIds[j]++ }
                  decisions.put(JSONObject().put("session",sessionNames[j]).put("hint",result.hint).put("pose",result.pose)
                    .put("reset",result.reset).put("capture",result.capture ?: JSONObject.NULL))
                  result.capture?.let { pose ->
                    val event=JSONObject().put("pose",pose).put("timeMs",at).put("frame",frameIndex).put("round",roundIds[j])
                    captureEvents[j].put(event); activeCaptureEvents[j].put(event)
                    if(j==0) {
                      val crop=FaceReferenceCrop.crop(bitmap,observed,config.capture.getDouble("facePadding"))
                      try { File(root,"${input.getString("id")}-capture-$pose.jpg").outputStream().use { stream ->
                        assertTrue(crop.compress(android.graphics.Bitmap.CompressFormat.JPEG,config.camera.getInt("jpegQuality"),stream))
                      } } finally { if(crop!==bitmap) crop.recycle() }
                    }
                  }
                }
                observedFrames.put(JSONObject().put("frame",frameIndex).put("timeMs",at).put("file",frame.getString("file"))
                  .put("sourceTimeMs",frame.getLong("sourceTimeMs")).put("faces",observed.count)
                  .put("quality",observed.qualityIssue ?: JSONObject.NULL)
                  .put("left",observed.left).put("top",observed.top).put("width",observed.width).put("height",observed.height)
                  .put("yaw",observed.yaw).put("pitch",observed.pitch).put("roll",observed.roll)
                  .put("blinkLeft",observed.blinkLeft).put("blinkRight",observed.blinkRight)
                  .put("liveScore",evidence?.liveScore ?: JSONObject.NULL).put("hasEvidence",evidence!=null)
                  .put("features",JSONArray(analyzer.featureDetails.map { detail -> JSONObject().put("region",detail.region)
                    .put("brightnessRatio",detail.brightnessRatio).put("sharpness",detail.sharpness) }))
                  .put("elapsedMs",(SystemClock.elapsedRealtimeNanos()-start)/1_000_000.0).put("decisions",decisions))
              } finally { evidence?.embedding?.fill(0.0); bitmap.recycle() }
            }
          }
          val sessionResults=JSONArray()
          for(j in sessions.indices) sessionResults.put(JSONObject().put("name",sessionNames[j])
            .put("complete",sessions[j].complete).put("captures",captureEvents[j]).put("retainedCaptures",activeCaptureEvents[j]))
          val row=JSONObject().put("id",input.getString("id")).put("kind",input.getString("kind"))
            .put("derived",input.getBoolean("derived")).put("frames",observedFrames).put("sessions",sessionResults)
          rows.put(row)
          File(root,"${input.getString("id")}-results.json").writeText(row.toString())
          File(root,"progress.json").writeText(JSONObject().put("completedCases",rows.length()).put("totalCases",cases.length())
            .put("lastCase",input.getString("id")).toString())
        } finally { sessions.forEach { it.close() } }
      }
    } finally { File(root,"results.json").writeText(JSONObject().put("cases",rows).put("config",config.values).toString()) }
    assertEquals(cases.length(),rows.length()) // Completion only; app quality is evaluated from recorded decisions.
  }
}

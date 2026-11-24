package com.looklancare.app.monitoring

import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class VideoFallTestNativeTest {
  private val instrumentation = InstrumentationRegistry.getInstrumentation()
  private val context = instrumentation.targetContext
  private fun request(uri: String) = JSONObject().put("id", "video-test-fixture").put("uri", uri)
    .put("userId", "synthetic-user").put("familyId", "synthetic-family").put("targetMemberIds", JSONArray())
  @Test fun remoteSourcesAndPrivateAppFilesAreRejected() {
    val runner = VideoFallTestRunner(context)
    for (uri in listOf("https://example.invalid/clip.mp4", File(context.filesDir, "private.mp4").toURI().toString())) {
      assertThrows(IllegalArgumentException::class.java) { runner.run(request(uri), { false }) { _, _ -> fail("Invalid source decoded") } }
    }
  }
  @Test fun legacyAndMultipleTargetsCannotSilentlyBecomeAllPeople() {
    assertFalse(CameraMonitoringTargets.read(JSONObject().put("targetMemberId", "target")).includes(null))
    assertFalse(CameraMonitoringTargets.read(JSONObject().put("targetMemberIds", JSONArray(listOf("a", "b")))).includes("c"))
    assertThrows(Exception::class.java) { CameraMonitoringTargets.read(JSONObject().put("targetMemberIds", "bad-data")) }
  }
  @Test fun videoUsesClipTimeAndSelectedPeopleSuppressUnidentifiedFalls() {
    val path = InstrumentationRegistry.getArguments().getString("videoPath") ?: error("Push a labelled fall MP4 and provide videoPath")
    val clip = File(context.cacheDir, "video-test-fixture.mp4")
    File(path).inputStream().use { input -> clip.outputStream().use { input.copyTo(it) } }
    val runner = VideoFallTestRunner(context)
    try {
      val all = runner.run(request(clip.toURI().toString()), { false }) { _, _ -> }
      assertTrue("Use a known detectable fall fixture", all.getJSONArray("events").length() > 0)
      val selected = request(clip.toURI().toString()).put("targetMemberIds", JSONArray(listOf("not-enrolled")))
      val scoped = runner.run(selected, { false }) { frame, _ ->
        assertEquals(0, frame.getJSONObject("analysis").getJSONArray("detections").length())
        assertFalse(frame.getJSONObject("analysis").getBoolean("fallDetected"))
      }
      assertEquals(0, scoped.getJSONArray("events").length()); assertEquals(0, scoped.getInt("monitoredFrames"))
      assertEquals(all.getInt("framesAnalyzed"), scoped.getInt("framesAnalyzed"))
      assertThrows(java.util.concurrent.CancellationException::class.java) { runner.run(request(clip.toURI().toString()), { true }) { _, _ -> fail() } }
    } finally { clip.delete() }
  }
}

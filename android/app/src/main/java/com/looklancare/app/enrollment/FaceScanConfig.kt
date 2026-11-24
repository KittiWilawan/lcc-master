package com.looklancare.app.enrollment

import android.content.Context
import org.json.JSONObject
import java.security.SecureRandom

class FaceScanConfig(val values: JSONObject) {
  val camera = values.getJSONObject("camera")
  val quality = values.getJSONObject("quality")
  val model = values.getJSONObject("model")
  val landmarks = values.getJSONObject("landmarks")
  val features = values.getJSONObject("features")
  val scene = values.getJSONObject("scene")
  val sceneRules = FaceSceneRules(scene.getDouble("tileFraction"),scene.getDouble("tileOverlap"),scene.getDouble("mergeIou"),
    scene.getDouble("mergeCenterRatio"),scene.getDouble("mergeScaleRatio"),scene.getInt("stopAfterFaces"),scene.getDouble("verificationScale"))
  val duplicatePolicy = FaceDuplicatePolicy(scene.getDouble("duplicateMinIou"),scene.getDouble("duplicateMaxCenterRatio"),
    scene.getDouble("duplicateMinScaleRatio"),scene.getDouble("duplicateMaxLandmarkRatio"))
  val freshness = values.getJSONObject("freshness")
  val capture = values.getJSONObject("capture")
  val security = values.getJSONObject("security")
  val assuranceRules = security.let { s -> FaceAssuranceRules(s.getDouble("similarityThreshold"), s.getInt("anchorFrames"),
    s.getDouble("liveThreshold"), s.getInt("liveFrames"), s.getLong("liveMaxGapMs")) }
  private val challengeRules = security.getJSONObject("challenge").let { c -> FaceChallengeRules(c.getLong("turnHoldMs"),
    c.getLong("returnHoldMs"), c.getLong("timeoutMs"), c.getDouble("minTurnDegrees"), c.getDouble("maxTurnDegrees")) }
  val poses: List<ScanPose> = values.getJSONArray("poses").let { array -> (0 until array.length()).map { i ->
    array.getJSONObject(i).let { ScanPose(it.getString("key"), it.getDouble("minYaw"), it.getDouble("maxYaw")) }
  } }
  val rules = values.getJSONObject("alignment").let { a -> values.getJSONObject("motion").let { m ->
    ScanRules(a.getDouble("minWidth"), a.getDouble("maxWidth"), a.getDouble("centerX"), a.getDouble("centerY"),
      a.getDouble("toleranceX"), a.getDouble("toleranceY"), a.getDouble("maxPitchDegrees"), a.getDouble("maxRollDegrees"),
      m.getLong("stableMs"), m.getLong("maxFrameGapMs"), m.getLong("lostMs"), m.getDouble("maxCenterJump"),
      m.getDouble("blinkOpen"), m.getDouble("blinkClosed"), m.getLong("blinkMinMs"), m.getLong("blinkMaxMs"),
      a.getDouble("maxHeight"), a.getDouble("edgeMargin"), m.getInt("multipleConfirmFrames"), m.getLong("blinkTransitionMs"))
  } }
  init {
    require(camera.getInt("width") > 0 && camera.getInt("height") > 0 && camera.getInt("intervalMs") > 0)
    require(camera.getInt("jpegQuality") in 1..100 && camera.getInt("maxPhotoBytes") > 0)
    require(quality.getInt("sampleSize") >= 3 && quality.getDouble("minBrightness") < quality.getDouble("maxBrightness"))
    require(poses.map { it.key }.toSet().size == poses.size && poses.all { it.minYaw <= it.maxYaw })
    require(model.getInt("maxFaces") > 1 && rules.minWidth > 0 && rules.maxWidth > rules.minWidth)
    for (key in listOf("minDetection", "minPresence", "minTracking")) require(model.getDouble(key) in 0.0..1.0)
    require(rules.blinkOpen >= 0 && rules.blinkClosed <= 1 && rules.blinkOpen < rules.blinkClosed)
    require(rules.blinkTransitionMs > 0 && rules.blinkTransitionMs <= rules.maxGapMs)
    require(rules.maxHeight in 0.0..1.0 && rules.edgeMargin >= 0 && rules.edgeMargin * 2 < 1)
    require(features.getInt("sampleSize") >= 3 && features.getDouble("minSharpness") >= 0)
    require(features.getDouble("paddingX") >= 0 && features.getDouble("paddingY") >= 0 && features.getDouble("minHeightToFace") > 0)
    for (key in listOf("minVisibleEyesFront", "minVisibleEyesSide")) require(features.getInt(key) in 1..features.getJSONArray("eyes").length())
    for (key in listOf("minEyeBrightnessRatio", "minLowerBrightnessRatio")) require(features.getDouble(key) in 0.0..1.0)
    require(scene.getDouble("tileFraction") > 0 && scene.getDouble("tileFraction") <= 1)
    require(scene.getDouble("tileOverlap") >= 0 && scene.getDouble("tileOverlap") < 1)
    for (key in listOf("mergeIou", "mergeCenterRatio", "mergeScaleRatio")) require(scene.getDouble(key) > 0 && scene.getDouble(key) <= 1)
    require(scene.getInt("stopAfterFaces") >= 2 && capture.getDouble("facePadding") >= 0)
    require(scene.getDouble("verificationScale") >= 1 && scene.getDouble("verificationScale").isFinite())
    require(freshness.getInt("sampleSize") >= 2 && freshness.getLong("maxUnchangedMs") > 0)
    require(security.getInt("threads") > 0 && security.getInt("liveClass") in 0..2)
    require(security.getJSONArray("passiveModels").length() > 0)
    val identity = security.getJSONObject("identity")
    require(identity.getInt("size") > 0 && identity.getInt("outputSize") > 0)
    require(identity.getJSONArray("landmarkGroups").length() == identity.getJSONArray("template").length())
    for (i in 0 until security.getJSONArray("passiveModels").length()) {
      val passive = security.getJSONArray("passiveModels").getJSONObject(i)
      require(passive.getInt("size") > 0 && passive.getDouble("scale") >= 1 && passive.getInt("outputSize") == 3)
    }
  }
  fun session(pose: String): FaceScanSession {
    val selected = if (pose == "all") poses else poses.filter { it.key == pose }
    require(selected.isNotEmpty())
    return FaceScanSession(rules, selected, poses.first { it.key == "front" }, assuranceRules) {
      val random = SecureRandom()
      val actions = mutableListOf("blink", if (random.nextBoolean()) "left" else "right")
      if (random.nextBoolean()) actions.reverse()
      FaceChallenge(challengeRules, actions, rules)
    }
  }
  companion object {
    fun load(context: Context) = FaceScanConfig(JSONObject(context.assets.open("enrollment/scan.json").bufferedReader().use { it.readText() }))
  }
}

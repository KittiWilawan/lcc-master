package com.looklancare.app.monitoring

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Matrix
import android.os.SystemClock
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarker
import org.json.JSONArray
import org.json.JSONObject

/** Each camera owns a video tracker; call only on the service inference thread. */
class LocalPoseAnalyzer(private val context: Context, private val config: MonitoringConfig) : AutoCloseable {
  private val metadata = JSONObject(context.assets.open("monitoring/model.json").bufferedReader().use { it.readText() })
  private val forest = PoseForest(context.assets.open(metadata.getString("modelAsset")))
  private val features = PoseFeatures(metadata.getInt("landmarkCount"), metadata.getDouble("visibilityThreshold").toFloat(),
    metadata.getDouble("normalizationMinScale").toFloat(), metadata.getString("featureVariant"))
  private val window = metadata.getInt("framesPerWindow")
  private val threshold = metadata.getDouble("fallThreshold")
  private val runningMode = RunningMode.valueOf(config.values.getString("poseRunningMode")).also {
    require(it == RunningMode.IMAGE || it == RunningMode.VIDEO)
  }
  private fun createLandmarker(mode: RunningMode = runningMode) = PoseLandmarker.createFromOptions(context, PoseLandmarker.PoseLandmarkerOptions.builder()
    .setBaseOptions(BaseOptions.builder().setModelAssetPath(metadata.getString("landmarkerAsset")).build())
    .setRunningMode(mode).setNumPoses(config.int("maxPoses"))
    .setMinPoseDetectionConfidence(config.probability("minPoseConfidence"))
    .setMinPosePresenceConfidence(config.probability("minPoseConfidence"))
    .setMinTrackingConfidence(config.probability("minPoseConfidence")).build())
  private val associationPolicy = TrackAssociationPolicy(config.long("maxPoseGapMs"), config.probability("maxTrackingDistance"),
    config.probability("trackingScaleDistance"), config.probability("trackingDistanceCap"), config.probability("trackingVelocitySmoothing"),
    config.probability("trackingSpeedCap"), config.probability("trackingDistanceWeight"), config.probability("trackingOverlapWeight"),
    config.probability("trackingSizeWeight"), config.probability("trackingUnmatchedCost"), config.int("trackingCandidatesPerPose"),
    config.probability("trackingAppearanceWeight"), config.probability("trackingAppearanceSmoothing"))
  private val visibility = metadata.getDouble("visibilityThreshold").toFloat()
  private val reducer = PoseObservationReducer(PoseDuplicatePolicy(config.probability("duplicatePoseMinOverlap"),
    config.probability("duplicatePoseMaxLandmarkDistance"), config.int("duplicatePoseMinSharedLandmarks"), visibility))
  private val appearanceJoints = config.values.getJSONArray("appearanceJointIndices").let { array -> List(array.length()) { array.getInt(it) } }
  private val appearance = PoseAppearanceExtractor(appearanceJoints, config.int("appearanceMinVisibleJoints"),
    visibility, config.int("appearanceBins"), config.int("appearanceSamples"))
  private val recoveryRotations = config.values.getJSONArray("recoveryRotations").let { array -> List(array.length()) { array.getInt(it) } }
  private val evidencePolicy = FallEvidencePolicy(threshold, config.int("confirmations"), config.long("confirmationMaxGapMs"),
    config.int("rearmNormalSamples"), config.long("alertCooldownMs"))
  private data class Frame(val timestamp: Long, val features: FloatArray)
  private data class Track(val id: Int, val frames: ArrayDeque<Frame>, val evidence: FallEvidence)
  private data class History(val landmarker: PoseLandmarker, val associator: PoseTrackAssociator,
                             val tracks: MutableMap<Int, Track> = mutableMapOf(), var timestamp: Long = 0,
                             var recoveryLandmarker: PoseLandmarker? = null, var recoveryCursor: Int = 0) : AutoCloseable {
    override fun close() { landmarker.close(); recoveryLandmarker?.close() }
  }
  private val histories = mutableMapOf<String, History>()

  init {
    require(window > 1 && config.int("minTrackFrames") <= window)
    require(threshold in 0.0..1.0 && forest.featureCount == metadata.getInt("featureCount"))
    require(config.long("confirmationMaxGapMs") >= config.long("frameIntervalMs"))
    require(config.long("maxPoseGapMs") >= config.long("confirmationMaxGapMs"))
    require(config.long("maxWindowAgeMs") >= config.long("frameIntervalMs") * (config.int("minTrackFrames") - 1))
    require(appearanceJoints.distinct().size == appearanceJoints.size && appearanceJoints.all { it in 0 until metadata.getInt("landmarkCount") })
    require(config.int("appearanceMinVisibleJoints") <= appearanceJoints.size)
    require(config.int("duplicatePoseMinSharedLandmarks") <= metadata.getInt("landmarkCount"))
    require(recoveryRotations.isNotEmpty() && recoveryRotations.distinct().size == recoveryRotations.size && recoveryRotations.all { it in listOf(0, 90, -90) })
    require(config.long("recoveryBudgetMs") < config.long("maxRealtimeInferenceMs"))
  }

  fun reset(cameraId: String) { histories.remove(cameraId)?.close() }

  fun prepare(cameraId: String) {
    if (histories.containsKey(cameraId)) return
    val detector = createLandmarker()
    val blank = Bitmap.createBitmap(config.int("maxFrameDimension"), config.int("maxFrameDimension"), Bitmap.Config.ARGB_8888)
    val image = BitmapImageBuilder(blank).build()
    try {
      // Initialise the graph before accepting live frames; timestamp zero precedes any decoder frame.
      if (runningMode == RunningMode.VIDEO) detector.detectForVideo(image, 0) else detector.detect(image)
      histories[cameraId] = History(detector, PoseTrackAssociator(associationPolicy))
    } catch (error: Exception) { detector.close(); throw error }
    finally { image.close() }
  }

  fun analyze(cameraId: String, bitmap: Bitmap, timestamp: Long): JSONObject {
    require(timestamp > 0)
    histories[cameraId]?.let { previous ->
      if (previous.timestamp > 0 && (timestamp <= previous.timestamp || timestamp - previous.timestamp > config.long("frameStaleMs"))) reset(cameraId)
    }
    prepare(cameraId)
    val history = histories.getValue(cameraId)
    history.timestamp = timestamp
    val started = SystemClock.elapsedRealtime()
    val candidates = detect(history.landmarker, bitmap, timestamp, runningMode)
    var observations = reducer.reduce(candidates.mapNotNull { PoseObservation.create(it, metadata.getInt("landmarkCount"), visibility) })
    val primaryCount = observations.size
    val crops = history.associator.missingBounds(observations.map { it.bounds }, timestamp, observations.map { appearance.extract(bitmap, it) })
      .mapNotNull { PoseCrop.around(it, bitmap.width, bitmap.height, config.values.getDouble("recoveryMarginScale").toFloat(), config.int("recoveryMinCropPixels")) }
      .ifEmpty { if (observations.isEmpty()) listOf(PoseCrop(0, 0, bitmap.width, bitmap.height)) else emptyList() }
    var recoveryInferences = 0
    if (config.values.getBoolean("poseRecoveryEnabled") && crops.isNotEmpty()) {
      val crop = crops[history.recoveryCursor % crops.size]
      history.recoveryCursor = (history.recoveryCursor + 1) % crops.size
      val detector = if (runningMode == RunningMode.IMAGE) history.landmarker else history.recoveryLandmarker
        ?: createLandmarker(RunningMode.IMAGE).also { history.recoveryLandmarker = it }
      for (rotation in recoveryRotations) {
        if (recoveryInferences >= config.int("maxRecoveryInferences") || SystemClock.elapsedRealtime() - started >= config.long("recoveryBudgetMs")) break
        if (rotation == 0 && crop.left == 0 && crop.top == 0 && crop.width == bitmap.width && crop.height == bitmap.height) continue
        val matrix = Matrix().apply { postRotate(rotation.toFloat()) }
        val transformed = Bitmap.createBitmap(bitmap, crop.left, crop.top, crop.width, crop.height, matrix, true)
        val recovered = try { detect(detector, transformed, timestamp, RunningMode.IMAGE)
          .mapNotNull { PoseObservation.create(crop.restore(it, bitmap.width, bitmap.height, rotation), metadata.getInt("landmarkCount"), visibility) } }
          finally { if (transformed !== bitmap) transformed.recycle() }
        recoveryInferences++
        if (recovered.isNotEmpty()) {
          observations = reducer.reduce(observations + recovered).take(config.int("maxPoses"))
          break
        }
      }
    }
    val ids = history.associator.associate(observations.map { it.bounds }, timestamp, observations.map { appearance.extract(bitmap, it) })
    history.tracks.keys.retainAll(history.associator.activeIds)
    history.tracks.values.forEach { it.evidence.expire(timestamp) }
    val boxes = JSONArray()
    var maximum = 0.0
    var eligibleCount = 0
    var alert = false
    var confirmedCount = 0
    observations.forEachIndexed { index, observation ->
      val points = observation.points
      val bounds = observation.bounds
      val track = history.tracks.getOrPut(ids[index]) { Track(ids[index], ArrayDeque(), FallEvidence(evidencePolicy)) }
      track.frames.addLast(Frame(timestamp, features.normalize(points)))
      while (track.frames.isNotEmpty() && timestamp - track.frames.first().timestamp > config.long("maxWindowAgeMs")) track.frames.removeFirst()
      while (track.frames.size > window) track.frames.removeFirst()
      val enoughFrames = track.frames.size >= config.int("minTrackFrames")
      val canPad = config.values.getString("initialWindowPolicy") == "repeat_initial"
      val eligible = enoughFrames && (track.frames.size == window || canPad)
      val observed = track.frames.map { it.features }
      val modelWindow = if (eligible && observed.size < window) List(window - observed.size) { observed.first() } + observed else observed
      val probability = if (eligible) forest.predict(features.sequence(modelWindow)) else 0.0
      if (eligible) eligibleCount++
      maximum = maxOf(maximum, probability)
      if (track.evidence.observe(if (eligible) probability else null, timestamp)) alert = true
      val confirmed = eligible && probability >= threshold && track.evidence.confirmations >= config.int("confirmations")
      if (confirmed) confirmedCount++
      boxes.put(JSONObject().put("label", "person").put("trackId", track.id)
        .put("state", if (confirmed) "fall" else if (eligible && probability >= threshold) "possible_fall" else if (eligible) "normal" else "uncertain")
        .put("confidence", if (eligible && probability < threshold) 1.0 - probability else probability).put("x", bounds.left.toDouble()).put("y", bounds.top.toDouble())
        .put("width", (bounds.right - bounds.left).toDouble()).put("height", (bounds.bottom - bounds.top).toDouble()))
    }
    return JSONObject().put("status", if (alert || confirmedCount > 0) "fall"
      else if (maximum >= threshold) "possible_fall" else if (eligibleCount > 0) "normal" else "uncertain")
      .put("confidence", maximum).put("reason", "ประเมินท่าทางต่อเนื่องบนอุปกรณ์ · ยังไม่ยืนยันตัวบุคคล")
      .put("peopleCount", observations.size).put("subjectContinuity", if (observations.size > 1) "multiple_people"
        else if (observations.size == 1 && eligibleCount > 0) "single_continuous_person" else "uncertain")
      .put("fallingPersonMatch", "uncertain").put("detections", boxes).put("fallDetected", alert)
      .put("diagnostics", JSONObject().put("rawPoses", candidates.size).put("primaryPoses", primaryCount).put("recoveryInferences", recoveryInferences))
  }

  private fun detect(detector: PoseLandmarker, bitmap: Bitmap, timestamp: Long, mode: RunningMode): List<List<PosePoint>> {
    // MPImage.close owns its bitmap; never give it the decoder's preview/evidence bitmap.
    val ownedBitmap = checkNotNull(bitmap.copy(Bitmap.Config.ARGB_8888, false))
    val image = try { BitmapImageBuilder(ownedBitmap).build() }
      catch (error: Exception) { ownedBitmap.recycle(); throw error }
    val result = try { if (mode == RunningMode.VIDEO) detector.detectForVideo(image, timestamp) else detector.detect(image) }
      finally { image.close() }
    return result.landmarks().map { pose -> pose.map { PosePoint(it.x(), it.y(), it.z(), it.visibility().orElse(0f)) } }
  }

  override fun close() { histories.values.forEach { it.close() }; histories.clear() }
}

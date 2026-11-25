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
import com.looklancare.app.enrollment.FrameSignature
import com.looklancare.app.enrollment.FrameFreshness

/** Each camera owns a video tracker; call only on the service inference thread. */
class LocalPoseAnalyzer(private val context: Context, private val config: MonitoringConfig,
  private val compareVideoWeights: Boolean = false,
  private val primaryObservationTransform: ((List<PoseObservation>, Long) -> List<PoseObservation>)? = null) : AutoCloseable {
  private val metadata = JSONObject(context.assets.open("monitoring/model.json").bufferedReader().use { it.readText() })
  private val forest = PoseForest(context.assets.open(metadata.getString("modelAsset")))
  private val features = PoseFeatures(metadata.getInt("landmarkCount"), metadata.getDouble("visibilityThreshold").toFloat(),
    metadata.getDouble("normalizationMinScale").toFloat(), metadata.getString("featureVariant"))
  private val window = metadata.getInt("framesPerWindow")
  private val threshold = metadata.getDouble("fallThreshold")
  private val identity = lazy { MonitoringIdentityAnalyzer(context) }
  private val galleryStore = IdentityGalleryStore(context)
  private val identitySettings = JSONObject(context.assets.open("monitoring/identity.json").bufferedReader().use { it.readText() })
  private val identityRules = IdentityRules(identitySettings.getDouble("similarityThreshold"), identitySettings.getDouble("runnerUpMargin"),
    identitySettings.getInt("confirmationFrames"), identitySettings.getLong("confirmationMaxGapMs"), identitySettings.getLong("retentionMs"), identitySettings.getInt("minTemplateMatches"))
  private var gallery: JSONObject? = null
  private var galleryReadAt = 0L
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
  private val motionSettings = JSONObject(context.assets.open("monitoring/motion.json").bufferedReader().use { it.readText() })
  private val motionPolicy = motionSettings.run {
    MotionPolicy(getInt("columns"), getInt("rows"), getInt("lumaDelta"), getDouble("minChangedFraction"),
      getInt("minChangedCells"), getInt("discoveryMinCells"), getDouble("discoveryExtent").toFloat(), config.long("maxWindowAgeMs"))
  }
  private val rules = JSONObject(context.assets.open("monitoring/video-motion.json").bufferedReader().use { it.readText() })
  private data class SearchView(val fraction: Double, val rotation: Int, val nearSideOnly: Boolean = false) {
    init { require(fraction > 0 && fraction <= 1 && rotation in setOf(0, 90, -90)) }
  }
  private val existingViews = recoveryRotations.map { SearchView(1.0, it) }
  private val discoverySettings = rules.getJSONObject("emptyDiscovery")
  private val discoveryViews = discoverySettings.getJSONArray("views").let { views ->
    List(views.length()) { i -> views.getJSONObject(i).run { SearchView(getDouble("fraction"), getInt("rotation"), optBoolean("nearSideOnly", false)) } }
  }.also { require(it.isNotEmpty() && it.first() == SearchView(1.0, 0)) }
  private val verificationSettings = rules.getJSONObject("verification")
  private val liveMode = verificationSettings.getString("mode").also { require(it in setOf("base", "gate", "rescue")) }
  private val comparisonFactory: (() -> TemporalMotionTrack)? = if (compareVideoWeights || liveMode != "base") {
    fun indices(key: String): List<Int> = rules.getJSONArray(key).let { a -> List(a.length()) { a.getInt(it) } }
    val policy = TemporalMotionPolicy(indices("joints"), indices("shoulders"), indices("hips"), visibility,
      metadata.getDouble("normalizationMinScale"), config.long("maxWindowAgeMs"), config.long("confirmationMaxGapMs"),
      rules.getDouble("add"), rules.getDouble("veto"), rules.getDouble("drop"),
      rules.getDouble("corroborationFloor"), rules.getDouble("corroborationDrop"), rules.getDouble("poseCredit"))
    val comparisonForest = PoseForest(context.assets.open(rules.getString("modelAsset")))
    require(comparisonForest.featureCount == rules.getInt("featureCount"))
    val verifier = PoseForest(context.assets.open(verificationSettings.getString("modelAsset")))
    require(verifier.featureCount == comparisonForest.featureCount)
    val verificationPolicy = verificationSettings.run {
      FallVerificationPolicy(getDouble("threshold"), getDouble("floor"), getDouble("margin"),
        getDouble("originalThreshold"), getDouble("verifierThreshold"), getDouble("peak"), getDouble("drop"),
        getDouble("currentPoseFloor"), getDouble("originalPeak"))
    }
    val create = { TemporalMotionTrack(policy, comparisonForest, evidencePolicy, verifier, FallMotionVerification(verificationPolicy, evidencePolicy)) }
    create
  } else null
  private val legChains = motionSettings.getJSONArray("legChains").let { chains ->
    List(chains.length()) { i -> chains.getJSONArray(i).let { chain -> List(chain.length()) { chain.getInt(it) } } }
  }.also { chains -> require(chains.flatten().all { it in 0 until metadata.getInt("landmarkCount") }) }
  private val landingPolicy = motionSettings.run {
    LandingPolicy(legChains, visibility, config.long("maxWindowAgeMs"), config.long("confirmationMaxGapMs"),
      getDouble("landingMinScaleRatio").toFloat(), getDouble("landingMaxTravel").toFloat(), getDouble("landingProneCosine").toFloat(),
      getDouble("landingShoulderDrop").toFloat(), getDouble("landingCenterDrop").toFloat(), getDouble("minimumDescentFraction").toFloat(),
      getDouble("landingMaxFootShift").toFloat(), getDouble("uprightMinVisibility").toFloat(),
      getDouble("landingPartialLegVisibility").toFloat(), getInt("uprightLandingReferences"),
      getDouble("uprightMinVerticalCosine").toFloat(), getDouble("maximumFootShiftFraction").toFloat())
  }
  private val restingPolicy = motionSettings.getJSONObject("restingPose").run {
    RestingPosePolicy(metadata.getDouble("normalizationMinScale"), getDouble("knee"), getDouble("extended"),
      getDouble("hipDrop"), getInt("samples"), getDouble("fraction"),
      getInt("horizontalSamples"), getDouble("maxHipSpread"), getDouble("shrinkRatio"))
  }
  private val seatedPolicy = rules.getJSONObject("seatedLean").run {
    SeatedLeanPolicy(metadata.getDouble("normalizationMinScale"), getDouble("uprightCosine"), getDouble("tiltCosine"),
      getDouble("shoulderDrop"), getDouble("hipToShoulder"), getDouble("hipDrop"), getDouble("foldedKnee"),
      getInt("minReferences"), getDouble("originalCeiling"), getDouble("verifierCeiling"), getDouble("continuationDrop"))
  }
  private val uprightPose = motionSettings.run {
    UprightPose(legChains,
      getDouble("uprightMinVisibility").toFloat(), getDouble("uprightMinVerticalCosine").toFloat())
  }
  private val descentPolicy = DescentPolicy(config.long("maxWindowAgeMs"), config.long("confirmationMaxGapMs"),
    motionSettings.getDouble("minimumDescentFraction").toFloat(), motionSettings.getDouble("maximumFootShiftFraction").toFloat())
  private data class Frame(val timestamp: Long, val features: FloatArray)
  private data class Track(val id: Int, val frames: ArrayDeque<Frame>, var evidence: FallEvidence,
    val identity: TrackIdentity, val transition: FallTransition, val landing: LandingEvidence, val comparison: TemporalMotionTrack?, val seated: SeatedLeanEvidence, var lastMember: String? = null, val ambiguity: AmbiguityBoundary = AmbiguityBoundary())
  private data class History(val landmarker: PoseLandmarker, val associator: PoseTrackAssociator,
                             val tracks: MutableMap<Int, Track> = mutableMapOf(), var timestamp: Long = 0,
                             var recoveryLandmarker: PoseLandmarker? = null, var recoveryCursor: Int = 0,
                             var galleryRevision: String? = null, var identityScope: String? = null, var signature: ByteArray? = null,
                             val freshness: FrameFreshness, val motion: SceneMotion, var frameWidth: Int = 0, var frameHeight: Int = 0) : AutoCloseable {
    override fun close() { landmarker.close(); recoveryLandmarker?.close(); signature?.fill(0); freshness.clear(); tracks.values.forEach { it.identity.clear() } }
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
    val prepared = History(detector, PoseTrackAssociator(associationPolicy), freshness = FrameFreshness(config.long("maxUnchangedFrameMs")),
      motion = SceneMotion(motionPolicy))
    try {
      warmUp(detector, runningMode)
      if (config.values.getBoolean("poseRecoveryEnabled") && runningMode == RunningMode.VIDEO) {
        val recovery = createLandmarker(RunningMode.IMAGE)
        prepared.recoveryLandmarker = recovery
        warmUp(recovery, RunningMode.IMAGE)
      }
      histories[cameraId] = prepared
    } catch (error: Exception) { prepared.close(); throw error }
  }

  private fun warmUp(detector: PoseLandmarker, mode: RunningMode) {
    val blank = Bitmap.createBitmap(config.int("maxFrameDimension"), config.int("maxFrameDimension"), Bitmap.Config.ARGB_8888)
    val image = BitmapImageBuilder(blank).build()
    try {
      // Initialise the graph before accepting live frames; timestamp zero precedes any decoder frame.
      if (mode == RunningMode.VIDEO) detector.detectForVideo(image, 0) else detector.detect(image)
    }
    finally { image.close() }
  }

  fun analyze(cameraId: String, bitmap: Bitmap, timestamp: Long, camera: JSONObject? = null): JSONObject {
    require(timestamp > 0)
    histories[cameraId]?.let { previous ->
      val geometryChanged = previous.frameWidth.toLong() * bitmap.height != bitmap.width.toLong() * previous.frameHeight
      if (previous.timestamp > 0 && (geometryChanged || timestamp <= previous.timestamp || timestamp - previous.timestamp > config.long("frameStaleMs"))) reset(cameraId)
    }
    prepare(cameraId)
    val history = histories.getValue(cameraId)
    history.timestamp = timestamp
    history.frameWidth = bitmap.width
    history.frameHeight = bitmap.height
    val signature = FrameSignature.measure(bitmap, maxOf(bitmap.width, bitmap.height))
    val distinctFrame = history.signature?.contentEquals(signature) != true
    history.signature?.fill(0); history.signature = signature
    val stalled = history.freshness.stalled(signature, timestamp)
    val started = SystemClock.elapsedRealtime()
    history.motion.update(sampleLuma(bitmap), timestamp)
    val candidates = detect(history.landmarker, bitmap, timestamp, runningMode)
    var observations = reducer.reduce(candidates.mapNotNull { PoseObservation.create(it, metadata.getInt("landmarkCount"), visibility) })
    observations = primaryObservationTransform?.invoke(observations, timestamp) ?: observations
    val primaryCount = observations.size
    history.tracks.values.forEach { it.evidence.expire(timestamp) }
    val recoveryIds = history.tracks.filterValues { it.evidence.confirmations > 0 }.keys
    val crops = history.associator.missingBounds(observations.map { it.bounds }, timestamp, observations.map { appearance.extract(bitmap, it) }, recoveryIds)
      .mapNotNull {
        val margin = config.values.getDouble("recoveryMarginScale").toFloat()
        val minimum = config.int("recoveryMinCropPixels")
        PoseCrop.around(it, bitmap.width, bitmap.height, margin, minimum)
          ?: history.motion.searchCrop(it, bitmap.width, bitmap.height, margin, minimum)
      }
      .ifEmpty { if (observations.isEmpty() && recoveryIds.isNotEmpty()) listOf(PoseCrop(0, 0, bitmap.width, bitmap.height)) else emptyList() }
    val scope = CameraMonitoringTargets.read(camera)
    val recoveryRegions = JSONArray()
    var recoveryInferences = 0
    val searchEnabled = config.values.getBoolean("poseRecoveryEnabled") && !stalled
    val discovery = if (searchEnabled && crops.isEmpty() && observations.size < config.int("maxPoses"))
      history.motion.uncovered(observations.map { it.bounds }) else null
    val crop = if (crops.isNotEmpty()) crops[history.recoveryCursor % crops.size] else discovery?.let {
      history.motion.searchCrop(it, bitmap.width, bitmap.height, config.values.getDouble("recoveryMarginScale").toFloat(), config.int("recoveryMinCropPixels"))
    }
    if (searchEnabled && crop != null) {
      if (crops.isNotEmpty()) history.recoveryCursor = (history.recoveryCursor + 1) % crops.size
      val detector = if (runningMode == RunningMode.IMAGE) history.landmarker else history.recoveryLandmarker
        ?: createLandmarker(RunningMode.IMAGE).also { history.recoveryLandmarker = it }
      val views = when {
        discovery == null -> existingViews
        observations.isEmpty() && distinctFrame && scope.allPeople -> discoveryViews
        else -> discoveryViews.take(1)
      }
      for ((viewIndex, view) in views.withIndex()) {
        val rotation = view.rotation
        val area = crop.searchArea(view.fraction, view.nearSideOnly, bitmap.width)
        if (recoveryInferences >= config.int("maxRecoveryInferences") || SystemClock.elapsedRealtime() - started >= config.long("recoveryBudgetMs")) break
        if (rotation == 0 && area.left == 0 && area.top == 0 && area.width == bitmap.width && area.height == bitmap.height) continue
        val matrix = Matrix().apply { postRotate(rotation.toFloat()) }
        val transformed = Bitmap.createBitmap(bitmap, area.left, area.top, area.width, area.height, matrix, true)
        val recovered = try { detect(detector, transformed, timestamp, RunningMode.IMAGE)
          .mapNotNull { PoseObservation.create(area.restore(it, bitmap.width, bitmap.height, rotation), metadata.getInt("landmarkCount"), visibility) } }
          finally { if (transformed !== bitmap) transformed.recycle() }
        recoveryInferences++
        val local = if (discovery == null) recovered else recovered.filter { history.motion.belongsTo(discovery, it.bounds) }
        if (local.isNotEmpty()) {
          if (discovery != null && viewIndex > 0) {
            // An additional search must never change association, identity or the alert timeline.
            for (candidate in reducer.reduce(local).take(config.int("maxPoses"))) {
              val b = candidate.bounds
              recoveryRegions.put(JSONObject().put("x", b.left.toDouble()).put("y", b.top.toDouble())
                .put("width", (b.right - b.left).toDouble()).put("height", (b.bottom - b.top).toDouble()))
            }
          } else {
            observations = reducer.reduce(observations + local).take(config.int("maxPoses"))
          }
          break
        }
      }
    }
    val ids = history.associator.associate(observations.map { it.bounds }, timestamp, observations.map { appearance.extract(bitmap, it) })
    val selectedPeople = !scope.allPeople
    val identityScope = listOf(camera?.optString("userId"), camera?.optString("familyId"), scope.memberIds.sorted().joinToString(",")).joinToString(":")
    if (selectedPeople && (history.identityScope != identityScope || galleryReadAt == 0L || timestamp - galleryReadAt >= identitySettings.getLong("galleryReloadMs"))) {
      gallery = galleryStore.read(); galleryReadAt = timestamp
    }
    val scopedGallery = gallery?.takeIf { selectedPeople && it.optString("userId") == camera?.optString("userId") &&
      it.optString("familyId") == camera?.optString("familyId") && it.optLong("expiresAt") > System.currentTimeMillis() }
    val revision = scopedGallery?.optString("revision")
    if (history.galleryRevision != revision || history.identityScope != identityScope) {
      history.tracks.values.forEach { it.identity.clear(); it.frames.clear(); it.evidence = FallEvidence(evidencePolicy); it.lastMember = null }
      history.galleryRevision = revision
      history.identityScope = identityScope
    }
    val templates = scopedGallery?.getJSONArray("members")?.let { array -> (0 until array.length()).map { i ->
      val profile = array.getJSONObject(i); val vectors = profile.getJSONArray("vectors")
      IdentityTemplate(profile.getString("id"), profile.getString("name"), (0 until vectors.length()).map { j ->
        val vector = vectors.getJSONArray(j); DoubleArray(vector.length()) { vector.getDouble(it) } })
    } } ?: emptyList()
    val identityReady = scope.allPeople || scope.memberIds.all { id -> templates.any { it.memberId == id } }
    // All-people mode does not pay the face-model cost or require reference photos.
    val identityAttempted = selectedPeople && templates.isNotEmpty() && distinctFrame && !stalled
    val faces = if (identityAttempted) identity.value.faces(bitmap) else emptyList()
    val usableFaces = faces.count { it.vector != null }
    val faceCandidates = faces.map { face -> face.vector?.let { IdentityMatcher.match(it, templates, identityRules) } }
    val claims = CrowdFaceClaims(faceCandidates)
    history.tracks.keys.retainAll(history.associator.activeIds)
    history.tracks.values.forEach { it.evidence.expire(timestamp) }
    val boxes = JSONArray()
    val previewBoxes = JSONArray()
    var maximum = 0.0
    var eligibleCount = 0
    val comparisonEvents = if (compareVideoWeights) JSONArray() else null
    var alert = false
    var confirmedCount = 0
    var fallingIdentity: PersonIdentity? = null
    var suppressedCount = 0
    observations.forEachIndexed { index, observation ->
      val points = observation.points
      val bounds = observation.bounds
      val track = history.tracks.getOrPut(ids[index]) { Track(ids[index], ArrayDeque(), FallEvidence(evidencePolicy), TrackIdentity(identityRules), FallTransition(descentPolicy), LandingEvidence(landingPolicy, RestingPoseEvidence(landingPolicy, restingPolicy)), comparisonFactory?.invoke(), SeatedLeanEvidence(landingPolicy, seatedPolicy)) }
      val overlapping = selectedPeople && observations.indices.any { other -> other != index && bounds.overlap(observations[other].bounds) >= identitySettings.getDouble("overlapInvalidation") }
      val headIndexes = identitySettings.getJSONArray("headJointIndices")
      val headPoints = (0 until headIndexes.length()).mapNotNull { observation.points.getOrNull(headIndexes.getInt(it)) }
        .filter { it.visibility >= visibility }
      val contained = faces.filter { face -> face.bounds.x in bounds.left..bounds.right && face.bounds.y in bounds.top..bounds.bottom &&
        headPoints.size >= identitySettings.getInt("minimumHeadJoints") &&
        kotlin.math.hypot(face.bounds.x - headPoints.map { it.x.toDouble() }.average(),
          face.bounds.y - headPoints.map { it.y.toDouble() }.average()) <= face.bounds.diagonal * identitySettings.getDouble("headFaceDistanceRatio") }
      val face = contained.singleOrNull()?.takeIf { found -> observations.count { found.bounds.x in it.bounds.left..it.bounds.right && found.bounds.y in it.bounds.top..it.bounds.bottom } == 1 }
      val candidate = face?.let { faceCandidates[faces.indexOf(it)] }
      val ambiguousIdentity = claims.isAmbiguous(overlapping, contained.size > 1 || (contained.isNotEmpty() && face == null),
        candidate?.memberId, track.lastMember)
      if (face?.vector != null && track.lastMember != null && candidate?.memberId != track.lastMember) {
        track.frames.clear(); track.evidence = FallEvidence(evidencePolicy); track.lastMember = null
      }
      val person = track.identity.observe(candidate, timestamp,
        ambiguous = ambiguousIdentity || stalled || scopedGallery == null, faceObserved = face?.vector != null)
      if (person.memberId != null && track.lastMember != null && track.lastMember != person.memberId) {
        track.frames.clear(); track.evidence = FallEvidence(evidencePolicy)
      }
      if (person.memberId != null) track.lastMember = person.memberId
      // Drop pre-overlap history. Selected mode waits for a fresh verified identity afterwards.
      if (track.ambiguity.entering(ambiguousIdentity)) { track.frames.clear(); track.evidence = FallEvidence(evidencePolicy); track.lastMember = null }
      if (track.frames.isEmpty()) { track.transition.clear(); track.landing.clear(); track.comparison?.clear(); track.seated.clear() }
      track.frames.addLast(Frame(timestamp, features.normalize(points)))
      while (track.frames.isNotEmpty() && timestamp - track.frames.first().timestamp > config.long("maxWindowAgeMs")) track.frames.removeFirst()
      while (track.frames.size > window) track.frames.removeFirst()
      val enoughFrames = track.frames.size >= config.int("minTrackFrames")
      val canPad = config.values.getString("initialWindowPolicy") == "repeat_initial"
      val eligible = enoughFrames && (track.frames.size == window || canPad)
      val observed = track.frames.map { it.features }
      val modelWindow = if (eligible && observed.size < window) List(window - observed.size) { observed.first() } + observed else observed
      val rawScore = if (eligible) forest.predict(features.sequence(modelWindow)) else 0.0
      val scored = eligible && distinctFrame && !stalled
      val inScope = scope.includes(person.memberId)
      val probability = if (inScope && distinctFrame && !stalled) track.transition.score(bounds, bitmap.width.toFloat() / bitmap.height,
        timestamp, rawScore, track.evidence.confirmations > 0, threshold) else {
        track.transition.clear()
        rawScore
      }
      val landing = if (inScope && distinctFrame && !stalled) track.landing.observe(points, bounds, bitmap.width.toFloat() / bitmap.height, timestamp)
        else { if (!inScope || stalled) track.landing.clear(); false }
      val supported = probability < threshold || (history.motion.supports(bounds) && !uprightPose.visible(points, bitmap.width, bitmap.height))
      // Unknown/other identities cannot accumulate an alert that later becomes a target's event.
      if (!inScope) track.evidence = FallEvidence(evidencePolicy)
      val evidenceScore = if (scored && inScope && supported) probability else null
      val rest = track.landing.deferForRest
      val verifier = track.comparison?.verification
      val fresh = distinctFrame && inScope && !stalled
      track.comparison?.let { comparison ->
        if (!inScope || stalled) comparison.clear()
        else if (fresh && comparison.observe(points, timestamp, evidenceScore, landing, track.landing.clearCollapse, rest)) {
          comparisonEvents?.put(JSONObject().put("trackId", track.id).put("memberName", person.name ?: JSONObject.NULL))
        }
      }
      val seated = if (fresh) track.seated.observe(points, bitmap.width.toFloat() / bitmap.height, timestamp,
        track.comparison?.originalScore, track.comparison?.verifierScore) else {
        if (!inScope || stalled) track.seated.clear()
        false
      }
      val verified = liveMode == "base" || verifier?.allowsLanding != false
      val confirmedLanding = landing && !rest && !seated && verified
      val additional = fresh && !rest && !seated && liveMode == "rescue" && verifier?.additionalFall == true
      val visibleEvidence = supported && !rest && !seated
      val emitted = track.evidence.observe(evidenceScore, timestamp, confirmedLanding, track.landing.clearCollapse, additional)
      if (eligible && visibleEvidence && inScope) eligibleCount++
      if (inScope && visibleEvidence) maximum = maxOf(maximum, probability)
      if (scored && probability >= threshold && !inScope) suppressedCount++
      if (emitted && inScope) { alert = true; fallingIdentity = person }
      val collapseConfirmed = confirmedLanding && scored && supported && inScope && track.evidence.collapseConfirmed
      val confirmed = emitted || collapseConfirmed || (confirmedLanding && scored && supported && inScope && probability >= threshold &&
        track.evidence.confirmations >= config.int("confirmations"))
      if (confirmed) confirmedCount++
      val box = JSONObject().put("label", "person").put("trackId", track.id)
        .put("state", if (stalled || !visibleEvidence) "uncertain" else if (confirmed) "fall" else if (eligible && probability >= threshold) "possible_fall" else if (eligible) "normal" else "uncertain")
        .put("collapseConfirmed", collapseConfirmed)
        .put("confidence", if (!confirmed && eligible && probability < threshold) 1.0 - probability else probability).put("x", bounds.left.toDouble()).put("y", bounds.top.toDouble())
        .put("width", (bounds.right - bounds.left).toDouble()).put("height", (bounds.bottom - bounds.top).toDouble())
        .put("identityState", person.state).put("memberId", person.memberId ?: JSONObject.NULL)
        .put("memberName", person.name ?: JSONObject.NULL).put("faceSimilarity", person.similarity ?: JSONObject.NULL)
        .put("monitoringScope", if (inScope) "included" else "known_other")
      if (inScope) boxes.put(box)
      else box.put("state", "uncertain").put("memberId", JSONObject.NULL).put("memberName", JSONObject.NULL)
        .put("faceSimilarity", JSONObject.NULL).put("identityState", "uncertain")
      previewBoxes.put(box)
    }
    return JSONObject().put("recoveryRegions", recoveryRegions).put("status", if (stalled) "uncertain" else if (alert || confirmedCount > 0) "fall"
      else if (maximum >= threshold) "possible_fall" else if (eligibleCount > 0) "normal" else "uncertain")
      .apply { if (comparisonEvents != null) put("comparisonEvents", comparisonEvents) }
      .put("confidence", maximum).put("reason", if (stalled) "ภาพไม่เปลี่ยนและอาจค้าง · หยุดยืนยันเหตุจากเฟรมซ้ำ"
        else if (selectedPeople && !identityReady) "รูปอ้างอิงยังไม่พร้อม · ยังไม่แจ้งเหตุจากคนที่ยืนยันไม่ได้"
        else if (selectedPeople && boxes.length() == 0 && identityAttempted && faces.isEmpty()) "ยังไม่เห็นใบหน้าชัดเจน · ให้คนที่เลือกหันเข้ากล้องเพื่อยืนยันตัวตน"
        else if (selectedPeople && boxes.length() == 0 && identityAttempted && usableFaces == 0) "ภาพใบหน้ายังไม่ชัดหรือมุมหน้าไม่เหมาะ · ปรับแสงและระยะกล้อง"
        else if (selectedPeople && boxes.length() == 0) "ยังไม่พบคนที่เลือกซึ่งยืนยันตัวตนได้ · ไม่แจ้งเหตุจากคนอื่น"
        else "ประเมินท่าทางต่อเนื่องบนอุปกรณ์")
      .put("monitoredPeopleCount", boxes.length()).put("monitoringMode", if (scope.allPeople) "all_people" else "selected_people")
      .put("peopleCount", observations.size).put("subjectContinuity", if (observations.size > 1) "multiple_people"
        else if (observations.size == 1 && eligibleCount > 0) "single_continuous_person" else "uncertain")
      .put("fallingPersonMatch", if (selectedPeople && fallingIdentity?.memberId != null && scope.includes(fallingIdentity?.memberId))
        if (fallingIdentity?.state == "recent_face") "possible_target" else "confirmed_target" else "uncertain")
      .put("fallingMemberId", fallingIdentity?.memberId ?: JSONObject.NULL).put("fallingMemberName", fallingIdentity?.name ?: JSONObject.NULL)
      .put("identityState", fallingIdentity?.state ?: "uncertain").put("identityReady", identityReady)
      .put("faceSimilarity", fallingIdentity?.similarity ?: JSONObject.NULL).put("detections", boxes).put("previewDetections", previewBoxes).put("fallDetected", alert)
      .put("frameStalled", stalled).put("diagnostics", JSONObject().put("rawPoses", candidates.size).put("primaryPoses", primaryCount)
        .put("identityAnalyzed", identityAttempted).put("detectedFaces", faces.size).put("usableFaces", usableFaces)
        .put("recoveryInferences", recoveryInferences).put("distinctFrame", distinctFrame).put("suppressedKnownOther", suppressedCount))
  }

  private fun sampleLuma(bitmap: Bitmap): ByteArray {
    val width = motionPolicy.columns
    val height = motionPolicy.rows
    val small = Bitmap.createScaledBitmap(bitmap, width, height, true)
    val pixels = IntArray(width * height)
    try { small.getPixels(pixels, 0, width, 0, 0, width, height) }
    finally { if (small !== bitmap) small.recycle() }
    return ByteArray(pixels.size) { i ->
      val rgb = pixels[i]
      // BT.601 luminance, rounded with fixed-point coefficients.
      ((77 * ((rgb ushr 16) and 255) + 150 * ((rgb ushr 8) and 255) + 29 * (rgb and 255) + 128) ushr 8).toByte()
    }
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

  override fun close() { histories.values.forEach { it.close() }; histories.clear(); gallery = null; if (identity.isInitialized()) identity.value.close() }
}

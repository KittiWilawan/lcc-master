package com.looklancare.app.enrollment

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Matrix
import android.os.SystemClock
import android.util.Base64
import android.util.Size
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.events.Event
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors

/** Owns exactly its two CameraX use cases; releases frames on every exit path. */
class FaceScanView(private val reactContext: ThemedReactContext) : FrameLayout(reactContext), LifecycleEventListener {
  private val previewView = PreviewView(reactContext).apply {
    implementationMode = PreviewView.ImplementationMode.COMPATIBLE
    scaleType = PreviewView.ScaleType.FIT_CENTER
  }
  private val executor = Executors.newSingleThreadExecutor()
  private var provider: ProcessCameraProvider? = null
  private var preview: Preview? = null
  private var analysis: ImageAnalysis? = null
  @Volatile private var generation = 0
  @Volatile private var disposed = false
  private var pose = "all"
  private var facing = "front"
  private var enabled = true
  private var hostActive = true
  private var analyzer: FaceScanAnalyzer? = null // accessed only by executor
  private var activeSession: FaceScanSession? = null // accessed only by executor
  private var restartToken = 0
  private val layoutPreview = Runnable {
    if (!disposed && width > 0 && height > 0) {
      // React Native lays out this host view; CameraX adds its TextureView asynchronously.
      // Measure native children again so the surface request receives a real, nonzero size.
      measure(MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY))
      layout(left, top, right, bottom)
    }
  }
  init {
    addView(previewView, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    reactContext.addLifecycleEventListener(this)
  }
  fun setPose(value: String) { if (pose != value) { pose = value; restart() } }
  fun setFacing(value: String) { if (facing != value) { facing = value; restart() } }
  fun setEnabledScan(value: Boolean) { if (enabled != value) { enabled = value; restart() } }
  fun setRestartToken(value: Int) { if (restartToken != value) { restartToken = value; restart() } }
  override fun requestLayout() {
    super.requestLayout()
    // The constructor may call requestLayout before properties are initialized.
    post { if (!disposed) { removeCallbacks(layoutPreview); post(layoutPreview) } }
  }
  override fun onSizeChanged(width: Int, height: Int, oldWidth: Int, oldHeight: Int) {
    super.onSizeChanged(width, height, oldWidth, oldHeight)
    previewView.measure(MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY))
    previewView.layout(0, 0, width, height)
  }
  override fun onAttachedToWindow() { super.onAttachedToWindow(); start() }
  override fun onDetachedFromWindow() { stop(); super.onDetachedFromWindow() }
  override fun onHostResume() { hostActive = true; restart() }
  override fun onHostPause() { hostActive = false; stop(); emitState("paused", pose, reset = true) }
  override fun onHostDestroy() { dispose() }

  private fun restart() { stop(); if (isAttachedToWindow) start() }
  private fun stop() {
    generation++
    analysis?.clearAnalyzer()
    val ownCases = listOfNotNull(preview, analysis)
    if (ownCases.isNotEmpty()) provider?.unbind(*ownCases.toTypedArray())
    preview = null; analysis = null
    if (!executor.isShutdown) executor.execute {
      activeSession?.close(); activeSession = null
      analyzer?.close(); analyzer = null
    }
  }
  fun dispose() {
    if (disposed) return
    disposed = true; removeCallbacks(layoutPreview); stop(); executor.shutdown(); reactContext.removeLifecycleEventListener(this)
  }
  private fun start() {
    if (!enabled || !hostActive || disposed || analysis != null) return
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
      emitState("permission", pose); return
    }
    val owner = reactContext.currentActivity as? LifecycleOwner
    if (owner == null) { emitState("unavailable", pose); return }
    val token = ++generation
    val requested = pose; val lens = facing
    emitState("loading", requested, reset = true)
    val future = ProcessCameraProvider.getInstance(context)
    future.addListener({
      if (disposed || token != generation || !isAttachedToWindow || !hostActive || !enabled) return@addListener
      try {
        val config = FaceScanConfig.load(context)
        val session = config.session(requested)
        provider = future.get()
        val selector = if (lens == "back") CameraSelector.DEFAULT_BACK_CAMERA else CameraSelector.DEFAULT_FRONT_CAMERA
        if (!provider!!.hasCamera(selector)) { emitState("unavailable", requested); return@addListener }
        val resolution = ResolutionSelector.Builder().setResolutionStrategy(ResolutionStrategy(
          Size(config.camera.getInt("width"), config.camera.getInt("height")), ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER)).build()
        val cameraPreview = Preview.Builder().setResolutionSelector(resolution).build()
        val cameraAnalysis = ImageAnalysis.Builder().setResolutionSelector(resolution)
          .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
          .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build()
        var lastFrame = 0L
        var failed = false
        cameraAnalysis.setAnalyzer(executor) { frame ->
          var source: Bitmap? = null; var bitmap: Bitmap? = null
          var evidence: FaceEvidence? = null
          try {
            if (token != generation || disposed || session.complete || failed) return@setAnalyzer
            val now = SystemClock.elapsedRealtime()
            if (now - lastFrame < config.camera.getLong("intervalMs")) return@setAnalyzer
            lastFrame = now
            source = frame.toBitmap()
            val rotation = frame.imageInfo.rotationDegrees
            bitmap = if (rotation == 0) source else Bitmap.createBitmap(source!!, 0, 0, source!!.width, source!!.height,
              Matrix().apply { postRotate(rotation.toFloat()) }, true)
            val detector = analyzer ?: FaceScanAnalyzer(context, config).also { analyzer = it }
            activeSession = session
            val observation = detector.inspect(bitmap!!, now)
            evidence = observation.evidence
            val decision = session.next(observation, now)
            if (token != generation) return@setAnalyzer
            if (decision.capture != null) {
              val reference = FaceReferenceCrop.crop(bitmap!!, observation, config.capture.getDouble("facePadding"))
              val bytes = try {
                ByteArrayOutputStream().use { stream ->
                  check(reference.compress(Bitmap.CompressFormat.JPEG, config.camera.getInt("jpegQuality"), stream))
                  stream.toByteArray()
                }
              } finally { if (reference !== bitmap) reference.recycle() }
              require(bytes.size <= config.camera.getInt("maxPhotoBytes"))
              emit("topScanCapture", Arguments.createMap().apply {
                putString("pose", decision.capture); putString("base64", Base64.encodeToString(bytes, Base64.NO_WRAP))
              }, token)
            }
            emitState(decision.hint, decision.pose, decision.progress, decision.reset, token)
          } catch (_: Exception) {
            failed = true
            emitState("unavailable", requested, token = token)
          } finally {
            evidence?.embedding?.fill(0.0)
            if (bitmap !== source) bitmap?.recycle()
            source?.recycle(); frame.close()
          }
        }
        cameraPreview.setSurfaceProvider(previewView.surfaceProvider)
        provider!!.bindToLifecycle(owner, selector, cameraPreview, cameraAnalysis)
        preview = cameraPreview; analysis = cameraAnalysis
      } catch (_: Exception) { emitState("unavailable", requested, token = token) }
    }, ContextCompat.getMainExecutor(context))
  }

  private fun emitState(hint: String, pose: String, progress: Double = 0.0, reset: Boolean = false, token: Int = generation) {
    emit("topScanState", Arguments.createMap().apply {
      putString("hint", hint); putString("pose", pose); putDouble("progress", progress); putBoolean("reset", reset)
    }, token)
  }
  private fun emit(name: String, value: WritableMap, token: Int) {
    value.putInt("runId", restartToken)
    post {
      if (!disposed && token == generation && id != NO_ID && isAttachedToWindow) {
        UIManagerHelper.getEventDispatcherForReactTag(reactContext, id)?.dispatchEvent(
          ScanEvent(UIManagerHelper.getSurfaceId(this), id, name, value))
      }
    }
  }
  private class ScanEvent(surface: Int, tag: Int, private val name: String, private val data: WritableMap) : Event<ScanEvent>(surface, tag) {
    override fun getEventName() = name
    override fun getEventData() = data
    override fun canCoalesce() = false // captures and resets must stay ordered
  }
}

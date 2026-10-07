package com.looklancare.app.monitoring

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.VideoSize
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import java.net.HttpURLConnection
import java.net.URI
import java.io.InputStream
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.atomic.AtomicBoolean

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class CameraStreamSession(
  context: Context,
  private val source: String,
  private val config: MonitoringConfig,
  private val onState: (String) -> Unit,
  private val onFrame: (Bitmap, Long) -> Unit,
) : AutoCloseable {
  private val thread = HandlerThread("CameraDecoder").apply { start() }
  private val handler = Handler(thread.looper)
  private val network = Executors.newSingleThreadExecutor()
  private val closed = AtomicBoolean(false)
  private val networkBusy = AtomicBoolean(false)
  private var player: ExoPlayer? = null
  private var output: DecodedFrameSurface? = null
  private var connection: HttpURLConnection? = null
  private var retryMs = config.long("retryInitialMs")
  private var lastFrame = SystemClock.elapsedRealtime()
  private var retrying = false
  private var hasDecodedFrame = false
  private var finished = false
  private val appContext = context.applicationContext
  private val watchdog = object : Runnable {
    override fun run() {
      if (closed.get()) return
      if (!finished && !retrying && !networkBusy.get() && SystemClock.elapsedRealtime() - lastFrame > config.long("frameStaleMs")) retry()
      handler.postDelayed(this, config.long("watchdogIntervalMs"))
    }
  }

  init {
    val uri = URI(source)
    require(uri.scheme == "http" || uri.scheme == "https") { "Camera requires HTTP/HTTPS" }
    handler.post { connect(); handler.post(watchdog) }
  }

  private fun acceptFrame(bitmap: Bitmap, timestamp: Long) {
    if (closed.get()) { bitmap.recycle(); return }
    lastFrame = timestamp; retryMs = config.long("retryInitialMs")
    hasDecodedFrame = true
    onFrame(bitmap, timestamp)
  }

  private fun connect() {
    if (closed.get() || !networkBusy.compareAndSet(false, true)) return
    retrying = false; lastFrame = SystemClock.elapsedRealtime()
    if (!hasDecodedFrame) onState("connecting")
    try { network.execute {
      try {
        val probe = URI(source).toURL().openConnection() as HttpURLConnection
        connection = probe
        probe.connectTimeout = config.int("connectTimeoutMs"); probe.readTimeout = config.int("readTimeoutMs")
        probe.useCaches = false
        check(probe.responseCode in 200..299) { "Camera returned an error" }
        val mime = probe.contentType?.substringBefore(';')?.lowercase().orEmpty()
        if (mime.startsWith("image/")) {
          val bytes = probe.inputStream.use { readBounded(it, config.int("maxSnapshotBytes") + 1) }
          check(bytes.size <= config.int("maxSnapshotBytes")) { "Camera image exceeds limit" }
          val dimensions = BitmapFactory.Options().apply { inJustDecodeBounds = true }
          BitmapFactory.decodeByteArray(bytes, 0, bytes.size, dimensions)
          check(dimensions.outWidth > 0 && dimensions.outHeight > 0) { "Camera returned an invalid image" }
          val options = BitmapFactory.Options().apply {
            inPreferredConfig = Bitmap.Config.ARGB_8888
            inSampleSize = 1
            while (maxOf(dimensions.outWidth, dimensions.outHeight) / inSampleSize > config.int("maxFrameDimension")) inSampleSize *= 2
          }
          val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options) ?: error("Camera returned an invalid image")
          probe.disconnect(); connection = null
          handler.post {
            if (!closed.get()) {
              val max = config.int("maxFrameDimension")
              val scale = minOf(1f, max.toFloat() / maxOf(bitmap.width, bitmap.height))
              val scaled = if (scale < 1f) Bitmap.createScaledBitmap(bitmap, (bitmap.width * scale).toInt().coerceAtLeast(1),
                (bitmap.height * scale).toInt().coerceAtLeast(1), true).also { bitmap.recycle() } else bitmap
              acceptFrame(scaled, SystemClock.elapsedRealtime())
              handler.postDelayed({ connect() }, config.long("frameIntervalMs"))
            } else bitmap.recycle()
          }
        } else {
          val prefix = probe.inputStream.use { readBounded(it, 16).toString(Charsets.UTF_8) }.trimStart('\uFEFF', ' ', '\r', '\n')
          probe.disconnect(); connection = null
          val hls = mime.contains("mpegurl") || prefix.startsWith("#EXTM3U")
          check(hls || mime.startsWith("video/") || URI(source).path.lowercase().endsWith(".mp4")) { "Use an HLS or MP4 camera link" }
          handler.post { if (!closed.get()) startPlayer(hls) }
        }
      } catch (_: Exception) {
        connection?.disconnect(); connection = null
        handler.post { retry() }
      } finally { networkBusy.set(false) }
    } } catch (_: RejectedExecutionException) { networkBusy.set(false) }
  }

  private fun startPlayer(hls: Boolean) {
    releasePlayer()
    try {
      output = DecodedFrameSurface(handler, config, { bitmap, time -> acceptFrame(bitmap, time) }, { retry() })
      val dataSource = DefaultHttpDataSource.Factory().setConnectTimeoutMs(config.int("connectTimeoutMs"))
        .setReadTimeoutMs(config.int("readTimeoutMs")).setAllowCrossProtocolRedirects(false)
      val loadControl = DefaultLoadControl.Builder().setBufferDurationsMs(config.int("bufferMinMs"), config.int("bufferMaxMs"),
        config.int("bufferPlaybackMs"), config.int("bufferRebufferMs")).build()
      val current = ExoPlayer.Builder(appContext).setLooper(thread.looper)
        .setMediaSourceFactory(DefaultMediaSourceFactory(dataSource)).setLoadControl(loadControl).build()
      player = current
      current.trackSelectionParameters = current.trackSelectionParameters.buildUpon().setTrackTypeDisabled(C.TRACK_TYPE_AUDIO, true).build()
      current.setVideoSurface(output!!.surface)
      current.addListener(object : Player.Listener {
        override fun onVideoSizeChanged(videoSize: VideoSize) { output?.setVideoSize(videoSize.width, videoSize.height, videoSize.pixelWidthHeightRatio) }
        override fun onPlayerError(error: PlaybackException) { retry() }
        override fun onPlaybackStateChanged(state: Int) {
          if (state == Player.STATE_ENDED) { finished = true; onState("ended") }
        }
      })
      val item = MediaItem.Builder().setUri(source)
        .setLiveConfiguration(MediaItem.LiveConfiguration.Builder().setTargetOffsetMs(config.long("liveTargetOffsetMs")).build())
      if (hls) item.setMimeType(MimeTypes.APPLICATION_M3U8)
      current.setMediaItem(item.build()); current.prepare(); current.play()
    } catch (_: Exception) { retry() }
  }

  private fun retry() {
    if (closed.get() || retrying) return
    retrying = true
    hasDecodedFrame = false
    onState("reconnecting")
    releasePlayer()
    val delay = retryMs
    retryMs = (retryMs * 2).coerceAtMost(config.long("retryMaxMs"))
    handler.postDelayed({ connect() }, delay)
  }

  private fun releasePlayer() {
    try { player?.release() } catch (_: Exception) { /* Always release the output too. */ }
    finally { player = null }
    try { output?.close() } catch (_: Exception) { /* Device GL teardown must not kill the recovery loop. */ }
    finally { output = null }
  }

  private fun readBounded(input: InputStream, maximum: Int): ByteArray {
    val output = ByteArrayOutputStream()
    val buffer = ByteArray(minOf(maximum, 4096))
    while (output.size() < maximum) {
      val count = input.read(buffer, 0, minOf(buffer.size, maximum - output.size()))
      if (count < 0) break
      output.write(buffer, 0, count)
    }
    return output.toByteArray()
  }

  override fun close() {
    if (!closed.compareAndSet(false, true)) return
    connection?.disconnect()
    network.shutdownNow()
    handler.removeCallbacksAndMessages(null)
    handler.post { releasePlayer(); thread.quitSafely() }
  }
}

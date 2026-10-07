package com.looklancare.app.monitoring

import android.graphics.Bitmap
import android.graphics.Matrix
import android.graphics.SurfaceTexture
import android.opengl.EGL14
import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.os.Handler
import android.os.SystemClock
import android.view.Surface
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** A real decoder output surface with no Activity/View dependency. */
class DecodedFrameSurface(
  private val handler: Handler,
  private val config: MonitoringConfig,
  private val onFrame: (Bitmap, Long) -> Unit,
  private val onError: () -> Unit,
) : AutoCloseable {
  private val display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
  private val eglContext: android.opengl.EGLContext
  private val eglSurface: android.opengl.EGLSurface
  private val textureId: Int
  private val texture: SurfaceTexture
  val surface: Surface
  private val program: Int
  private val vertices = ByteBuffer.allocateDirect(16 * 4).order(ByteOrder.nativeOrder()).asFloatBuffer().apply {
    put(floatArrayOf(-1f, -1f, 0f, 0f, 1f, -1f, 1f, 0f, -1f, 1f, 0f, 1f, 1f, 1f, 1f, 1f)); position(0)
  }
  private val transform = FloatArray(16)
  private var width = config.int("maxFrameDimension")
  private var height = width
  private var lastSample = 0L
  private var closed = false
  private var pixels = ByteBuffer.allocateDirect(width * height * 4).order(ByteOrder.nativeOrder())

  init {
    check(display != EGL14.EGL_NO_DISPLAY)
    check(EGL14.eglInitialize(display, IntArray(2), 0, IntArray(2), 0))
    val choices = arrayOfNulls<android.opengl.EGLConfig>(1)
    val attributes = intArrayOf(EGL14.EGL_RED_SIZE, 8, EGL14.EGL_GREEN_SIZE, 8, EGL14.EGL_BLUE_SIZE, 8,
      EGL14.EGL_ALPHA_SIZE, 8, EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT,
      EGL14.EGL_SURFACE_TYPE, EGL14.EGL_PBUFFER_BIT, EGL14.EGL_NONE)
    val count = IntArray(1)
    check(EGL14.eglChooseConfig(display, attributes, 0, choices, 0, 1, count, 0) && count[0] > 0)
    eglContext = EGL14.eglCreateContext(display, choices[0], EGL14.EGL_NO_CONTEXT,
      intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE), 0)
    eglSurface = EGL14.eglCreatePbufferSurface(display, choices[0],
      intArrayOf(EGL14.EGL_WIDTH, width, EGL14.EGL_HEIGHT, height, EGL14.EGL_NONE), 0)
    makeCurrent()
    val ids = IntArray(1)
    GLES20.glGenTextures(1, ids, 0); textureId = ids[0]
    GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId)
    GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
    GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
    GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
    GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
    program = GLES20.glCreateProgram()
    val vertex = shader(GLES20.GL_VERTEX_SHADER, "attribute vec4 position; attribute vec2 uv; uniform mat4 transform; varying vec2 coord; void main(){gl_Position=position;coord=(transform*vec4(uv,0.0,1.0)).xy;}")
    val fragment = shader(GLES20.GL_FRAGMENT_SHADER, "#extension GL_OES_EGL_image_external : require\nprecision mediump float; uniform samplerExternalOES image; varying vec2 coord; void main(){gl_FragColor=texture2D(image,coord);}")
    GLES20.glAttachShader(program, vertex); GLES20.glAttachShader(program, fragment); GLES20.glLinkProgram(program)
    val linked = IntArray(1); GLES20.glGetProgramiv(program, GLES20.GL_LINK_STATUS, linked, 0)
    check(linked[0] != 0) { "Frame renderer unavailable" }
    GLES20.glDeleteShader(vertex); GLES20.glDeleteShader(fragment)
    texture = SurfaceTexture(textureId)
    texture.setOnFrameAvailableListener({
      if (!closed) {
        try {
          makeCurrent()
          texture.updateTexImage()
          val now = SystemClock.elapsedRealtime()
          if (now - lastSample >= config.long("frameIntervalMs")) {
            lastSample = now
            onFrame(readBitmap(), now)
          }
        } catch (_: Exception) { onError() }
      }
    }, handler)
    surface = Surface(texture)
  }

  fun setVideoSize(videoWidth: Int, videoHeight: Int, pixelRatio: Float) {
    if (videoWidth <= 0 || videoHeight <= 0) return
    val ratio = videoWidth * (if (pixelRatio.isFinite() && pixelRatio > 0f) pixelRatio else 1f) / videoHeight
    val maximum = config.int("maxFrameDimension")
    width = if (ratio >= 1f) maximum else (maximum * ratio).toInt().coerceAtLeast(1)
    height = if (ratio >= 1f) (maximum / ratio).toInt().coerceAtLeast(1) else maximum
    pixels = ByteBuffer.allocateDirect(width * height * 4).order(ByteOrder.nativeOrder())
  }

  private fun readBitmap(): Bitmap {
    texture.getTransformMatrix(transform)
    GLES20.glViewport(0, 0, width, height)
    GLES20.glUseProgram(program)
    GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
    GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId)
    GLES20.glUniform1i(GLES20.glGetUniformLocation(program, "image"), 0)
    GLES20.glUniformMatrix4fv(GLES20.glGetUniformLocation(program, "transform"), 1, false, transform, 0)
    val position = GLES20.glGetAttribLocation(program, "position")
    val uv = GLES20.glGetAttribLocation(program, "uv")
    vertices.position(0); GLES20.glVertexAttribPointer(position, 2, GLES20.GL_FLOAT, false, 4 * 4, vertices)
    vertices.position(2); GLES20.glVertexAttribPointer(uv, 2, GLES20.GL_FLOAT, false, 4 * 4, vertices)
    GLES20.glEnableVertexAttribArray(position); GLES20.glEnableVertexAttribArray(uv)
    GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
    pixels.position(0)
    GLES20.glReadPixels(0, 0, width, height, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, pixels)
    check(GLES20.glGetError() == GLES20.GL_NO_ERROR) { "Cannot read decoded frame" }
    pixels.position(0)
    val raw = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    raw.copyPixelsFromBuffer(pixels)
    val flip = Matrix().apply { setScale(1f, -1f) }
    return Bitmap.createBitmap(raw, 0, 0, width, height, flip, false).also { raw.recycle() }
  }

  private fun makeCurrent() {
    check(EGL14.eglMakeCurrent(display, eglSurface, eglSurface, eglContext)) { "Frame renderer context unavailable" }
  }

  private fun shader(type: Int, source: String): Int = GLES20.glCreateShader(type).also {
    GLES20.glShaderSource(it, source); GLES20.glCompileShader(it)
    val status = IntArray(1); GLES20.glGetShaderiv(it, GLES20.GL_COMPILE_STATUS, status, 0)
    check(status[0] != 0) { "Frame renderer shader unavailable" }
  }

  override fun close() {
    if (closed) return
    closed = true
    texture.setOnFrameAvailableListener(null)
    surface.release(); texture.release()
    makeCurrent()
    GLES20.glDeleteProgram(program); GLES20.glDeleteTextures(1, intArrayOf(textureId), 0)
    EGL14.eglMakeCurrent(display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
    EGL14.eglDestroySurface(display, eglSurface); EGL14.eglDestroyContext(display, eglContext)
    // EGL_DEFAULT_DISPLAY is shared with other cameras and the app renderer.
    // Destroy only resources owned by this decoder; terminating the display invalidates theirs.
    EGL14.eglReleaseThread()
  }
}

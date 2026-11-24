package com.looklancare.app.enrollment

import android.graphics.Bitmap
import kotlin.math.ceil
import kotlin.math.floor

/** Reference photos contain the face and a small margin rather than the entire room. */
object FaceReferenceCrop {
  fun crop(bitmap: Bitmap, face: FaceObservation, padding: Double): Bitmap {
    require(face.count == 1 && padding >= 0 && padding.isFinite())
    require(listOf(face.left,face.top,face.width,face.height).all { it.isFinite() } && face.width > 0 && face.height > 0)
    val left = floor((face.left - face.width * padding) * bitmap.width).toInt().coerceIn(0,bitmap.width)
    val top = floor((face.top - face.height * padding) * bitmap.height).toInt().coerceIn(0,bitmap.height)
    val right = ceil((face.left + face.width * (1 + padding)) * bitmap.width).toInt().coerceIn(0,bitmap.width)
    val bottom = ceil((face.top + face.height * (1 + padding)) * bitmap.height).toInt().coerceIn(0,bitmap.height)
    require(right > left && bottom > top)
    return Bitmap.createBitmap(bitmap,left,top,right-left,bottom-top)
  }
}

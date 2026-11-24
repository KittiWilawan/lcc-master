package com.looklancare.app.enrollment

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Rect
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import kotlin.math.ceil
import kotlin.math.floor

/** Negative controls ensure false-positive fixes do not silently disable multi-person checks. */
class FaceScanRegressionNativeTest {
  private val context=InstrumentationRegistry.getInstrumentation().targetContext
  private fun root(): File {
    require(context.packageName.endsWith(".faceaudit.release") || context.packageName.endsWith(".coreaudit.release"))
    val external=requireNotNull(context.getExternalFilesDir(null)).canonicalFile
    val root=File(external,InstrumentationRegistry.getArguments().getString("auditDirectory","face-video-audit")).canonicalFile
    require(root.path.startsWith(external.path+File.separator)); return root
  }
  @Test fun coarseWallTextureIsRejectedButSmallBackgroundPersonIsKept() {
    val directory=root(); val manifest=JSONObject(File(directory,"manifest.json").readText())
    val controls=manifest.getJSONObject("regressionControls")
    val config=FaceScanConfig.load(context)
    val source=BitmapFactory.decodeFile(File(directory,controls.getString("foreground")).absolutePath)
    val background=BitmapFactory.decodeFile(File(directory,controls.getString("background")).absolutePath)
    val wall=BitmapFactory.decodeFile(File(directory,controls.getString("fakeTextureFrame")).absolutePath)
    assertNotNull(source); assertNotNull(background); assertNotNull(wall)
    val mixed=source.copy(Bitmap.Config.ARGB_8888,true)
    var backgroundCrop:Bitmap?=null
    val records=JSONArray()
    try {
      FaceScanAnalyzer(context,config).use { analyzer ->
        val face=analyzer.inspect(source,1)
        try {
          assertEquals(1,face.count)
          val known=FaceRegion(face.left,face.top,face.width,face.height)
          val bounds=controls.getJSONArray("backgroundBounds")
          val region=FaceRegion(bounds.getDouble(0),bounds.getDouble(1),bounds.getDouble(2),bounds.getDouble(3)).expanded(config.sceneRules.verificationScale)
          val box=Rect(floor(region.left*background.width).toInt(),floor(region.top*background.height).toInt(),
            ceil((region.left+region.width)*background.width).toInt().coerceAtMost(background.width),
            ceil((region.top+region.height)*background.height).toInt().coerceAtMost(background.height))
          backgroundCrop=Bitmap.createBitmap(background,box.left,box.top,box.width(),box.height())
          val destination=controls.getJSONArray("outputRect").let { Rect(it.getInt(0),it.getInt(1),it.getInt(2),it.getInt(3)) }
          Canvas(mixed).drawBitmap(backgroundCrop!!,null,destination,Paint(Paint.FILTER_BITMAP_FLAG))
          SceneFaceInspector(context,config.sceneRules).use { scene ->
            val single=scene.inspect(source,listOf(known)); assertEquals(1,single.size)
            val multiple=scene.inspect(mixed,listOf(known))
            records.put(JSONObject().put("case","small-background-person").put("faces",multiple.size))
            assertTrue("Landmark confirmation must still find a small genuine second face",multiple.size>=2)
          }
          val scan=config.session("all")
          try {
            FaceScanAnalyzer(context,config).use { mixedAnalyzer ->
              for(index in 0 until config.rules.multipleConfirmFrames) {
                val observed=mixedAnalyzer.inspect(mixed,(index+1)*config.camera.getLong("intervalMs"))
                try {
                  assertTrue("The complete adapter must see the small second face",observed.count>=2)
                  val decision=scan.next(observed,(index+1)*config.camera.getLong("intervalMs"))
                  assertNull(decision.capture)
                  if(index==config.rules.multipleConfirmFrames-1) { assertEquals("multiple",decision.hint); assertTrue(decision.reset) }
                  else { assertEquals("checking_scene",decision.hint); assertFalse(decision.reset) }
                } finally { observed.evidence?.embedding?.fill(0.0) }
              }
            }
          } finally { scan.close() }
        } finally { face.evidence?.embedding?.fill(0.0) }
      }
      FaceScanAnalyzer(context,config).use { analyzer ->
        val result=analyzer.inspect(wall,1)
        try {
          records.put(JSONObject().put("case","wall-texture-single-person").put("faces",result.count))
          assertEquals("A wall pattern cannot become a second person",1,result.count)
        } finally { result.evidence?.embedding?.fill(0.0) }
      }
    } finally {
      File(directory,"regression-native.json").writeText(records.toString())
      File(directory,"small-background-person.jpg").outputStream().use { mixed.compress(Bitmap.CompressFormat.JPEG,config.camera.getInt("jpegQuality"),it) }
      source.recycle(); background.recycle(); wall.recycle(); mixed.recycle(); backgroundCrop?.recycle()
    }
  }
  @Test fun frameSignaturePreservesItsCallerAndDetectsContentChanges() {
    val config=FaceScanConfig.load(context)
    val bitmap=Bitmap.createBitmap(64,64,Bitmap.Config.ARGB_8888)
    val samples=config.freshness.getInt("sampleSize")
    try {
      val first=FrameSignature.measure(bitmap,samples)
      assertArrayEquals(first,FrameSignature.measure(bitmap,samples)); assertFalse(bitmap.isRecycled)
      bitmap.eraseColor(android.graphics.Color.WHITE)
      assertFalse(first.contentEquals(FrameSignature.measure(bitmap,samples)))
      first.fill(0)
    } finally { bitmap.recycle() }
  }
}

package com.looklancare.app.enrollment

import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

data class FaceDuplicatePolicy(val minIou: Double, val maxCenterRatio: Double, val minScaleRatio: Double, val maxLandmarkRatio: Double) {
  init { require(minIou in 0.0..1.0 && minScaleRatio in 0.0..1.0 && maxCenterRatio > 0 && maxLandmarkRatio > 0) }
}

/** Merge only near-identical meshes, retaining separate people whose face boxes overlap. */
object FaceDuplicateReducer {
  fun indices(regions: List<FaceRegion>, points: List<List<ImagePoint>>, policy: FaceDuplicatePolicy): List<Int> {
    require(regions.size == points.size)
    val retained = mutableListOf<Int>()
    for (index in regions.indices.sortedByDescending { regions[it].width * regions[it].height }) {
      val duplicate = retained.any { other ->
        val a = regions[index]; val b = regions[other]
        val scale = min(a.width, b.width)
        val overlap = max(0.0, min(a.left+a.width,b.left+b.width)-max(a.left,b.left)) *
          max(0.0,min(a.top+a.height,b.top+b.height)-max(a.top,b.top))
        val union = a.width*a.height + b.width*b.height - overlap
        val first = points[index]; val second = points[other]
        scale > 0 && union > 0 && overlap/union >= policy.minIou &&
          scale/max(a.width,b.width) >= policy.minScaleRatio && min(a.height,b.height)/max(a.height,b.height) >= policy.minScaleRatio &&
          hypot(a.left+a.width/2-b.left-b.width/2,a.top+a.height/2-b.top-b.height/2)/scale <= policy.maxCenterRatio &&
          first.isNotEmpty() && first.size == second.size && first.indices.all { i ->
            first[i].x.isFinite() && first[i].y.isFinite() && second[i].x.isFinite() && second[i].y.isFinite()
          } && first.indices.map { i -> hypot(first[i].x-second[i].x,first[i].y-second[i].y) }.average()/scale <= policy.maxLandmarkRatio
      }
      if (!duplicate) retained.add(index)
    }
    return retained
  }
}

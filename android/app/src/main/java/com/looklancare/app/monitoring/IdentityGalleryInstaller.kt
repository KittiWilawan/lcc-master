package com.looklancare.app.monitoring

import android.content.Context
import android.util.Base64
import com.looklancare.app.enrollment.FaceVectors
import com.looklancare.app.imaging.BitmapFrames
import org.json.JSONArray
import org.json.JSONObject

object IdentityGalleryInstaller {
  fun prepare(context: Context, payload: JSONObject): JSONObject {
    MonitoringIdentityAnalyzer(context).use { encoder ->
      val config = encoder.settings
      val members = payload.getJSONArray("members")
      require(members.length() <= config.getInt("maxMembers"))
      val output = JSONArray()
      val ids = mutableSetOf<String>()
      for (i in 0 until members.length()) {
        val profile = members.getJSONObject(i)
        val id = profile.getString("id"); require(id.isNotBlank() && ids.add(id))
        val photos = profile.getJSONArray("photos")
        require(photos.length() <= config.getInt("maxReferences"))
        val vectors = mutableListOf<DoubleArray>()
        for (j in 0 until photos.length()) {
          val value = photos.getString(j)
          require(value.length <= (config.getInt("maxReferenceBytes") + 2) / 3 * 4)
          val bytes = Base64.decode(value, Base64.NO_WRAP)
          require(bytes.size <= config.getInt("maxReferenceBytes"))
          val bitmap = try { BitmapFrames.decode(bytes, config.getInt("maxReferenceDimension")) }
            finally { bytes.fill(0) }
          try { runCatching { encoder.reference(bitmap) }.getOrNull()?.let { vectors.add(it) } }
          finally { bitmap.recycle() }
        }
        // Reject mixed people instead of averaging them into one identity.
        val compatible = vectors.indices.any { a -> vectors.indices.all { b ->
          (FaceVectors.cosine(vectors[a], vectors[b]) ?: -1.0) >= config.getDouble("referenceSimilarityThreshold")
        } }
        if (compatible && vectors.size >= config.getInt("minReferences")) output.put(JSONObject()
          .put("id", id).put("name", profile.getString("name")).put("vectors", JSONArray(vectors.map { JSONArray(it.toList()) })))
        vectors.forEach { it.fill(0.0) }
      }
      return JSONObject().put("userId", payload.getString("userId")).put("familyId", payload.getString("familyId"))
        .put("revision", payload.getString("revision")).put("expiresAt", System.currentTimeMillis() + config.getLong("galleryTtlMs"))
        .put("members", output)
    }
  }
}

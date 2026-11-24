package com.looklancare.app.monitoring

import org.json.JSONObject

object CameraMonitoringTargets {
  fun read(camera: JSONObject?): PersonMonitoringScope {
    if (camera == null) return PersonMonitoringScope(emptySet())
    if (camera.has("targetMemberIds")) {
      val values = camera.getJSONArray("targetMemberIds")
      val ids = (0 until values.length()).map { values.getString(it).also { id -> require(id.isNotBlank()) } }
      require(ids.distinct().size == ids.size)
      return PersonMonitoringScope(ids.toSet())
    }
    return PersonMonitoringScope(setOfNotNull(camera.optString("targetMemberId").takeIf { it.isNotBlank() }))
  }
}

package com.looklancare.app.monitoring

import org.json.JSONObject

/** Expand one analyzed frame into independently deliverable events, without changing the preview. */
object PersonFallEvents {
  fun from(frame: JSONObject): List<JSONObject> {
    val falls = frame.getJSONArray("personFalls")
    return List(falls.length()) { i ->
      val person = falls.getJSONObject(i)
      JSONObject().apply {
        for (key in frame.keys()) if (key != "personFalls") put(key, frame.get(key))
        for (key in person.keys()) put(key, person.get(key))
      }
    }
  }
}

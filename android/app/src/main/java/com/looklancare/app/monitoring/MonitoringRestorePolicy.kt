package com.looklancare.app.monitoring

data class MonitorScope(val userId: String, val familyId: String) {
  init { require(userId.isNotBlank() && familyId.isNotBlank()) }
}
object MonitoringRestorePolicy {
  fun allowed(desired: Boolean, enabled: Boolean, savedScope: MonitorScope?, permissionScope: MonitorScope?,
              permissionExpiresAt: Long, now: Long): Boolean = desired && enabled && savedScope != null &&
    savedScope == permissionScope && permissionExpiresAt > now
}

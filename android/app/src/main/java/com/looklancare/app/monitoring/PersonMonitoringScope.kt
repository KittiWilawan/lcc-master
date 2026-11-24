package com.looklancare.app.monitoring

/** An empty selection monitors everyone; a selection never admits an unverified identity. */
data class PersonMonitoringScope(val memberIds: Set<String>) {
  init { require(memberIds.all { it.isNotBlank() }) }
  val allPeople: Boolean get() = memberIds.isEmpty()
  fun includes(memberId: String?): Boolean = allPeople || (memberId != null && memberId in memberIds)
}

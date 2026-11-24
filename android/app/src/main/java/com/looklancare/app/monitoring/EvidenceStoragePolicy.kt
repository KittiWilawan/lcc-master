package com.looklancare.app.monitoring

data class EvidenceStorageRules(val maxEvidenceBytes: Long, val minimumFreeBytes: Long, val maxEventImageBytes: Long) {
  init { require(maxEvidenceBytes > 0 && minimumFreeBytes > 0 && maxEventImageBytes > 0 && maxEventImageBytes <= maxEvidenceBytes) }
  fun canStore(used: Long, additional: Long, free: Long): Boolean {
    require(used >= 0 && additional >= 0 && free >= 0)
    return additional <= maxEventImageBytes && used <= maxEvidenceBytes && additional <= maxEvidenceBytes - used &&
      free >= minimumFreeBytes && additional <= free - minimumFreeBytes
  }
}

package com.looklancare.app.monitoring

import org.junit.Assert.*
import org.junit.Test

class MonitoringHealthTest {
  private val rules = HealthRules(30000, 12000, 12000, 15000, 6000, 4000, 60000, 0.8)
  private val empty = QueueHealthInput(0, 30, 0)
  private fun camera(state: String = "ready", frame: Long = 40000, analysis: Long = 40000, content: Long = 40000) =
    CameraHealthInput("camera-a", 1, state, frame, analysis, content, false)
  @Test fun startupAndBriefNetworkLossDoNotAlert() {
    val policy = MonitoringHealthPolicy(rules)
    assertTrue(policy.evaluate(listOf(camera("connecting", 0, 0, 0)), empty, 29000).isEmpty())
    assertTrue(policy.evaluate(listOf(camera("reconnecting")), empty, 53000).isEmpty())
    assertTrue(policy.evaluate(listOf(camera(frame = 56000, analysis = 56000, content = 56000)), empty, 56000).isEmpty())
  }
  @Test fun missingFramesAlertAndClearOnlyAfterStableRecovery() {
    val policy = MonitoringHealthPolicy(rules)
    policy.evaluate(listOf(camera()), empty, 53000)
    assertEquals(setOf(HealthProblem("camera-a", HealthIssue.CAMERA_UNAVAILABLE)), policy.evaluate(listOf(camera()), empty, 59000))
    assertFalse(policy.evaluate(listOf(camera(frame = 60000, analysis = 60000, content = 60000)), empty, 60000).isEmpty())
    assertTrue(policy.evaluate(listOf(camera(frame = 64000, analysis = 64000, content = 64000)), empty, 64000).isEmpty())
  }
  @Test fun staticContentIsNotMisreportedAsAConnectionFailure() {
    val policy = MonitoringHealthPolicy(rules)
    policy.evaluate(listOf(camera(frame = 56000, analysis = 56000)), empty, 56000)
    val result = policy.evaluate(listOf(camera(frame = 62000, analysis = 62000)), empty, 62000)
    assertEquals(setOf(HealthProblem("camera-a", HealthIssue.IMAGE_UNCHANGED)), result)
  }
  @Test fun liveFramesWithoutNewAnalysisAreAnAiProblem() {
    val policy = MonitoringHealthPolicy(rules)
    policy.evaluate(listOf(camera(frame = 54000, content = 54000)), empty, 54000)
    assertEquals(setOf(HealthProblem("camera-a", HealthIssue.ANALYSIS_STALE)),
      policy.evaluate(listOf(camera(frame = 60000, content = 60000)), empty, 60000))
  }
  @Test fun aiErrorAndSaveErrorRemainSeparateFromFallEvents() {
    val policy = MonitoringHealthPolicy(rules)
    policy.evaluate(listOf(camera("ai_error").copy(saveFailed = true)), empty, 40000)
    val result = policy.evaluate(listOf(camera("ai_error", frame = 46000).copy(saveFailed = true)), empty, 46000)
    assertTrue(result.contains(HealthProblem("camera-a", HealthIssue.AI_UNAVAILABLE)))
    assertTrue(result.contains(HealthProblem("camera-a", HealthIssue.EVENT_SAVE_FAILED)))
  }
  @Test fun nearFullAndDiscardedQueueAreBothVisible() {
    val policy = MonitoringHealthPolicy(rules)
    val queue = QueueHealthInput(24, 30, 2)
    policy.evaluate(emptyList(), queue, 1)
    assertEquals(setOf(HealthProblem(null, HealthIssue.QUEUE_NEAR_FULL), HealthProblem(null, HealthIssue.QUEUE_DISCARDED)),
      policy.evaluate(emptyList(), queue, 6001))
  }
  @Test fun removedCamerasAndClockRollbackCannotCarryOldProblems() {
    val policy = MonitoringHealthPolicy(rules)
    policy.evaluate(listOf(camera()), empty, 53000); policy.evaluate(listOf(camera()), empty, 59000)
    assertTrue(policy.evaluate(emptyList(), empty, 60000).isEmpty())
    assertTrue(policy.evaluate(listOf(camera()), empty, 2).isEmpty())
  }
  @Test fun repeatedProblemDoesNotSpamAndNewProblemWaitsForCooldown() {
    val gate = HealthNotificationGate(60000)
    val first = setOf(HealthProblem("a", HealthIssue.CAMERA_UNAVAILABLE))
    val second = first + HealthProblem(null, HealthIssue.QUEUE_NEAR_FULL)
    assertTrue(gate.shouldPost(first, 1)); gate.posted(first, 1)
    assertFalse(gate.shouldPost(first, 100000))
    assertFalse(gate.shouldPost(second, 20000)); assertTrue(gate.shouldPost(second, 60001))
    gate.posted(second, 60001); gate.shouldPost(emptySet(), 70000)
    assertTrue(gate.shouldPost(first, 120001))
  }
}

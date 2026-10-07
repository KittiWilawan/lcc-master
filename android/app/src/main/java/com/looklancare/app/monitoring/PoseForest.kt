package com.looklancare.app.monitoring

import java.io.DataInputStream
import java.io.InputStream
import kotlin.math.exp

/** The inference core has no Android, networking, or UI dependencies. */
class PoseForest(input: InputStream) {
  private data class Tree(val left: IntArray, val right: IntArray, val feature: IntArray,
                          val threshold: DoubleArray, val probability: DoubleArray)
  val featureCount: Int
  private val trees: List<Tree>
  private val gradient: Boolean
  private val baseline: Double

  init {
    DataInputStream(input.buffered()).use { source ->
      val version = source.readInt()
      require(version == 1 || version == 2) { "Unsupported forest format" }
      gradient = version == 2
      featureCount = source.readInt()
      require(featureCount > 0)
      val treeCount = source.readInt().also { require(it > 0) }
      baseline = if (gradient) source.readDouble() else 0.0
      trees = List(treeCount) {
        val count = source.readInt().also { require(it > 0) }
        val tree = Tree(IntArray(count), IntArray(count), IntArray(count), DoubleArray(count), DoubleArray(count))
        for (index in 0 until count) {
          tree.left[index] = source.readInt()
          tree.right[index] = source.readInt()
          tree.feature[index] = source.readInt()
          tree.threshold[index] = source.readDouble()
          tree.probability[index] = source.readDouble()
          require(tree.probability[index].isFinite())
          if (!gradient) require(tree.probability[index] in 0.0..1.0)
          if (tree.left[index] != -1) {
            require(tree.left[index] in (index + 1) until count && tree.right[index] in (index + 1) until count)
            require(tree.feature[index] in 0 until featureCount)
          }
        }
        tree
      }
    }
  }

  fun predict(features: FloatArray): Double {
    require(features.size == featureCount && features.all { it.isFinite() })
    val sum = trees.sumOf { tree ->
      var node = 0
      while (tree.left[node] != -1) {
        node = if (features[tree.feature[node]] <= tree.threshold[node]) tree.left[node] else tree.right[node]
      }
      tree.probability[node]
    }
    return if (gradient) 1.0 / (1.0 + exp(-(baseline + sum))) else sum / trees.size
  }
}

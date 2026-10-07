import sys
import unittest
from pathlib import Path

import numpy as np


TRAINING_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(TRAINING_ROOT))

from benchmark_many_datasets import source_weights


class SourceWeightTests(unittest.TestCase):
    def test_smaller_source_receives_more_weight_without_changing_mean(self):
        weights = source_weights(np.array(["large", "large", "large", "small"]), 0.5)
        self.assertGreater(weights[-1], weights[0])
        self.assertAlmostEqual(float(weights.mean()), 1.0)

    def test_zero_exponent_disables_source_weighting(self):
        self.assertIsNone(source_weights(np.array(["one"]), 0.0))


if __name__ == "__main__":
    unittest.main()

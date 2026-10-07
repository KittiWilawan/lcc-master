import sys
import unittest
from pathlib import Path

import numpy as np


TRAINING_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(TRAINING_ROOT))

from train_pose_classifier import evaluate


class ConstantProbabilityModel:
    def predict_proba(self, features):
        probabilities = np.full(len(features), 0.8)
        return np.column_stack((1.0 - probabilities, probabilities))


class PoseEvaluationTests(unittest.TestCase):
    def test_single_class_recall_is_supported(self):
        metrics = evaluate(ConstantProbabilityModel(), np.zeros((3, 1)), np.ones(3), 0.5)
        self.assertEqual(metrics["recall"], 1.0)
        self.assertIsNone(metrics["specificity"])
        self.assertIsNone(metrics["roc_auc"])

    def test_ineligible_pose_sequence_cannot_trigger_a_fall(self):
        metrics = evaluate(
            ConstantProbabilityModel(), np.zeros((2, 1)), np.ones(2), 0.5,
            np.array([True, False]),
        )
        self.assertEqual(metrics["true_positive"], 1)
        self.assertEqual(metrics["false_negative"], 1)


if __name__ == "__main__":
    unittest.main()

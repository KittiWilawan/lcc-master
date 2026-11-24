import json
from pathlib import Path
import struct
import tempfile
import unittest

import numpy as np
from binary_forest import BinaryForest


class BinaryForestTest(unittest.TestCase):
    def test_gradient_log_odds_and_split_boundary(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/"model.bin"
            with path.open("wb") as stream:
                stream.write(struct.pack(">iiidi", 2, 1, 1, 0.0, 3))
                for node in [(1, 2, 0, .5, 0), (-1, -1, 0, 0, -2), (-1, -1, 0, 0, 2)]:
                    stream.write(struct.pack(">iiidd", *node))
            actual = BinaryForest(path, np).predict_proba([[.5], [.6]])[:, 1]
            np.testing.assert_allclose(actual, [1/(1+np.exp(2)), 1/(1+np.exp(-2))])

    def test_forest_probability_average(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/"model.bin"
            with path.open("wb") as stream:
                stream.write(struct.pack(">iii", 1, 1, 2))
                for probability in [.2, .6]:
                    stream.write(struct.pack(">iiiidd", 1, -1, -1, 0, 0, probability))
            np.testing.assert_allclose(BinaryForest(path, np).predict_proba([[0]])[:, 1], [.4])

    def test_truncation_and_cycles_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/"model.bin"
            path.write_bytes(b"bad")
            with self.assertRaises(ValueError): BinaryForest(path, np)
            path.write_bytes(struct.pack(">iiiiiiidd", 1, 1, 1, 1, 0, 0, 0, .5, 0))
            model = BinaryForest(path, np)
            with self.assertRaises(ValueError): model.predict_proba([[0]])

    def test_shipped_weights_match_frozen_export_probabilities(self):
        assets = Path(__file__).resolve().parents[2]/"android/app/src/main/assets/monitoring"
        fixture = json.loads((assets/"parity.json").read_text())
        actual = BinaryForest(assets/"fall_forest.bin", np).predict_proba(fixture["features"])[:, 1]
        np.testing.assert_allclose(actual, fixture["probabilities"], atol=1e-12, rtol=0)


if __name__ == "__main__": unittest.main()

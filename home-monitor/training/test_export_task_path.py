import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import joblib
import numpy as np
from sklearn.ensemble import ExtraTreesClassifier, HistGradientBoostingClassifier
from binary_forest import BinaryForest
import export_android_pose_model


class ExportTaskPathTest(unittest.TestCase):
    def check_export(self, classifier):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            rng = np.random.default_rng(7)
            features = rng.normal(size=(12, 1242)).astype(np.float32)
            classifier.fit(features, np.arange(12) % 2)
            model = root/"model.joblib"
            joblib.dump({"model": classifier, "feature_variant": "temporal", "frames_per_video": 3}, model)
            task = root/"full.task";task.write_bytes(b"synthetic-task-for-export-test")
            metadata = root/"template.json"
            metadata.write_text(json.dumps({"landmarkerAsset": "monitoring/pose_landmarker_full.task",
                "landmarkCount": 33, "visibilityThreshold": .35, "normalizationMinScale": .05}))
            output = root/"export"
            with patch.object(sys, "argv", ["export", str(model), str(task), str(output), "--threshold", ".45", "--metadata-template", str(metadata)]), contextlib.redirect_stdout(io.StringIO()):
                export_android_pose_model.main()
            self.assertEqual(json.loads((output/"model.json").read_text())["landmarkerAsset"], "monitoring/pose_landmarker_full.task")
            self.assertEqual((output/"pose_landmarker_full.task").read_bytes(), task.read_bytes())
            self.assertFalse((output/"pose_landmarker_lite.task").exists())
            np.testing.assert_allclose(BinaryForest(output/"fall_forest.bin", np).predict_proba(features), classifier.predict_proba(features), atol=1e-12, rtol=0)

    def test_full_task_template_is_preserved_with_predictor_parity(self):
        self.check_export(ExtraTreesClassifier(n_estimators=2, max_depth=2, random_state=7, n_jobs=1))

    def test_gradient_export_preserves_full_task_and_probability_parity(self):
        self.check_export(HistGradientBoostingClassifier(max_iter=2, max_leaf_nodes=3, min_samples_leaf=2, random_state=7, early_stopping=False))


if __name__ == "__main__": unittest.main()

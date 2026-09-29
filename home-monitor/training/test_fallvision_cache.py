import sys
import unittest
from pathlib import Path

import numpy as np


TRAINING_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(TRAINING_ROOT))

from build_fallvision_cache import describe_case, normalize_frame


class FallVisionCacheTests(unittest.TestCase):
    def test_source_groups_are_separated(self):
        self.assertEqual(describe_case(Path("f_mask_s_3/S_N_01_keypoints.csv")), ("fall", "N", "train"))
        self.assertEqual(describe_case(Path("nf_mask_s_2/S_M_01_keypoints.csv")), ("normal", "M", "validation"))
        self.assertEqual(describe_case(Path("f_mask_s_1/S_D_0001_keypoints.csv")), ("fall", "D", "test"))

    def test_coco_pose_has_mediapipe_compatible_shape(self):
        points = {
            "Nose": (100.0, 10.0, 0.9),
            "Left Shoulder": (80.0, 50.0, 0.9),
            "Right Shoulder": (120.0, 50.0, 0.9),
            "Left Ankle": (85.0, 190.0, 0.9),
            "Right Ankle": (115.0, 190.0, 0.9),
        }
        features = normalize_frame(points)
        self.assertEqual(features.shape, (138,))
        self.assertTrue(np.isfinite(features).all())


if __name__ == "__main__":
    unittest.main()

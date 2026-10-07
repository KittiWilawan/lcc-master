import unittest
import numpy as np

from runtime_augmentation import augment_window, balanced_clip_weights, difficulty_multipliers


class RuntimeAugmentationTest(unittest.TestCase):
    def setUp(self):
        self.model = {"landmarkCount": 2}
        self.observed = np.array([[.2,.3,.1,-.2,-.3,.2,.9,.7,.4,.5,.2,.3,1,1],
                                  [.2,.4,.1,-.2,-.4,.2,.8,.6,.4,.6,.2,.4,1,1]], dtype=np.float32)

    def test_mirror_preserves_vertical_motion_and_swaps_sides(self):
        original = self.observed.copy()
        spec = {"mirror": True, "landmarkPermutation": [1,0]}
        actual = augment_window(self.observed, self.model, spec, np.random.default_rng(3), np)
        self.assertAlmostEqual(float(actual[1,9] - actual[0,9]), .1)
        self.assertEqual(actual[0,6], self.observed[0,7])
        restored = augment_window(actual, self.model, spec, np.random.default_rng(3), np)
        np.testing.assert_allclose(restored, self.observed, atol=1e-7)
        np.testing.assert_array_equal(self.observed, original)

    def test_camera_zoom_changes_geometry_and_preserves_normalized_skeleton(self):
        spec = {"scaleRange": [1.2,1.2], "translationRange": 0, "anchor": [.5,.5]}
        actual = augment_window(self.observed, self.model, spec, np.random.default_rng(3), np)
        np.testing.assert_array_equal(actual[:,:8], self.observed[:,:8])
        np.testing.assert_allclose(actual[:,10:12], self.observed[:,10:12] * 1.2)
        self.assertAlmostEqual(float(actual[1,9] - actual[0,9]), .12)

    def test_video_duration_does_not_increase_source_weight(self):
        weights = balanced_clip_weights(['a','a','b','c'], ['x','x','x','y'], {'x':1,'y':1}, np)
        self.assertAlmostEqual(weights[0] + weights[1], weights[2])
        self.assertAlmostEqual(sum(weights[:3]), weights[3])

    def test_hard_examples_gain_weight_and_invalid_scores_are_rejected(self):
        spec = {"normalWeight":1, "negativeFactor":2, "positiveFactor":1, "power":1}
        result = difficulty_multipliers([0,0,1,1], [.05,.9,.1,.9], spec, np)
        self.assertGreater(result[1], result[0])
        self.assertGreater(result[2], result[3])
        with self.assertRaises(ValueError):
            difficulty_multipliers([0], [float('nan')], spec, np)


if __name__ == '__main__':
    unittest.main()

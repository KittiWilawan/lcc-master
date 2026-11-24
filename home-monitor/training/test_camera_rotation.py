import unittest
import numpy as np
from runtime_augmentation import augment_window


class CameraRotationTest(unittest.TestCase):
    def setUp(self):
        self.model = {"landmarkCount": 4, "normalizationMinScale": 0.05, "visibilityThreshold": 0.35}
        coords = np.asarray([[-0.5,-0.5,0.1],[0.5,-0.5,0.1],[0.5,0.5,0.1],[-0.5,0.5,0.1]], dtype=np.float32)
        self.frame = np.concatenate((coords.reshape(-1), np.ones(4), np.asarray([0.5,0.5,1,1,1,1]))).astype(np.float32)
    def test_right_angle_preserves_identity_visibility_and_camera_center(self):
        value = augment_window([self.frame], self.model, {"rotationRangeDegrees":[90,90],"anchor":[0.5,0.5]}, np.random.default_rng(1), np)[0]
        np.testing.assert_allclose(value[:3], [0.5,-0.5,0.1], atol=0.00001)
        np.testing.assert_allclose(value[12:], self.frame[12:], atol=0.00001)
    def test_camera_transform_is_shared_by_the_entire_window_and_does_not_mutate_source(self):
        original = np.stack([self.frame]*3); before = original.copy()
        value = augment_window(original, self.model, {"rotationRangeDegrees":[-20,20],"anchor":[0.5,0.5]}, np.random.default_rng(2), np)
        np.testing.assert_array_equal(original, before)
        np.testing.assert_array_equal(value[0], value[1]); np.testing.assert_array_equal(value[1], value[2])
    def test_invalid_rotation_range_rejected(self):
        with self.assertRaises(ValueError):
            augment_window([self.frame], self.model, {"rotationRangeDegrees":[30,-30],"anchor":[0.5,0.5]}, np.random.default_rng(3), np)


if __name__ == '__main__': unittest.main()

import unittest
from types import SimpleNamespace
from extract_mobile_training import is_observed_pose, extraction_fingerprint


class PoseEligibilityTest(unittest.TestCase):
    def setUp(self):
        self.model = {"landmarkCount": 3, "visibilityThreshold": .35}
        self.points = [SimpleNamespace(x=.2+i*.2, y=.1+i*.3, z=0., visibility=.8) for i in range(3)]

    def test_visible_person_and_partial_occlusion_are_retained(self):
        self.assertTrue(is_observed_pose(self.points, self.model))
        self.points[-1].visibility = .1
        self.assertTrue(is_observed_pose(self.points, self.model))

    def test_no_visible_joints_cannot_become_a_person(self):
        for p in self.points: p.visibility = .1
        self.assertFalse(is_observed_pose(self.points, self.model))

    def test_entirely_outside_picture_is_not_observed(self):
        for p in self.points: p.x += 1
        self.assertFalse(is_observed_pose(self.points, self.model))

    def test_partly_outside_picture_still_has_an_observed_area(self):
        self.points[0].x = -.1
        self.assertTrue(is_observed_pose(self.points, self.model))

    def test_nonfinite_and_out_of_range_confidence_are_rejected(self):
        for value in [-.1, 1.1, float('nan')]:
            self.points[0].visibility = value
            self.assertFalse(is_observed_pose(self.points, self.model))

    def test_invalid_profile_is_not_a_negative_observation(self):
        with self.assertRaises(ValueError): is_observed_pose(self.points, {**self.model, "visibilityThreshold": float('nan')})

    def test_checkpoint_cannot_mix_observation_code_or_library_versions(self):
        def fingerprint(code, version):
            return extraction_fingerprint({}, {}, self.model, [], "model-hash", code, {"mediapipe": version})
        self.assertNotEqual(fingerprint("old-eligibility", "one"), fingerprint("new-eligibility", "one"))
        self.assertNotEqual(fingerprint("same-code", "one"), fingerprint("same-code", "two"))


if __name__ == '__main__': unittest.main()

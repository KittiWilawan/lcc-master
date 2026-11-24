import unittest
from person_support import overlap_fraction, pose_bounds, support


class PersonSupportTest(unittest.TestCase):
    def test_missing_detector_result_is_unknown_instead_of_erasing_an_occluded_person(self):
        self.assertEqual("unknown", support([.2, .2, .8, .8], [], .5, .1))
        self.assertEqual("unknown", support(None, [{"bounds": [0, 0, 1, 1], "confidence": .9}], .5, .1))

    def test_small_partial_pose_can_be_supported_by_a_full_body_detection(self):
        self.assertEqual("supported", support([.2, .4, .3, .5], [{"bounds": [.1, .1, .6, .9], "confidence": .8}], .5, .2))
        self.assertAlmostEqual(1, overlap_fraction([.2, .4, .3, .5], [.1, .1, .6, .9]))

    def test_furniture_pose_is_contradicted_by_a_person_elsewhere(self):
        self.assertEqual("contradicted", support([.0, .7, .2, .9], [{"bounds": [.4, .1, .5, .6], "confidence": .8}], .5, .1))

    def test_invalid_or_unconfident_detection_is_not_negative_person_evidence(self):
        self.assertEqual("unknown", support([.2, .2, .8, .8], [{"bounds": [.9, .1, .2, .8], "confidence": .9},
            {"bounds": [.4, .1, .5, .6], "confidence": .3}], .5, .1))

    def test_invalid_pose_cannot_produce_a_box(self):
        model = {"landmarkCount": 1, "normalizationMinScale": .05, "visibilityThreshold": .5}
        self.assertIsNone(pose_bounds([float('nan')]*10, model))
        self.assertIsNone(pose_bounds([0]*10, model))


if __name__ == '__main__': unittest.main()

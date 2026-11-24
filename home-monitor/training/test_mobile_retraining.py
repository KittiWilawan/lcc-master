import unittest
import numpy as np

from extract_mobile_training import validate_partitions
from retrain_mobile_classifier import score_batched, choose_validation_threshold, unique_videos
from train_runtime_classifier import score_records


class MobileRetrainingTest(unittest.TestCase):
    def test_identical_files_with_different_paths_count_only_once(self):
        records = [{"sha256": "same-video", "case": {"video_path": path}} for path in ["one.mp4", "copy.mp4"]]
        unique, duplicates = unique_videos(records)
        self.assertEqual(unique, records[:1])
        self.assertEqual(duplicates, [records[1]["case"]])

    def test_models_with_different_feature_profiles_are_scored_separately(self):
        class Classifier:
            def __init__(self, count): self.count = count
            def predict_proba(self, matrix):
                self_count = matrix.shape[1]
                if self_count != self.count: raise ValueError("Wrong model feature profile")
                return np.tile([.3, .7], (len(matrix), 1))
        runtime = {"maxPoseGapMs": 900, "maxWindowAgeMs": 1200, "minTrackFrames": 2, "initialWindowPolicy": "repeat_initial"}
        metadata = {"framesPerWindow": 3, "landmarkCount": 1, "featureVariant": "temporal"}
        records = [{"frames": [[.1]*9+[1.]]*3, "timestampsMs": [0, 300, 600]}]
        first = score_batched(Classifier(90), records, runtime, metadata, 2, np)
        second = score_batched(Classifier(36), records, runtime, {**metadata, "featureVariant": "invariant_temporal"}, 2, np)
        self.assertEqual(first, second)

    def choice(self, threshold, fn, fp, recall, specificity):
        metrics = {"fn": fn, "fp": fp, "recall": recall, "specificity": specificity, "f1": recall}
        return {"threshold": threshold, "metrics": {"combined": metrics, "dataset": metrics}}

    def test_threshold_prefers_preserving_both_missed_falls_and_false_alerts(self):
        unsafe = self.choice(.8, 36, 4, .83, .98)
        safe = self.choice(.45, 26, 7, .875, .96)
        self.assertIs(safe, choose_validation_threshold([unsafe, safe], {"fn": 26, "fp": 7}))

    def test_a_candidate_is_still_reported_when_no_threshold_passes(self):
        weak = self.choice(.3, 30, 10, .85, .95)
        stronger = self.choice(.4, 28, 8, .86, .96)
        self.assertIs(stronger, choose_validation_threshold([weak, stronger], {"fn": 26, "fp": 7}))

    def test_participant_and_video_partition_leakage_are_rejected(self):
        train = {"case": {"dataset": "test", "subject_id": "one", "split": "train", "label": "normal"}, "sha256": "first"}
        participant_leak = {"case": {**train["case"], "split": "test"}, "sha256": "second"}
        video_leak = {"case": {**train["case"], "subject_id": "two", "split": "test"}, "sha256": "first"}
        validate_partitions([train])
        for row in [participant_leak, video_leak]:
            with self.assertRaises(ValueError): validate_partitions([train, row])

    def test_batched_scores_keep_clip_boundaries_empty_clips_and_time_gaps(self):
        class Classifier:
            def predict_proba(self, features):
                probability = 1/(1+np.exp(-np.mean(features, axis=1)))
                return np.column_stack((1-probability, probability))
        runtime = {"maxPoseGapMs": 900, "maxWindowAgeMs": 1200, "minTrackFrames": 2, "initialWindowPolicy": "repeat_initial"}
        metadata = {"framesPerWindow": 3, "landmarkCount": 1, "featureVariant": "temporal"}
        frame = [0.1]*9+[1.0]
        records = [{"frames": [frame]*5, "timestampsMs": [0, 300, 600, 2400, 2700]},
            {"frames": [], "timestampsMs": []}, {"frames": [frame]*2, "timestampsMs": [0, 300]}]
        expected = score_records(Classifier(), records, runtime, metadata, np)
        actual = score_batched(Classifier(), records, runtime, metadata, 2, np)
        self.assertEqual(actual, expected)


if __name__ == "__main__": unittest.main()

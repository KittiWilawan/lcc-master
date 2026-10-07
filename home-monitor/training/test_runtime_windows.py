import unittest

from extract_runtime_sequences import read_rows
from train_runtime_classifier import clip_metrics, windows


class RuntimeWindowsTest(unittest.TestCase):
    runtime = {"maxPoseGapMs": 1200, "maxWindowAgeMs": 1800, "minTrackFrames": 3,
        "initialWindowPolicy": "repeat_initial", "confirmations": 2, "confirmationMaxGapMs": 900}
    model = {"framesPerWindow": 4}

    def record(self, times, present, label="normal"):
        return {"timestampsMs": times, "frames": [[float(value)] for value in present], "case": {"label": label}}

    def test_missing_pose_does_not_supply_an_observation(self):
        record = self.record([0, 300, 600, 900, 1200], [1, 1, 0, 1, 1])
        observed = list(windows(record, self.runtime, self.model))
        self.assertEqual([900, 1200], [timestamp for timestamp, _ in observed])
        self.assertTrue(all(len(frame_window) == 4 for _, frame_window in observed))

    def test_long_gap_resets_the_model_window(self):
        record = self.record([0, 300, 600, 2100, 2400], [1, 1, 1, 1, 1])
        self.assertEqual([600], [timestamp for timestamp, _ in windows(record, self.runtime, self.model)])

    def test_one_high_frame_or_expired_pair_is_not_a_fall(self):
        record = self.record([], [], "fall")
        for scored in ([[(600, .99)]], [[(600, .99), (1800, .99)]], [[(600, .99), (900, .01), (1200, .99)]]):
            self.assertEqual(1, clip_metrics([record], scored, .56, self.runtime)["fn"])

    def test_normal_clip_with_two_fresh_highs_counts_as_false_alert(self):
        record = self.record([], [])
        self.assertEqual(1, clip_metrics([record], [[(600, .99), (1200, .99)]], .56, self.runtime)["fp"])


if __name__ == "__main__":
    unittest.main()

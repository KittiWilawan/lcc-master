import sys
import unittest
from pathlib import Path


TRAINING_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(TRAINING_ROOT))

from build_databrary_ltc_manifest import assign_participants


class DatabraryManifestTests(unittest.TestCase):
    def test_participants_never_cross_splits(self):
        records = [
            {"participant_id": "one"},
            {"participant_id": "one"},
            {"participant_id": "two"},
            {"participant_id": "three"},
            {"participant_id": "four"},
        ]
        assignments = assign_participants(records)
        self.assertEqual(set(assignments), {"one", "two", "three", "four"})
        self.assertEqual(len(assignments), 4)


if __name__ == "__main__":
    unittest.main()

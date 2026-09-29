import tempfile
import unittest
from pathlib import Path

from build_gmdcsa_manifest import build_rows, split_for_subject, subject_id_from_path


class GmdcsaManifestTests(unittest.TestCase):
    def test_subject_and_split_are_derived_without_mixing_people(self):
        path = Path("archive") / "Subject 3" / "Fall" / "01.mp4"
        self.assertEqual(subject_id_from_path(path), 3)
        self.assertEqual(split_for_subject(1, 3, 4), "train")
        self.assertEqual(split_for_subject(3, 3, 4), "validation")
        self.assertEqual(split_for_subject(4, 3, 4), "test")

    def test_manifest_reads_fall_and_adl_labels(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for label in ("Fall", "ADL"):
                video = root / "Subject 1" / label / "01.mp4"
                video.parent.mkdir(parents=True, exist_ok=True)
                video.touch()
            rows = build_rows(root, validation_subject=3, test_subject=4)
            self.assertEqual({row["label"] for row in rows}, {"fall", "normal"})
            self.assertTrue(all(row["split"] == "train" for row in rows))


if __name__ == "__main__":
    unittest.main()

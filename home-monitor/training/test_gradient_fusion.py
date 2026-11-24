from pathlib import Path
import struct
import tempfile
import unittest
import numpy as np

from binary_forest import BinaryForest
from gradient_fusion import GradientFusion, merge_forests, sigmoid


class GradientFusionTest(unittest.TestCase):
    def forest(self, path, baseline, leaves):
        with path.open('wb') as stream:
            stream.write(struct.pack('>iiidi', 2, 1, 1, baseline, 3))
            for node in [(1, 2, 0, .5, 0), (-1, -1, 0, 0, leaves[0]), (-1, -1, 0, 0, leaves[1])]:
                stream.write(struct.pack('>iiidd', *node))

    def test_export_matches_weighted_margins_including_biases(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory);a=root/'a.bin';b=root/'b.bin';combined=root/'combined.bin'
            self.forest(a, .4, [-2, 2]);self.forest(b, -.2, [1, -3])
            inputs=np.asarray([[0], [.5], [.6]], dtype=np.float32)
            models=[(BinaryForest(a,np),.9),(BinaryForest(b,np),.1)]
            merge_forests([(a,.9),(b,.1)],combined,np)
            np.testing.assert_allclose(BinaryForest(combined,np).predict_proba(inputs),GradientFusion(models,np).predict_proba(inputs),atol=1e-12,rtol=0)

    def test_zero_weight_keeps_original_predictions(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);a=root/'a.bin';out=root/'out.bin';self.forest(a, .1, [-2,3])
            merge_forests([(a,1),(root/'absent.bin',0)],out,np)
            np.testing.assert_array_equal(BinaryForest(a,np).predict_proba([[0],[1]]),BinaryForest(out,np).predict_proba([[0],[1]]))

    def test_invalid_weights_and_extreme_margins(self):
        for weights in [[('none',-1),('other',2)],[('none',.5)],[]]:
            with self.assertRaises(ValueError):merge_forests(weights,'unused.bin',np)
        np.testing.assert_array_equal(sigmoid(np.asarray([-1000.,1000.]),np),[0,1])


if __name__=='__main__':unittest.main()

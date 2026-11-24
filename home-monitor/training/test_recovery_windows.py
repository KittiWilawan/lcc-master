import unittest
from recovery_windows import recovery_windows, confirmed
from train_runtime_classifier import windows


class RecoveryWindowTest(unittest.TestCase):
    def setUp(self):
        self.runtime={"maxPoseGapMs":900,"maxWindowAgeMs":1200,"minTrackFrames":2,"initialWindowPolicy":"repeat_initial",
            "confirmationMaxGapMs":900,"confirmations":2}
        self.model={"framesPerWindow":3};self.valid=[.2,1.];self.missing=[0.,0.]

    def test_tagging_keeps_the_same_features_and_times(self):
        record={"frames":[self.valid,self.valid,self.missing,self.valid,self.valid],"timestampsMs":[0,300,600,1800,2100],
            "recovery":{"positionsMs":[300]}}
        tagged=list(recovery_windows(record,self.runtime,self.model))
        self.assertEqual([(t,frame) for t,frame,_ in tagged],list(windows(record,self.runtime,self.model)))
        self.assertEqual([True,False],[recovery for _,_,recovery in tagged])

    def test_recovered_flag_expires_after_its_window(self):
        record={"frames":[self.valid]*5,"timestampsMs":[0,300,600,900,1200],"recovery":{"positionsMs":[0]}}
        self.assertEqual([True,True,False,False],[flag for _,_,flag in recovery_windows(record,self.runtime,self.model)])

    def test_missing_samples_cannot_confirm_and_gaps_expire_evidence(self):
        self.assertIsNone(confirmed([], .8,self.runtime))
        self.assertIsNone(confirmed([(300,.9),(1500,.9)],.8,self.runtime))
        self.assertEqual(600,confirmed([(300,.9),(600,.9)],.8,self.runtime))


if __name__=='__main__':unittest.main()

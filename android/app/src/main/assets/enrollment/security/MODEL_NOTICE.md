# Face reference enrollment models

These models run on-device for reference enrollment. Outputs are probabilistic and do not verify a legal identity, identify a named person from CCTV, or guarantee protection against replay, deepfake, camera injection or 3D masks.

## SFace

- Publisher: OpenCV Zoo / Shenzhen Institute of Artificial Intelligence and Robotics for Society.
- Upstream commit: 47534e27c9851bb1128ccc0102f1145e27f23f98.
- Original file: models/face_recognition_sface/face_recognition_sface_2021dec.onnx.
- SHA-256: 0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79.
- Source: https://github.com/opencv/opencv_zoo/tree/47534e27c9851bb1128ccc0102f1145e27f23f98/models/face_recognition_sface
- Upstream directory license: SFACE_LICENSE.txt (Apache 2.0). This records the distributed license; no additional training-data rights are asserted here.
- Input: five-point aligned 112x112 RGB, raw channel values 0..255, NCHW. Normalization is part of the original graph.
- Application threshold is configurable and provisional. The upstream LFW threshold does not establish accuracy for this application's users, cameras, poses or landmark adapter.

## MiniFASNetV2 and MiniFASNetV1SE

- Publisher: Minivision Technology.
- Upstream commit: b6d5f04ad78778917853b25c778acef6d5626d15.
- Source: https://github.com/minivision-ai/Silent-Face-Anti-Spoofing/tree/b6d5f04ad78778917853b25c778acef6d5626d15
- License: MINIFAS_LICENSE.txt (Apache 2.0).
- Original weights: resources/anti_spoof_models/2.7_80x80_MiniFASNetV2.pth and 4_0_0_80x80_MiniFASNetV1SE.pth.
- Converted from the original weights, without retraining, using scripts/export_face_security.py (ONNX opset 13).
- Input: 80x80 BGR multi-scale crop, raw channel values 0..255, NCHW. The upstream numpy transform does not divide by 255.
- Output: logits; softmax class 1 probabilities are averaged across both models. Scores are not exposed as percentages of identity confidence to users.
- Use is restricted to frontal frames by this application. Camera and scene changes may cause false accepts or false rejects. A pre-recorded video or a synthetic camera stream may bypass RGB checks; no PAD certification is claimed.

All model assets and hashes are configured in src/config/faceScan.json. Ephemeral face vectors remain in the native process and are cleared on reset/close; reference JPEGs use the existing consent and storage workflow. Manual/gallery references do not acquire biometric verification status.

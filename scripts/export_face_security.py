"""Export pinned MiniFASNet weights without retraining; verify CPU inference parity."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import numpy as np
import onnx
import onnxruntime as ort
import torch


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--assets", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    torch.set_num_threads(1)
    spec = importlib.util.spec_from_file_location("minifas", args.source / "MiniFASNet.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    rows = []
    for filename, factory, target in [
        ("2.7_80x80_MiniFASNetV2.pth", module.MiniFASNetV2, "minifas-v2.onnx"),
        ("4_0_0_80x80_MiniFASNetV1SE.pth", module.MiniFASNetV1SE, "minifas-v1se.onnx"),
    ]:
        weights = torch.load(args.source / filename, map_location="cpu", weights_only=True)
        weights = {key.removeprefix("module."): value for key, value in weights.items()}
        network = factory(conv6_kernel=(5, 5)).eval()
        network.load_state_dict(weights, strict=True)
        output = args.assets / target
        tensor = torch.zeros(1, 3, 80, 80)
        torch.onnx.export(network, tensor, output, input_names=["input"], output_names=["logits"],
                          opset_version=13, dynamo=False)
        onnx.checker.check_model(onnx.load(output))
        options = ort.SessionOptions()
        options.intra_op_num_threads = 1
        runtime = ort.InferenceSession(str(output), options, providers=["CPUExecutionProvider"])
        rng = np.random.default_rng(42)
        errors = []
        for image in [np.zeros((1, 3, 80, 80), np.float32), np.full((1, 3, 80, 80), 255, np.float32),
                      rng.uniform(0, 255, (1, 3, 80, 80)).astype(np.float32)]:
            with torch.inference_mode():
                expected = network(torch.from_numpy(image)).numpy()
            actual = runtime.run(None, {"input": image})[0]
            error = float(np.max(np.abs(expected - actual)))
            assert np.allclose(expected, actual, atol=0.001, rtol=0.001), (target, error)
            errors.append(error)
        rows.append({"model": target, "source": filename, "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
                     "sourceSha256": hashlib.sha256((args.source / filename).read_bytes()).hexdigest(),
                     "maxLogitError": max(errors), "parityInputs": len(errors)})
    sface = args.assets / "sface.onnx"
    onnx.checker.check_model(onnx.load(sface))
    rows.append({"model": sface.name, "sha256": hashlib.sha256(sface.read_bytes()).hexdigest()})
    args.report.write_text(json.dumps(rows, indent=2), encoding="utf-8")
    print(json.dumps(rows, indent=2))


if __name__ == "__main__":
    main()

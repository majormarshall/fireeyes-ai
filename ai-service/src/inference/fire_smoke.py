"""
Model A: Fire & Smoke detection.

You don't have a trained model or dataset yet, so this class runs in
"stub mode" until weights are dropped in at ai-service/models/fire_smoke.pt.
Everything downstream (Node backend, WebSocket broadcast, alert pipeline,
dashboard) is already wired to consume whatever this returns, so training
the model later is a drop-in — no other code changes needed.

Getting a real model, in order of speed to a working v1:
  1. Fastest: fine-tune YOLOv11 on a public fire/smoke dataset
     (e.g. "D-Fire", "FASDD", or Roboflow Universe fire/smoke datasets)
     to get a usable v1 without collecting your own footage.
  2. Better: mix in real footage from your own ESP32-CAM feeds once
     the cameras are live, especially false-positive cases (sunsets,
     fog, dust, steam) since those are what trip up fire models most.
  3. Export the trained .pt to ONNX if you want faster CPU inference
     on the edge box (ONNX Runtime is already in the Phase-1 stack).
"""

from pathlib import Path
import time

MODEL_PATH = Path(__file__).resolve().parents[2] / "models" / "fire_smoke.pt"
MODEL_VERSION = "stub-0.0.0"


class FireSmokeDetector:
    def __init__(self):
        self.model = None
        self.model_version = MODEL_VERSION

        if MODEL_PATH.exists():
            self._load_model()
        else:
            print(
                f"[fire_smoke] No weights found at {MODEL_PATH} — "
                "running in STUB MODE (returns zero detections). "
                "Train/drop in a YOLOv11 model to activate real detection."
            )

    def _load_model(self):
        from ultralytics import YOLO  # imported lazily so stub mode has no heavy deps

        self.model = YOLO(str(MODEL_PATH))
        self.model_version = MODEL_PATH.stem
        print(f"[fire_smoke] Loaded model from {MODEL_PATH}")

    def is_ready(self) -> bool:
        return self.model is not None

    def predict(self, image_bytes: bytes) -> dict:
        if self.model is None:
            # Stub mode: no model yet, so no detections. Backend and dashboard
            # keep working end-to-end; they just never see a fire/smoke alert.
            return {"model_version": self.model_version, "detections": []}

        import numpy as np
        import cv2

        arr = np.frombuffer(image_bytes, dtype=np.uint8)
        frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if frame is None:
            return {"model_version": self.model_version, "detections": []}

        t0 = time.time()
        results = self.model.predict(frame, verbose=False)[0]
        infer_ms = (time.time() - t0) * 1000

        detections = []
        for box in results.boxes:
            label = self.model.names[int(box.cls[0])]
            confidence = float(box.conf[0])
            x1, y1, x2, y2 = box.xyxyn[0].tolist()  # normalized coords
            detections.append(
                {
                    "label": label,
                    "confidence": round(confidence, 4),
                    "bbox": {"x": x1, "y": y1, "w": x2 - x1, "h": y2 - y1},
                }
            )

        return {
            "model_version": self.model_version,
            "detections": detections,
            "inference_ms": round(infer_ms, 1),
        }

"""
Model D: Farm Security AI — human, animal, and vehicle detection.

Same stub-mode pattern as Model A (fire_smoke.py). A general-purpose
pretrained YOLOv11 (COCO weights) already recognizes 'person', several
animal classes, and 'car'/'truck' out of the box — so unlike fire/smoke or
tomato disease, this module doesn't strictly need a custom-trained model to
get a rough v1 working. Fine-tuning becomes worthwhile later mainly to:
  - Distinguish livestock/wildlife you actually care about (e.g. "cattle
    that got out" vs "a bird landed in frame") from COCO's generic classes
  - Reduce false positives specific to farm scenes (scarecrows, tarps
    flapping in wind, farm equipment silhouettes at dusk)

Until weights are dropped in at models/farm_security.pt, this returns zero
detections just like the other stub modules, so the pipeline is fully
testable end-to-end without a model.
"""

from pathlib import Path
import time

MODEL_PATH = Path(__file__).resolve().parents[2] / "models" / "farm_security.pt"
MODEL_VERSION = "stub-0.0.0"

# What we actually care about from a general COCO-pretrained model, once
# one is loaded — everything else COCO detects (chairs, laptops, etc.) is
# irrelevant on a farm camera and filtered out.
RELEVANT_LABELS = {
    "person": "human",
    "car": "vehicle",
    "truck": "vehicle",
    "motorcycle": "vehicle",
    "bicycle": "vehicle",
    "dog": "animal",
    "cat": "animal",
    "horse": "animal",
    "sheep": "animal",
    "cow": "animal",
    "bird": "animal",
}


class FarmSecurityDetector:
    def __init__(self):
        self.model = None
        self.model_version = MODEL_VERSION

        if MODEL_PATH.exists():
            self._load_model()
        else:
            print(
                f"[farm_security] No weights found at {MODEL_PATH} — "
                "running in STUB MODE (returns zero detections). "
                "A pretrained COCO YOLOv11 checkpoint (e.g. yolo11n.pt) "
                "already covers person/vehicle/animal reasonably — drop "
                "one in to get a rough v1 without training anything."
            )

    def _load_model(self):
        from ultralytics import YOLO

        self.model = YOLO(str(MODEL_PATH))
        self.model_version = MODEL_PATH.stem
        print(f"[farm_security] Loaded model from {MODEL_PATH}")

    def is_ready(self) -> bool:
        return self.model is not None

    def predict(self, image_bytes: bytes) -> dict:
        if self.model is None:
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
            raw_label = self.model.names[int(box.cls[0])]
            category = RELEVANT_LABELS.get(raw_label)
            if category is None:
                continue  # not farm-relevant, skip

            confidence = float(box.conf[0])
            x1, y1, x2, y2 = box.xyxyn[0].tolist()
            detections.append(
                {
                    "label": category,
                    "raw_label": raw_label,
                    "confidence": round(confidence, 4),
                    "bbox": {"x": x1, "y": y1, "w": x2 - x1, "h": y2 - y1},
                }
            )

        return {"model_version": self.model_version, "detections": detections, "inference_ms": round(infer_ms, 1)}

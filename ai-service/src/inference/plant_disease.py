"""
Model C: Plant Disease AI — tomato, initially.

Classic image classification (not detection): one label per leaf/plant
crop, from the 9-class set in the project spec. A YOLOv11-cls checkpoint
fine-tuned on a labeled tomato leaf dataset (e.g. PlantVillage, which
already has all 9 of these classes) is the fastest path to v1.

Stub mode until weights land at models/tomato_disease.pt — see
fire_smoke.py for why this pattern is used consistently across modules.
"""

from pathlib import Path

MODEL_PATH = Path(__file__).resolve().parents[2] / "models" / "tomato_disease.pt"
MODEL_VERSION = "stub-0.0.0"

CLASSES = [
    "healthy",
    "early_blight",
    "late_blight",
    "leaf_mold",
    "septoria_leaf_spot",
    "bacterial_spot",
    "mosaic_virus",
    "yellow_leaf_curl_virus",
    "spider_mites",
]


class TomatoDiseaseClassifier:
    def __init__(self):
        self.model = None
        self.model_version = MODEL_VERSION

        if MODEL_PATH.exists():
            self._load_model()
        else:
            print(
                f"[tomato_disease] No weights found at {MODEL_PATH} — "
                "running in STUB MODE (returns no classification)."
            )

    def _load_model(self):
        from ultralytics import YOLO

        self.model = YOLO(str(MODEL_PATH))  # classification checkpoint (yolo11n-cls etc.)
        self.model_version = MODEL_PATH.stem
        print(f"[tomato_disease] Loaded model from {MODEL_PATH}")

    def is_ready(self) -> bool:
        return self.model is not None

    def classify(self, image_bytes: bytes) -> dict:
        if self.model is None:
            return {"model_version": self.model_version, "label": None, "confidence": None}

        import numpy as np
        import cv2

        arr = np.frombuffer(image_bytes, dtype=np.uint8)
        frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if frame is None:
            return {"model_version": self.model_version, "label": None, "confidence": None}

        results = self.model.predict(frame, verbose=False)[0]
        top1_idx = int(results.probs.top1)
        confidence = float(results.probs.top1conf)
        label = self.model.names.get(top1_idx, CLASSES[top1_idx] if top1_idx < len(CLASSES) else "unknown")

        return {
            "model_version": self.model_version,
            "label": label,
            "confidence": round(confidence, 4),
        }

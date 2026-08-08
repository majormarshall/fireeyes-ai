"""
Model B: Crop Growth AI.

Same stub-mode pattern as Model A (fire_smoke.py) — no dataset/model yet,
so this returns None fields until weights land at models/crop_growth.pt.
Downstream code (backend, dashboard) already handles null growth data
gracefully, so activating this later is a drop-in.

This one differs from a plain YOLO detector: growth analysis needs more
than bounding boxes — plant height, leaf count, canopy coverage, and growth
stage are usually a mix of a detection/segmentation model (leaf/plant
instance segmentation) plus geometric post-processing (pixel-to-cm scale
from a known camera distance or a reference marker in frame). Recommended
approach once you have footage:
  1. Train a YOLOv11-seg (segmentation) model to mask individual leaves
     and the whole plant silhouette.
  2. Leaf count = number of leaf mask instances.
  3. Canopy coverage % = (plant mask area) / (frame area), calibrated
     once per camera against a known reference (e.g. a marked stake).
  4. Plant height = mask bounding box height converted via the same
     pixel-to-cm calibration.
  5. Growth stage = a small classifier on top of the same crops, or
     simple rules on leaf count + canopy coverage thresholds to start.
"""

from pathlib import Path

MODEL_PATH = Path(__file__).resolve().parents[2] / "models" / "crop_growth.pt"
MODEL_VERSION = "stub-0.0.0"


class CropGrowthAnalyzer:
    def __init__(self):
        self.model = None
        self.model_version = MODEL_VERSION

        if MODEL_PATH.exists():
            self._load_model()
        else:
            print(
                f"[crop_growth] No weights found at {MODEL_PATH} — "
                "running in STUB MODE (returns null growth data)."
            )

    def _load_model(self):
        from ultralytics import YOLO

        self.model = YOLO(str(MODEL_PATH))
        self.model_version = MODEL_PATH.stem
        print(f"[crop_growth] Loaded model from {MODEL_PATH}")

    def is_ready(self) -> bool:
        return self.model is not None

    def analyze(self, image_bytes: bytes) -> dict:
        if self.model is None:
            return {
                "model_version": self.model_version,
                "plant_height_cm": None,
                "leaf_count": None,
                "growth_stage": None,
                "canopy_coverage_pct": None,
                "estimated_harvest_date": None,
            }

        # TODO: real segmentation + geometry pipeline once trained (see
        # module docstring). Left as a clear seam rather than guessed logic.
        raise NotImplementedError(
            "crop_growth.pt found but analyze() geometry pipeline isn't implemented yet"
        )

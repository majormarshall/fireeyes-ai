"""
FireEyes AI — Model A training script (Fire & Smoke)

Fine-tunes a pretrained YOLOv11 checkpoint on your fire/smoke dataset.
See DATASET.md for how to get/prepare the dataset first.

Usage:
    python train.py                    # sensible defaults
    python train.py --epochs 150 --model yolo11s.pt

Output weights land in runs/detect/train/weights/best.pt — copy that to
../models/fire_smoke.pt to activate it in the inference service.
"""

import argparse
import shutil
from pathlib import Path

from ultralytics import YOLO

THIS_DIR = Path(__file__).resolve().parent
MODEL_DEST = THIS_DIR.parent / "models" / "fire_smoke.pt"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", default=str(THIS_DIR / "fire_smoke.yaml"))
    # yolo11n = fastest/smallest, good for edge deployment.
    # yolo11s = better accuracy, still edge-friendly. Step up if you have GPU headroom.
    parser.add_argument("--model", default="yolo11n.pt")
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument(
        "--deploy",
        action="store_true",
        help="Copy best.pt straight to ai-service/models/fire_smoke.pt when training finishes",
    )
    args = parser.parse_args()

    model = YOLO(args.model)  # downloads pretrained COCO weights on first run

    results = model.train(
        data=args.data,
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        patience=20,   # early stop if val loss plateaus
        project="runs/detect",
        name="train",
    )

    best_weights = Path(results.save_dir) / "weights" / "best.pt"
    print(f"\nTraining done. Best weights: {best_weights}")

    if args.deploy:
        MODEL_DEST.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(best_weights, MODEL_DEST)
        print(f"Deployed to {MODEL_DEST} — restart ai-service to pick it up.")
    else:
        print(f"Run again with --deploy, or manually copy best.pt to {MODEL_DEST}")


if __name__ == "__main__":
    main()

# Sourcing a Fire/Smoke dataset (Model A)

You have no dataset yet, so start with a public one to get a usable v1 fast,
then improve it with your own farm footage once cameras are live.

## Recommended public datasets (in order to try)

1. **D-Fire** — ~21k images, fire + smoke, already bounding-box labeled in
   YOLO format. Best starting point since no relabeling is needed.
   https://github.com/gaiasd/DFireDataset

2. **FASDD (Fire And Smoke Detection Dataset)** — large, diverse scenes
   (forests, buildings, roads), good for reducing false positives.
   Search "FASDD fire smoke dataset" — hosted on ScienceDB / Kaggle mirrors.

3. **Roboflow Universe** — search "fire smoke detection" on
   https://universe.roboflow.com — many community datasets already exported
   in YOLOv8/v11 format, some pre-merged with D-Fire. Roboflow lets you
   export directly to the `images/` + `labels/` layout `fire_smoke.yaml`
   expects, which saves a conversion step.

## Steps

1. Download 1-2 of the above, merge into the layout described in
   `fire_smoke.yaml` (`datasets/fire_smoke/images/{train,val}`,
   `datasets/fire_smoke/labels/{train,val}`).
2. Keep classes to exactly `fire` (0) and `smoke` (1) — remap label files if
   a source dataset uses different class indices or extra classes.
3. Do a quick visual sanity check on ~20 random images (draw the boxes back
   on the image) before spending GPU time training on a bad label set.
4. Once cameras are live, periodically pull real false-positive frames
   (sunsets, fog, dust, steam, red/orange farm equipment) into `images/train`
   with empty label files — this is what actually kills false alarms in
   production, more than dataset size does.

## Training

Once the dataset is in place:

```bash
cd ai-service/training
pip install ultralytics
python train.py
```

This fine-tunes a pretrained YOLOv11 nano/small checkpoint rather than
training from scratch — much faster to a usable model, and small enough to
run inference on a modest edge PC.

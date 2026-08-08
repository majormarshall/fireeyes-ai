"""
FireEyes AI - Inference Service
=================================
Python microservice the Node backend calls for AI detection.

Phase 1 exposes one endpoint: /infer/fire-smoke (Model A).
Later phases add /infer/crop-growth, /infer/plant-disease, /infer/security
following the exact same pattern (separate focused model per module).
"""

from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import JSONResponse
import uvicorn

from src.inference.fire_smoke import FireSmokeDetector
from src.inference.crop_growth import CropGrowthAnalyzer
from src.inference.plant_disease import TomatoDiseaseClassifier
from src.inference.farm_security import FarmSecurityDetector

app = FastAPI(title="FireEyes AI - Inference Service")

# Loaded once at startup and reused across requests.
fire_smoke_detector = FireSmokeDetector()
crop_growth_analyzer = CropGrowthAnalyzer()
tomato_disease_classifier = TomatoDiseaseClassifier()
farm_security_detector = FarmSecurityDetector()


@app.get("/health")
def health():
    return {
        "ok": True,
        "models": {
            "fire_smoke": fire_smoke_detector.is_ready(),
            "crop_growth": crop_growth_analyzer.is_ready(),
            "tomato_disease": tomato_disease_classifier.is_ready(),
            "farm_security": farm_security_detector.is_ready(),
        },
    }


@app.post("/infer/fire-smoke")
async def infer_fire_smoke(camera_id: str = Form(...), image: UploadFile = File(...)):
    image_bytes = await image.read()
    result = fire_smoke_detector.predict(image_bytes)
    return JSONResponse(
        {
            "camera_id": camera_id,
            "model_version": result["model_version"],
            "detections": result["detections"],  # [{label, confidence, bbox}]
        }
    )


@app.post("/infer/crop-growth")
async def infer_crop_growth(camera_id: str = Form(...), image: UploadFile = File(...)):
    image_bytes = await image.read()
    result = crop_growth_analyzer.analyze(image_bytes)
    return JSONResponse({"camera_id": camera_id, **result})


@app.post("/infer/plant-disease")
async def infer_plant_disease(
    camera_id: str = Form(...), crop_type: str = Form("tomato"), image: UploadFile = File(...)
):
    image_bytes = await image.read()
    result = tomato_disease_classifier.classify(image_bytes)
    return JSONResponse({"camera_id": camera_id, "crop_type": crop_type, **result})


@app.post("/infer/farm-security")
async def infer_farm_security(camera_id: str = Form(...), image: UploadFile = File(...)):
    image_bytes = await image.read()
    result = farm_security_detector.predict(image_bytes)
    return JSONResponse(
        {
            "camera_id": camera_id,
            "model_version": result["model_version"],
            "detections": result["detections"],
        }
    )


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)

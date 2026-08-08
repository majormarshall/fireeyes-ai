const config = require('../config');

// Talks to the Python AI microservice (ai-service/). Kept as a thin client so
// swapping YOLO models or adding new modules (crop growth, disease, security)
// later just means adding another method here + another route in ai-service.
async function detectFireSmoke(cameraId, imageBuffer) {
  const url = `${config.aiServiceUrl}/infer/fire-smoke`;

  const form = new FormData();
  form.append('camera_id', cameraId);
  form.append('image', new Blob([imageBuffer], { type: 'image/jpeg' }), 'frame.jpg');

  const res = await fetch(url, { method: 'POST', body: form });
  if (!res.ok) {
    throw new Error(`AI service error ${res.status}: ${await res.text()}`);
  }
  return res.json(); // { detections: [{ label, confidence, bbox }], model_version }
}

async function analyzeCropGrowth(cameraId, imageBuffer) {
  const form = new FormData();
  form.append('camera_id', cameraId);
  form.append('image', new Blob([imageBuffer], { type: 'image/jpeg' }), 'frame.jpg');

  const res = await fetch(`${config.aiServiceUrl}/infer/crop-growth`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`AI service error ${res.status}: ${await res.text()}`);
  return res.json(); // { plant_height_cm, leaf_count, growth_stage, canopy_coverage_pct, estimated_harvest_date, model_version }
}

async function classifyDisease(cameraId, imageBuffer, cropType = 'tomato') {
  const form = new FormData();
  form.append('camera_id', cameraId);
  form.append('crop_type', cropType);
  form.append('image', new Blob([imageBuffer], { type: 'image/jpeg' }), 'frame.jpg');

  const res = await fetch(`${config.aiServiceUrl}/infer/plant-disease`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`AI service error ${res.status}: ${await res.text()}`);
  return res.json(); // { label, confidence, model_version }
}

async function detectFarmSecurity(cameraId, imageBuffer) {
  const form = new FormData();
  form.append('camera_id', cameraId);
  form.append('image', new Blob([imageBuffer], { type: 'image/jpeg' }), 'frame.jpg');

  const res = await fetch(`${config.aiServiceUrl}/infer/farm-security`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`AI service error ${res.status}: ${await res.text()}`);
  return res.json(); // { detections: [{ label, confidence, bbox }], model_version }
}

module.exports = { detectFireSmoke, analyzeCropGrowth, classifyDisease, detectFarmSecurity };

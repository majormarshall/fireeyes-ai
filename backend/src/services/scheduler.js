const config = require('../config');
const hub = require('../ws/hub');
const cameraModel = require('../models/cameraModel');
const cropModel = require('../models/cropModel');
const eventModel = require('../models/eventModel');
const sensorModel = require('../models/sensorModel');
const aiClient = require('./aiClient');
const notifier = require('./notifier');
const irrigationClient = require('./irrigationClient');
const streamController = require('../controllers/streamController');

// Phase 2 doesn't analyze every frame like fire/smoke does — growth and
// disease state change slowly, so we periodically grab whatever frame a
// camera most recently pushed and run it through Model B / Model C.
// Cameras that haven't sent a frame yet are silently skipped each tick.

let growthTimer = null;
let diseaseTimer = null;
let irrigationTimer = null;

async function runGrowthCheckForCamera(camera) {
  const frame = streamController.getLatestFrameBuffer(camera.id);
  if (!frame) return; // camera registered but hasn't streamed anything yet

  try {
    const result = await aiClient.analyzeCropGrowth(camera.id, frame);

    const obs = await cropModel.createGrowthObservation({
      farmId: camera.farm_id,
      cameraId: camera.id,
      cropType: config.cropGrowth.cropType,
      plantHeightCm: result.plant_height_cm,
      leafCount: result.leaf_count,
      growthStage: result.growth_stage,
      canopyCoveragePct: result.canopy_coverage_pct,
      estimatedHarvestDate: result.estimated_harvest_date,
      modelVersion: result.model_version,
    });

    hub.broadcast(camera.farm_id, 'growth_observation', obs);
  } catch (err) {
    console.error(`[scheduler] growth check failed for camera ${camera.id}:`, err.message);
  }
}

async function runDiseaseCheckForCamera(camera) {
  const frame = streamController.getLatestFrameBuffer(camera.id);
  if (!frame) return;

  try {
    const result = await aiClient.classifyDisease(camera.id, frame, config.diseaseCheck.cropType);
    if (!result.label) return; // stub mode, nothing to record yet

    const obs = await cropModel.createDiseaseObservation({
      farmId: camera.farm_id,
      cameraId: camera.id,
      cropType: config.diseaseCheck.cropType,
      label: result.label,
      confidence: result.confidence,
      modelVersion: result.model_version,
    });

    hub.broadcast(camera.farm_id, 'disease_observation', obs);

    // Non-healthy diagnosis above threshold raises an alert, same pattern
    // as fire/smoke but lower urgency (info/warning, not critical — a
    // disease reading doesn't need a sprinkler or an SMS at 2am).
    if (result.label !== 'healthy' && result.confidence >= config.diseaseCheck.alertConfidenceThreshold) {
      const alert = await eventModel.createAlert({
        farmId: camera.farm_id,
        module: 'plant_disease',
        severity: 'warning',
        message: `Possible ${result.label.replace(/_/g, ' ')} detected on camera ${camera.id} (${Math.round(result.confidence * 100)}% confidence)`,
        channel: 'dashboard',
      });
      hub.broadcast(camera.farm_id, 'alert', alert);
      notifier
        .sendCriticalAlert({ subject: `🍅 AgriEyes AI — possible ${result.label}`, message: alert.message })
        .catch((err) => console.error('[scheduler] disease notify error:', err.message));
    }
  } catch (err) {
    console.error(`[scheduler] disease check failed for camera ${camera.id}:`, err.message);
  }
}

async function tickGrowth() {
  const cameraIds = streamController.getAllCameraIds();
  for (const cameraId of cameraIds) {
    try {
      const cameras = await cameraModel.listByFarm('default'); // Phase 1-2: single farm
      const camera = cameras.find((c) => c.id === cameraId);
      if (camera) await runGrowthCheckForCamera(camera);
    } catch (err) {
      console.error('[scheduler] growth tick error:', err.message);
    }
  }
}

async function tickDisease() {
  const cameraIds = streamController.getAllCameraIds();
  for (const cameraId of cameraIds) {
    try {
      const cameras = await cameraModel.listByFarm('default');
      const camera = cameras.find((c) => c.id === cameraId);
      if (camera) await runDiseaseCheckForCamera(camera);
    } catch (err) {
      console.error('[scheduler] disease tick error:', err.message);
    }
  }
}

// Irrigation doesn't need a camera frame at all — it just compares the
// latest soil moisture reading per zone against that zone's configured
// threshold. One reading per zone per ESP32 soil sensor is enough; no
// per-camera looping like growth/disease need.
const FARM_ID = 'default'; // Phase 1-3: single farm

async function tickIrrigation() {
  try {
    const zones = await sensorModel.getIrrigationZones(FARM_ID);
    for (const zoneConfig of zones) {
      if (!zoneConfig.enabled) continue;

      const readings = await sensorModel.latestBySensorType(FARM_ID, 'soil_moisture', {
        zone: zoneConfig.zone,
        limit: 1,
      });
      if (readings.length === 0) continue; // no sensor data for this zone yet

      const latest = readings[0];
      if (latest.value >= zoneConfig.moisture_threshold_pct) continue; // moisture is fine

      const result = await irrigationClient.activate(FARM_ID, {
        zone: zoneConfig.zone,
        reason: 'low_soil_moisture',
        soilMoisturePct: latest.value,
        durationSeconds: zoneConfig.watering_duration_seconds,
      });

      if (result.activated) {
        hub.broadcast(FARM_ID, 'irrigation_event', {
          zone: zoneConfig.zone,
          soil_moisture_pct: latest.value,
          reason: 'low_soil_moisture',
        });
      }
    }
  } catch (err) {
    console.error('[scheduler] irrigation tick error:', err.message);
  }
}

function start() {
  const growthMs = config.cropGrowth.intervalMinutes * 60 * 1000;
  const diseaseMs = config.diseaseCheck.intervalMinutes * 60 * 1000;
  const irrigationMs = config.irrigation.checkIntervalMinutes * 60 * 1000;

  growthTimer = setInterval(tickGrowth, growthMs);
  diseaseTimer = setInterval(tickDisease, diseaseMs);
  irrigationTimer = setInterval(tickIrrigation, irrigationMs);

  console.log(
    `[scheduler] Crop growth checks every ${config.cropGrowth.intervalMinutes}min, ` +
    `disease checks every ${config.diseaseCheck.intervalMinutes}min, ` +
    `irrigation checks every ${config.irrigation.checkIntervalMinutes}min`
  );
}

function stop() {
  clearInterval(growthTimer);
  clearInterval(diseaseTimer);
  clearInterval(irrigationTimer);
}

module.exports = { start, stop, tickGrowth, tickDisease, tickIrrigation };

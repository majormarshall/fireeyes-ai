const db = require('../config/db');

async function createGrowthObservation({
  farmId, cameraId, cropType, plantHeightCm, leafCount, growthStage,
  canopyCoveragePct, estimatedHarvestDate, imagePath, modelVersion,
}) {
  const { rows } = await db.query(
    `INSERT INTO crop_growth_observations
      (farm_id, camera_id, crop_type, plant_height_cm, leaf_count, growth_stage,
       canopy_coverage_pct, estimated_harvest_date, image_path, model_version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [farmId, cameraId, cropType || 'tomato', plantHeightCm ?? null, leafCount ?? null,
      growthStage ?? null, canopyCoveragePct ?? null, estimatedHarvestDate ?? null,
      imagePath ?? null, modelVersion ?? null]
  );
  return rows[0];
}

async function recentGrowth(farmId, { cameraId, limit = 100 } = {}) {
  const params = [farmId];
  let where = 'farm_id = $1';
  if (cameraId) {
    params.push(cameraId);
    where += ` AND camera_id = $${params.length}`;
  }
  params.push(limit);
  const { rows } = await db.query(
    `SELECT * FROM crop_growth_observations WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
    params
  );
  return rows;
}

async function createDiseaseObservation({
  farmId, cameraId, cropType, label, confidence, imagePath, modelVersion,
}) {
  const { rows } = await db.query(
    `INSERT INTO disease_observations
      (farm_id, camera_id, crop_type, label, confidence, image_path, model_version)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [farmId, cameraId, cropType || 'tomato', label, confidence ?? null, imagePath ?? null, modelVersion ?? null]
  );
  return rows[0];
}

async function recentDisease(farmId, { cameraId, limit = 100 } = {}) {
  const params = [farmId];
  let where = 'farm_id = $1';
  if (cameraId) {
    params.push(cameraId);
    where += ` AND camera_id = $${params.length}`;
  }
  params.push(limit);
  const { rows } = await db.query(
    `SELECT * FROM disease_observations WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
    params
  );
  return rows;
}

module.exports = {
  createGrowthObservation, recentGrowth,
  createDiseaseObservation, recentDisease,
};

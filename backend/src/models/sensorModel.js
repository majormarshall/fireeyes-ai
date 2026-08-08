const db = require('../config/db');

async function recordReading({ farmId, sensorId, sensorType, value, unit, zone }) {
  const { rows } = await db.query(
    `INSERT INTO sensor_readings (farm_id, sensor_id, sensor_type, value, unit, zone)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [farmId, sensorId, sensorType, value, unit || null, zone || null]
  );
  return rows[0];
}

async function latestBySensorType(farmId, sensorType, { zone, limit = 50 } = {}) {
  const params = [farmId, sensorType];
  let where = 'farm_id = $1 AND sensor_type = $2';
  if (zone) {
    params.push(zone);
    where += ` AND zone = $${params.length}`;
  }
  params.push(limit);
  const { rows } = await db.query(
    `SELECT * FROM sensor_readings WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
    params
  );
  return rows;
}

async function latestReadingPerSensor(farmId) {
  // Most recent reading for each distinct sensor_id — used for a dashboard
  // "current conditions" snapshot rather than a full history dump.
  const { rows } = await db.query(
    `SELECT DISTINCT ON (sensor_id) *
     FROM sensor_readings
     WHERE farm_id = $1
     ORDER BY sensor_id, created_at DESC`,
    [farmId]
  );
  return rows;
}

async function getIrrigationZones(farmId) {
  const { rows } = await db.query('SELECT * FROM irrigation_zones WHERE farm_id = $1', [farmId]);
  return rows;
}

async function upsertIrrigationZone({ farmId, zone, moistureThresholdPct, wateringDurationSeconds, enabled }) {
  const { rows } = await db.query(
    `INSERT INTO irrigation_zones (farm_id, zone, moisture_threshold_pct, watering_duration_seconds, enabled)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (farm_id, zone) DO UPDATE SET
       moisture_threshold_pct = EXCLUDED.moisture_threshold_pct,
       watering_duration_seconds = EXCLUDED.watering_duration_seconds,
       enabled = EXCLUDED.enabled
     RETURNING *`,
    [farmId, zone, moistureThresholdPct ?? 30, wateringDurationSeconds ?? 120, enabled ?? true]
  );
  return rows[0];
}

async function createIrrigationEvent({ farmId, zone, triggerReason, soilMoisturePct, durationSeconds }) {
  const { rows } = await db.query(
    `INSERT INTO irrigation_events (farm_id, zone, trigger_reason, soil_moisture_pct, duration_seconds)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [farmId, zone || null, triggerReason, soilMoisturePct ?? null, durationSeconds ?? null]
  );
  return rows[0];
}

async function recentIrrigationEvents(farmId, limit = 50) {
  const { rows } = await db.query(
    'SELECT * FROM irrigation_events WHERE farm_id = $1 ORDER BY created_at DESC LIMIT $2',
    [farmId, limit]
  );
  return rows;
}

module.exports = {
  recordReading, latestBySensorType, latestReadingPerSensor,
  getIrrigationZones, upsertIrrigationZone,
  createIrrigationEvent, recentIrrigationEvents,
};

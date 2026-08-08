const db = require('../config/db');

async function createDetectionEvent({
  farmId, cameraId, module: moduleName, eventType, confidence, boundingBox, snapshotPath, metadata,
}) {
  const { rows } = await db.query(
    `INSERT INTO detection_events
      (farm_id, camera_id, module, event_type, confidence, bounding_box, snapshot_path, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [farmId, cameraId, moduleName, eventType, confidence ?? null,
      boundingBox ? JSON.stringify(boundingBox) : null, snapshotPath || null, metadata ? JSON.stringify(metadata) : '{}']
  );
  return rows[0];
}

async function createAlert({ farmId, eventId, module: moduleName, severity, message, channel }) {
  const { rows } = await db.query(
    `INSERT INTO alerts (farm_id, event_id, module, severity, message, channel)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [farmId, eventId || null, moduleName || null, severity || 'critical', message, channel || 'dashboard']
  );
  return rows[0];
}

async function recentEvents(farmId, { module: moduleName, limit = 50 } = {}) {
  const params = [farmId];
  let where = 'farm_id = $1';
  if (moduleName) {
    params.push(moduleName);
    where += ` AND module = $${params.length}`;
  }
  params.push(limit);
  const { rows } = await db.query(
    `SELECT * FROM detection_events WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
    params
  );
  return rows;
}

module.exports = { createDetectionEvent, createAlert, recentEvents };

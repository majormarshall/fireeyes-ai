const db = require('../config/db');

async function listByFarm(farmId) {
  const { rows } = await db.query(
    'SELECT * FROM cameras WHERE farm_id = $1 ORDER BY created_at ASC',
    [farmId]
  );
  return rows;
}

function slugify(name) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// id is client-supplied (must match whatever the ESP32's x-camera-id header
// will send) — defaults to a slug of the name if not given explicitly.
async function create({ id, farmId, name, streamUrl, zone }) {
  const cameraId = id || slugify(name);
  const { rows } = await db.query(
    `INSERT INTO cameras (id, farm_id, name, stream_url, zone)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [cameraId, farmId, name, streamUrl, zone || null]
  );
  return rows[0];
}

async function markStatus(cameraId, status) {
  await db.query(
    `UPDATE cameras SET status = $2, last_seen_at = now() WHERE id = $1`,
    [cameraId, status]
  );
}

module.exports = { listByFarm, create, markStatus };

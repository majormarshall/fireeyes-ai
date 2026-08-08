const config = require('../config');
const db = require('../config/db');

// Talks to an ESP32 running the sprinkler-relay firmware (see
// firmware/esp32-sprinkler-relay/). Degrades gracefully: if
// SPRINKLER_DEVICE_URL isn't set, activation is skipped and logged —
// alerts/notifications still fire normally.

async function activate(farmId, { reason, cameraId } = {}) {
  if (!config.sprinkler.enabled) {
    console.log(`[sprinkler] Not configured — would have activated for: ${reason}`);
    return { activated: false, reason: 'not_configured' };
  }

  try {
    const res = await fetch(`${config.sprinkler.deviceUrl}/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason, cameraId }),
    });

    if (!res.ok) {
      console.error(`[sprinkler] Device rejected activation: ${res.status}`);
      return { activated: false, reason: 'device_error' };
    }

    await db.query(
      `INSERT INTO sprinkler_events (farm_id, camera_id, trigger_reason) VALUES ($1, $2, $3)`,
      [farmId, cameraId || null, reason]
    );

    console.log(`[sprinkler] Activated for farm ${farmId}: ${reason}`);
    return { activated: true };
  } catch (err) {
    console.error('[sprinkler] Activation failed:', err.message);
    return { activated: false, reason: 'network_error' };
  }
}

module.exports = { activate };

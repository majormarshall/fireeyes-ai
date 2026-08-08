const config = require('../config');
const db = require('../config/db');

// Talks to an ESP32 running a pump-relay firmware (same shape as
// firmware/esp32-sprinkler-relay/ — a separate zone/pump, distinct from the
// fire-suppression sprinkler). Degrades gracefully if IRRIGATION_DEVICE_URL
// isn't set: the trigger is skipped and logged, everything else keeps working.

async function activate(farmId, { zone, reason, soilMoisturePct, durationSeconds } = {}) {
  if (!config.irrigationDevice.enabled) {
    console.log(`[irrigation] Not configured — would have watered zone "${zone}": ${reason}`);
    return { activated: false, reason: 'not_configured' };
  }

  try {
    const res = await fetch(`${config.irrigationDevice.url}/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zone, reason, durationSeconds }),
    });

    if (!res.ok) {
      console.error(`[irrigation] Device rejected activation: ${res.status}`);
      return { activated: false, reason: 'device_error' };
    }

    await db.query(
      `INSERT INTO irrigation_events (farm_id, zone, trigger_reason, soil_moisture_pct, duration_seconds)
       VALUES ($1,$2,$3,$4,$5)`,
      [farmId, zone || null, reason, soilMoisturePct ?? null, durationSeconds ?? null]
    );

    console.log(`[irrigation] Watering zone "${zone}" for farm ${farmId}: ${reason}`);
    return { activated: true };
  } catch (err) {
    console.error('[irrigation] Activation failed:', err.message);
    return { activated: false, reason: 'network_error' };
  }
}

module.exports = { activate };

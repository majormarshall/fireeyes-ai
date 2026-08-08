const express = require('express');
const router = express.Router();
const hub = require('../ws/hub');
const sensorModel = require('../models/sensorModel');

// POST /api/sensors/ingest
// Body: { sensorId, sensorType, value, unit?, zone?, farmId? }
// A single ESP32 sensor node can report multiple readings per push by
// sending this endpoint multiple times (or batch as an array — see below).
router.post('/sensors/ingest', async (req, res) => {
  try {
    const body = Array.isArray(req.body) ? req.body : [req.body];
    const results = [];

    for (const reading of body) {
      const { sensorId, sensorType, value, unit, zone, farmId = 'default' } = reading;
      if (!sensorId || !sensorType || value === undefined) {
        return res.status(400).json({ error: 'sensorId, sensorType, and value are required for every reading' });
      }
      const saved = await sensorModel.recordReading({ farmId, sensorId, sensorType, value, unit, zone });
      hub.broadcast(farmId, 'sensor_reading', saved);
      results.push(saved);
    }

    res.status(202).json({ ok: true, count: results.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sensors/latest?farmId=... — one most-recent reading per sensor
router.get('/sensors/latest', async (req, res) => {
  try {
    const rows = await sensorModel.latestReadingPerSensor(req.query.farmId || 'default');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sensors/history?farmId=...&sensorType=soil_moisture&zone=...&limit=100
router.get('/sensors/history', async (req, res) => {
  try {
    const { farmId = 'default', sensorType, zone, limit } = req.query;
    if (!sensorType) return res.status(400).json({ error: 'sensorType query param is required' });
    const rows = await sensorModel.latestBySensorType(farmId, sensorType, {
      zone,
      limit: limit ? parseInt(limit, 10) : 100,
    });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

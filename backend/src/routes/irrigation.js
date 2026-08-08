const express = require('express');
const router = express.Router();
const sensorModel = require('../models/sensorModel');
const irrigationClient = require('../services/irrigationClient');

// GET /api/irrigation/zones?farmId=...
router.get('/irrigation/zones', async (req, res) => {
  try {
    const zones = await sensorModel.getIrrigationZones(req.query.farmId || 'default');
    res.json(zones);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/irrigation/zones  { farmId?, zone, moistureThresholdPct, wateringDurationSeconds, enabled }
router.put('/irrigation/zones', async (req, res) => {
  try {
    const { farmId = 'default', zone, moistureThresholdPct, wateringDurationSeconds, enabled } = req.body;
    if (!zone) return res.status(400).json({ error: 'zone is required' });
    const saved = await sensorModel.upsertIrrigationZone({
      farmId, zone, moistureThresholdPct, wateringDurationSeconds, enabled,
    });
    res.json(saved);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/irrigation/trigger  { farmId?, zone, durationSeconds? } — manual override
router.post('/irrigation/trigger', async (req, res) => {
  try {
    const { farmId = 'default', zone, durationSeconds } = req.body;
    const result = await irrigationClient.activate(farmId, {
      zone, reason: 'manual', durationSeconds: durationSeconds || 120,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/irrigation/history?farmId=...
router.get('/irrigation/history', async (req, res) => {
  try {
    const rows = await sensorModel.recentIrrigationEvents(req.query.farmId || 'default');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

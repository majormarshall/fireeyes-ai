const express = require('express');
const router = express.Router();
const cropModel = require('../models/cropModel');

// GET /api/crop-growth?farmId=...&cameraId=...&limit=100
router.get('/crop-growth', async (req, res) => {
  try {
    const { farmId = 'default', cameraId, limit } = req.query;
    const rows = await cropModel.recentGrowth(farmId, {
      cameraId,
      limit: limit ? parseInt(limit, 10) : 100,
    });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/disease?farmId=...&cameraId=...&limit=100
router.get('/disease', async (req, res) => {
  try {
    const { farmId = 'default', cameraId, limit } = req.query;
    const rows = await cropModel.recentDisease(farmId, {
      cameraId,
      limit: limit ? parseInt(limit, 10) : 100,
    });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

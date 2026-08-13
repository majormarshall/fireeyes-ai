const express = require('express');
const router = express.Router();
const cameraModel = require('../models/cameraModel');

// GET /api/cameras?farmId=...
router.get('/', async (req, res) => {
  try {
    const cameras = await cameraModel.listByFarm(req.query.farmId || 'default');
    res.json(cameras);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cameras  { id?, farmId, name, streamUrl, zone }
// id should match whatever the physical ESP32-CAM sends as x-camera-id —
// if omitted, one is generated from the name.
router.post('/', async (req, res) => {
  try {
    const { id, farmId, name, streamUrl, zone } = req.body;
    if (!farmId || !name || !streamUrl) {
      return res.status(400).json({ error: 'farmId, name, and streamUrl are required' });
    }
    const camera = await cameraModel.create({ id, farmId, name, streamUrl, zone });
    res.status(201).json(camera);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/cameras/:id
router.delete('/:id', async (req, res) => {
  try {
    const { supabase } = require('../config/db');
    const { error } = await supabase
      .from('cameras')
      .delete()
      .eq('id', req.params.id);
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

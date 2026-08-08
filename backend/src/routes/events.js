const express = require('express');
const router = express.Router();
const db = require('../config/db');
const eventModel = require('../models/eventModel');

// GET /api/events?farmId=...&module=fire_safety&limit=50
router.get('/events', async (req, res) => {
  try {
    const { farmId = 'default', module: moduleName, limit } = req.query;
    const events = await eventModel.recentEvents(farmId, {
      module: moduleName,
      limit: limit ? parseInt(limit, 10) : 50,
    });
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/alerts?farmId=...
router.get('/alerts', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM alerts WHERE farm_id = $1 ORDER BY created_at DESC LIMIT 100',
      [req.query.farmId || 'default']
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/alerts/:id/ack
router.post('/alerts/:id/ack', async (req, res) => {
  try {
    const { rows } = await db.query(
      `UPDATE alerts SET acknowledged = true, acknowledged_at = now() WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/events/:id/recording — metadata + frame URLs for an event's clip
router.get('/events/:id/recording', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM event_recordings WHERE event_id = $1 ORDER BY created_at DESC LIMIT 1',
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'No recording found for this event (it may still be in progress)' });
    }
    const rec = rows[0];
    res.json({
      ...rec,
      manifest_url: `/recordings/${rec.relative_path}/manifest.json`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

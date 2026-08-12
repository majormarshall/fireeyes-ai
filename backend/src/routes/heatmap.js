/**
 * GET /api/heatmap?farmId=xxx
 *
 * Returns aggregated heat-intensity data for the heat signature map canvas.
 * Each entry = { camera_id, zone, intensity, event_type, last_seen }
 *
 * Intensity is computed from recent detection_events in a sliding window:
 *  - fire/smoke: full intensity (1.0), decayed per minute since last event
 *  - security (human/animal/vehicle): medium intensity (0.6)
 *  - disease: low intensity (0.3) — disease risk heat layer
 */
const express = require('express');
const router = express.Router();
const db = require('../config/db');

router.get('/heatmap', async (req, res) => {
  const farmId = req.query.farmId || 'default';
  const windowMinutes = parseInt(req.query.window || '60', 10); // look-back window

  try {
    // Pull the most recent detection event per camera in the time window
    // Using Supabase JS client directly for this aggregation query
    const { supabase } = db;

    if (!supabase) {
      return res.status(503).json({ error: 'Database not connected' });
    }

    const since = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();

    const { data: events, error } = await supabase
      .from('detection_events')
      .select('camera_id, event_type, module, confidence, created_at')
      .eq('farm_id', farmId)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) throw new Error(error.message);

    // Fetch camera zones to map camera → grid position
    const { data: cameras, error: camErr } = await supabase
      .from('cameras')
      .select('id, zone, status')
      .eq('farm_id', farmId);

    if (camErr) throw new Error(camErr.message);

    const zoneMap = {};
    (cameras || []).forEach(c => { zoneMap[c.id] = c.zone || 'Unknown'; });

    // Aggregate: group by camera_id, compute max intensity + decay
    const heatMap = {};
    const now = Date.now();

    (events || []).forEach(evt => {
      const camId = evt.camera_id || 'unknown';
      const zone  = zoneMap[camId] || 'Unknown';
      const ageMs = now - new Date(evt.created_at).getTime();
      const ageMins = ageMs / 60000;

      // Base intensity per module
      let baseIntensity;
      switch (evt.module) {
        case 'fire_safety':    baseIntensity = 1.0; break;
        case 'farm_security':  baseIntensity = 0.65; break;
        case 'plant_disease':  baseIntensity = 0.35; break;
        default:               baseIntensity = 0.2;
      }

      // Decay factor: halves every 10 minutes, floored at 0.05
      const decayFactor = Math.max(0.05, Math.pow(0.5, ageMins / 10));
      const intensity = baseIntensity * decayFactor * (evt.confidence || 0.8);

      if (!heatMap[camId] || heatMap[camId].intensity < intensity) {
        heatMap[camId] = {
          camera_id:  camId,
          zone,
          intensity:  Math.round(intensity * 100) / 100,
          event_type: evt.event_type,
          module:     evt.module,
          last_seen:  evt.created_at,
        };
      }
    });

    const hotspots = Object.values(heatMap).sort((a, b) => b.intensity - a.intensity);

    res.json({
      farm_id:        farmId,
      window_minutes: windowMinutes,
      generated_at:   new Date().toISOString(),
      hotspots,
      total_events:   (events || []).length,
      cameras_mapped: (cameras || []).length,
    });

  } catch (err) {
    console.error('[heatmap] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

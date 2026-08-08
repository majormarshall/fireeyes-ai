const express = require('express');
const router = express.Router();
const streamController = require('../controllers/streamController');

// ESP32-CAM (or a small relay script) POSTs raw JPEG bytes here at ~1-5 fps.
// Headers: x-camera-id, x-farm-id. Body: raw JPEG binary.
router.post(
  '/ingest',
  express.raw({ type: '*/*', limit: '5mb' }),
  streamController.ingestFrame
);

router.get('/:cameraId/latest.jpg', streamController.getLatestFrame);

module.exports = router;

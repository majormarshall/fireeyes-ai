const hub = require('../ws/hub');
const cameraModel = require('../models/cameraModel');
const eventModel = require('../models/eventModel');
const aiClient = require('../services/aiClient');
const notifier = require('../services/notifier');
const sprinklerClient = require('../services/sprinklerClient');
const recorder = require('../services/recorder');
const config = require('../config');

// In-memory cache of the latest frame per camera, so a browser tab that opens
// the MJPEG proxy mid-session gets something immediately instead of a black box.
const latestFrames = new Map(); // cameraId -> Buffer

// How often (ms) we actually run AI inference per camera. Every frame would be
// wasteful — fire/smoke doesn't need 15fps analysis, ~1 frame/sec is plenty.
const INFERENCE_INTERVAL_MS = 1000;
const lastInferenceAt = new Map(); // cameraId -> timestamp

// Security detection runs on its own, slightly longer cadence — a person or
// vehicle in frame doesn't need to be re-confirmed every second the way a
// spreading fire does.
const SECURITY_INFERENCE_INTERVAL_MS = 2000;
const lastSecurityInferenceAt = new Map(); // cameraId -> timestamp
const lastSecurityAlertAt = new Map(); // cameraId -> timestamp, separate cooldown from fire alerts

// Cooldowns so a sustained fire doesn't re-trigger the sprinkler or spam
// email/SMS on every single detection while it's still burning.
const lastSprinklerAt = new Map(); // cameraId -> timestamp
const lastNotifyAt = new Map(); // cameraId -> timestamp

// Called when an ESP32-CAM (or edge relay) POSTs a JPEG frame.
// Body is expected to be raw binary JPEG with header 'x-camera-id' and 'x-farm-id'.
async function ingestFrame(req, res) {
  const cameraId = req.headers['x-camera-id'];
  const farmId = req.headers['x-farm-id'] || 'default';

  if (!cameraId || !req.body || req.body.length === 0) {
    return res.status(400).json({ error: 'x-camera-id header and JPEG body required' });
  }

  const frame = req.body; // raw Buffer (see routes/stream.js body parser)
  latestFrames.set(cameraId, frame);
  recorder.pushFrame(cameraId, frame);

  // Broadcast the raw frame to any connected dashboard viewers as base64.
  hub.broadcast(farmId, 'frame', {
    cameraId,
    image: frame.toString('base64'),
  });

  cameraModel.markStatus(cameraId, 'online').catch((err) =>
    console.error('[stream] failed to mark camera online:', err.message)
  );

  // Throttle AI inference so we're not calling the model on every single frame.
  const now = Date.now();
  const last = lastInferenceAt.get(cameraId) || 0;
  if (now - last >= INFERENCE_INTERVAL_MS) {
    lastInferenceAt.set(cameraId, now);
    runFireSmokeInference(farmId, cameraId, frame).catch((err) =>
      console.error('[stream] inference error:', err.message)
    );
  }

  const lastSecurity = lastSecurityInferenceAt.get(cameraId) || 0;
  if (now - lastSecurity >= SECURITY_INFERENCE_INTERVAL_MS) {
    lastSecurityInferenceAt.set(cameraId, now);
    runFarmSecurityInference(farmId, cameraId, frame).catch((err) =>
      console.error('[stream] security inference error:', err.message)
    );
  }

  res.status(202).json({ ok: true });
}

async function runFireSmokeInference(farmId, cameraId, frame) {
  const result = await aiClient.detectFireSmoke(cameraId, frame);

  for (const det of result.detections || []) {
    if (det.label !== 'fire' && det.label !== 'smoke') continue;

    const event = await eventModel.createDetectionEvent({
      farmId,
      cameraId,
      module: 'fire_safety',
      eventType: det.label,
      confidence: det.confidence,
      boundingBox: det.bbox,
      metadata: { model_version: result.model_version },
    });

    hub.broadcast(farmId, 'detection_event', event);

    // Live event recording — flush pre-event buffer + keep capturing briefly.
    recorder
      .startRecording({ farmId, cameraId, eventId: event.id, eventType: det.label })
      .catch((err) => console.error('[stream] recording start error:', err.message));

    // Any fire/smoke detection above threshold raises a critical alert.
    if (det.confidence >= 0.6) {
      const alert = await eventModel.createAlert({
        farmId,
        eventId: event.id,
        module: 'fire_safety',
        severity: 'critical',
        message: `${det.label.toUpperCase()} detected on camera ${cameraId} (${Math.round(det.confidence * 100)}% confidence)`,
        channel: 'dashboard',
      });
      hub.broadcast(farmId, 'alert', alert);

      // Sprinkler auto-activation — only for 'fire' (smoke alone doesn't
      // need water), and rate-limited so one fire doesn't trigger it repeatedly.
      if (det.label === 'fire') {
        const now = Date.now();
        const lastAt = lastSprinklerAt.get(cameraId) || 0;
        if (now - lastAt >= config.sprinkler.cooldownSeconds * 1000) {
          lastSprinklerAt.set(cameraId, now);
          sprinklerClient
            .activate(farmId, { reason: alert.message, cameraId })
            .catch((err) => console.error('[stream] sprinkler activation error:', err.message));
        }
      }

      // Email/SMS dispatch — same cooldown idea, separate from the sprinkler's.
      const now = Date.now();
      const lastNotify = lastNotifyAt.get(cameraId) || 0;
      if (now - lastNotify >= config.alerts.cooldownSeconds * 1000) {
        lastNotifyAt.set(cameraId, now);
        notifier
          .sendCriticalAlert({
            subject: `🔥 AgriEyes AI — ${det.label} detected`,
            message: alert.message,
          })
          .catch((err) => console.error('[stream] notify error:', err.message));
      }
    }
  }
}

async function runFarmSecurityInference(farmId, cameraId, frame) {
  const result = await aiClient.detectFarmSecurity(cameraId, frame);

  for (const det of result.detections || []) {
    if (!['human', 'animal', 'vehicle'].includes(det.label)) continue;

    const event = await eventModel.createDetectionEvent({
      farmId,
      cameraId,
      module: 'farm_security',
      eventType: det.label,
      confidence: det.confidence,
      boundingBox: det.bbox,
      metadata: { model_version: result.model_version, raw_label: det.raw_label },
    });

    hub.broadcast(farmId, 'detection_event', event);

    // Human or vehicle presence raises a warning-level alert (not critical —
    // this needs a human to review, not an automatic sprinkler/relay
    // response). Animal presence is logged but doesn't alert by default;
    // farms expect wildlife/livestock in frame far more than intruders.
    if (det.label !== 'animal' && det.confidence >= 0.6) {
      const nowSec = Date.now();
      const lastAlert = lastSecurityAlertAt.get(cameraId) || 0;
      if (nowSec - lastAlert >= config.security.alertCooldownSeconds * 1000) {
        lastSecurityAlertAt.set(cameraId, nowSec);

        const alert = await eventModel.createAlert({
          farmId,
          eventId: event.id,
          module: 'farm_security',
          severity: 'warning',
          message: `${det.label} detected on camera ${cameraId} (${Math.round(det.confidence * 100)}% confidence)`,
          channel: 'dashboard',
        });
        hub.broadcast(farmId, 'alert', alert);

        notifier
          .sendCriticalAlert({
            subject: `🛡️ AgriEyes AI — ${det.label} detected`,
            message: alert.message,
          })
          .catch((err) => console.error('[stream] security notify error:', err.message));
      }
    }
  }
}

// GET /api/stream/:cameraId/latest.jpg — simple polling fallback for dashboards
// that don't use the WebSocket (or for debugging in a browser directly).
function getLatestFrame(req, res) {
  const frame = latestFrames.get(req.params.cameraId);
  if (!frame) return res.status(404).send('No frame yet for this camera');
  res.set('Content-Type', 'image/jpeg');
  res.send(frame);
}

// Exposed so the crop/disease scheduler can grab the latest frame per camera
// without re-plumbing a separate frame cache.
function getLatestFrameBuffer(cameraId) {
  return latestFrames.get(cameraId) || null;
}

function getAllCameraIds() {
  return [...latestFrames.keys()];
}

module.exports = { ingestFrame, getLatestFrame, getLatestFrameBuffer, getAllCameraIds };

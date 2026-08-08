const fs = require('fs');
const path = require('path');
const db = require('../config/db');

// "Live event recording" (Fire & Safety AI spec item). Rather than always
// recording — which chews disk fast on a farm with several cameras running
// 24/7 — we keep a small rolling buffer of recent frames per camera in
// memory, and only write to disk when a detection event actually fires.
// That gives you PRE-event context (what led up to it) plus a short
// POST-event window (how it developed), without recording idle footage.

const PRE_EVENT_FRAMES = 10;   // ~5s of context at 2fps
const POST_EVENT_MS = 8000;    // keep capturing for 8s after the event fires
const STORAGE_ROOT = path.join(__dirname, '../../storage/recordings');

const rollingBuffers = new Map();       // cameraId -> [{ buffer, ts }]
const activeRecordings = new Map();     // cameraId -> { dir, frames: [], endAt }

// Called on every ingested frame, regardless of whether AI ran on it.
function pushFrame(cameraId, frameBuffer) {
  const ts = Date.now();

  const ring = rollingBuffers.get(cameraId) || [];
  ring.push({ buffer: frameBuffer, ts });
  while (ring.length > PRE_EVENT_FRAMES) ring.shift();
  rollingBuffers.set(cameraId, ring);

  const rec = activeRecordings.get(cameraId);
  if (rec) {
    rec.frames.push({ buffer: frameBuffer, ts });
    if (ts >= rec.endAt) finalizeRecording(cameraId).catch((err) =>
      console.error('[recorder] finalize failed:', err.message)
    );
  }
}

// Called when a detection event fires. Flushes the pre-event buffer to disk
// immediately and keeps capturing new frames for POST_EVENT_MS.
async function startRecording({ farmId, cameraId, eventId, eventType }) {
  if (activeRecordings.has(cameraId)) {
    // Already recording for this camera (e.g. rapid repeat detections) —
    // just extend the window instead of starting a second clip.
    const rec = activeRecordings.get(cameraId);
    rec.endAt = Date.now() + POST_EVENT_MS;
    return rec.dir;
  }

  const dir = path.join(STORAGE_ROOT, farmId, cameraId, `${Date.now()}_${eventId}`);
  fs.mkdirSync(dir, { recursive: true });

  const preEventFrames = [...(rollingBuffers.get(cameraId) || [])];

  activeRecordings.set(cameraId, {
    dir,
    farmId,
    eventId,
    eventType,
    frames: preEventFrames, // seed with pre-event context
    endAt: Date.now() + POST_EVENT_MS,
  });

  return dir;
}

async function finalizeRecording(cameraId) {
  const rec = activeRecordings.get(cameraId);
  if (!rec) return null;
  activeRecordings.delete(cameraId);

  const manifest = { farmId: rec.farmId, eventId: rec.eventId, eventType: rec.eventType, frames: [] };

  rec.frames.forEach((f, i) => {
    const filename = `frame_${String(i).padStart(4, '0')}.jpg`;
    fs.writeFileSync(path.join(rec.dir, filename), f.buffer);
    manifest.frames.push({ file: filename, ts: f.ts });
  });

  fs.writeFileSync(path.join(rec.dir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const relativePath = path.relative(STORAGE_ROOT, rec.dir);
  console.log(`[recorder] Saved ${rec.frames.length}-frame clip for event ${rec.eventId} -> ${relativePath}`);

  try {
    await db.query(
      `INSERT INTO event_recordings (event_id, relative_path, frame_count) VALUES ($1, $2, $3)`,
      [rec.eventId, relativePath, rec.frames.length]
    );
  } catch (err) {
    console.error('[recorder] failed to index recording in DB:', err.message);
  }

  return relativePath;
}

module.exports = { pushFrame, startRecording, STORAGE_ROOT };

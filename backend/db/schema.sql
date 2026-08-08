-- FireEyes AI — Phase 1+2 schema
-- Works identically in Cloud mode (Supabase/hosted Postgres) and Edge mode (local Postgres).
--
-- Farm and camera IDs are TEXT, not server-generated UUIDs. Both are set by
-- the client (dashboard registers a farm/camera with a chosen id, e.g.
-- "default" / "cam-north-field-01") because that's the id ESP32 devices and
-- the single-farm dashboard actually use in headers and URLs — generating a
-- separate UUID and requiring every device to be reconfigured with it would
-- just be friction for no benefit at this scale. Every other table still
-- uses server-generated UUIDs for its own primary key.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- A physical farm site. In Edge mode there is usually exactly one row here.
CREATE TABLE IF NOT EXISTS farms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the single farm Phase 1-4 default everywhere ("default") assumes.
-- Multi-farm (Phase 4) just means registering more rows here.
INSERT INTO farms (id, name) VALUES ('default', 'Default Farm')
  ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  farm_id TEXT REFERENCES farms(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'operator', -- owner | operator | viewer
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ESP32-CAM units registered to a farm. id is the same string the ESP32
-- sends in its x-camera-id header (e.g. "cam-north-field-01") — set it
-- when registering the camera so device config and DB agree without a
-- separate lookup step.
CREATE TABLE IF NOT EXISTS cameras (
  id TEXT PRIMARY KEY,
  farm_id TEXT NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  stream_url TEXT NOT NULL,       -- e.g. http://<esp32-ip>:81/stream, or "n/a — push mode"
  zone TEXT,                      -- e.g. "North field", "Barn entrance"
  status TEXT NOT NULL DEFAULT 'offline', -- online | offline | error
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- AI detection events (fire, smoke, later: human/animal/vehicle, disease, etc.)
CREATE TABLE IF NOT EXISTS detection_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  farm_id TEXT NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  camera_id TEXT REFERENCES cameras(id) ON DELETE SET NULL,
  module TEXT NOT NULL,           -- 'fire_safety' | 'crop_growth' | 'plant_disease' | 'farm_security' | 'farm_intelligence'
  event_type TEXT NOT NULL,       -- 'fire' | 'smoke' | 'human' | 'animal' | 'vehicle' | 'disease:early_blight' | ...
  confidence REAL,
  bounding_box JSONB,             -- {x, y, w, h} in normalized coords
  snapshot_path TEXT,             -- stored frame/clip reference
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_detection_events_farm_created ON detection_events(farm_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_detection_events_module ON detection_events(module);

-- Alerts raised from detection events (fire/smoke triggers these in Phase 1)
CREATE TABLE IF NOT EXISTS alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  farm_id TEXT NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  event_id UUID REFERENCES detection_events(id) ON DELETE SET NULL,
  module TEXT,                     -- 'fire_safety' | 'plant_disease' | 'farm_security' | ... — lets the dashboard route an alert to the right panel without guessing from its message text
  severity TEXT NOT NULL DEFAULT 'critical', -- info | warning | critical
  message TEXT NOT NULL,
  channel TEXT,                    -- 'email' | 'sms' | 'dashboard' | 'sprinkler_trigger'
  acknowledged BOOLEAN NOT NULL DEFAULT false,
  acknowledged_by UUID REFERENCES users(id),
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_alerts_farm_created ON alerts(farm_id, created_at DESC);

-- Outbox for Edge -> Cloud sync (queued while offline, drained when online)
CREATE TABLE IF NOT EXISTS sync_outbox (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type TEXT NOT NULL,       -- 'detection_event' | 'alert' | ...
  entity_id UUID NOT NULL,
  payload JSONB NOT NULL,
  synced BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  synced_at TIMESTAMPTZ
);

-- "Live event recording" — short frame-sequence clips saved around a
-- detection event (pre-event buffer + a few seconds after). Stored on disk
-- under backend/storage/recordings/, this table just indexes them.
CREATE TABLE IF NOT EXISTS event_recordings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES detection_events(id) ON DELETE CASCADE,
  relative_path TEXT NOT NULL,     -- path under storage/recordings/
  frame_count INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_event_recordings_event ON event_recordings(event_id);

-- ── Phase 2: Crop Growth AI (Model B) ────────────────────────
-- One row per scheduled growth check (not per frame — growth is analyzed
-- on a schedule, e.g. every few hours, not continuously like fire/smoke).
CREATE TABLE IF NOT EXISTS crop_growth_observations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  farm_id TEXT NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  camera_id TEXT REFERENCES cameras(id) ON DELETE SET NULL,
  crop_type TEXT NOT NULL DEFAULT 'tomato',
  plant_height_cm REAL,
  leaf_count INTEGER,
  growth_stage TEXT,             -- 'seedling' | 'vegetative' | 'flowering' | 'fruiting' | 'mature'
  canopy_coverage_pct REAL,
  estimated_harvest_date DATE,
  image_path TEXT,
  model_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crop_growth_farm_created ON crop_growth_observations(farm_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crop_growth_camera_created ON crop_growth_observations(camera_id, created_at DESC);

-- ── Phase 2: Plant Disease AI (Model C) ──────────────────────
CREATE TABLE IF NOT EXISTS disease_observations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  farm_id TEXT NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  camera_id TEXT REFERENCES cameras(id) ON DELETE SET NULL,
  crop_type TEXT NOT NULL DEFAULT 'tomato',
  label TEXT NOT NULL,            -- 'healthy' | 'early_blight' | 'late_blight' | 'leaf_mold' | ...
  confidence REAL,
  image_path TEXT,
  model_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_disease_farm_created ON disease_observations(farm_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_disease_label ON disease_observations(label);

-- Log of automatic sprinkler activations, so you can audit false triggers
CREATE TABLE IF NOT EXISTS sprinkler_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  farm_id TEXT NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  camera_id TEXT REFERENCES cameras(id) ON DELETE SET NULL,
  trigger_reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sprinkler_events_farm_created ON sprinkler_events(farm_id, created_at DESC);

-- ── Phase 3: Farm Security AI (Model D) ──────────────────────
-- Detections reuse detection_events (module='farm_security',
-- event_type='human'|'animal'|'vehicle') — same table as fire/smoke, since
-- both are "AI saw something in a frame" events. No separate table needed.

-- ── Phase 3: Farm Intelligence — sensors ─────────────────────
-- One row per sensor reading push from an ESP32 sensor node. A single node
-- can report several metrics at once (soil moisture + temp + humidity),
-- hence sensor_type + value rather than fixed columns per metric.
CREATE TABLE IF NOT EXISTS sensor_readings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  farm_id TEXT NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  sensor_id TEXT NOT NULL,          -- e.g. "soil-north-01", matches the ESP32's device id
  sensor_type TEXT NOT NULL,        -- 'soil_moisture' | 'temperature' | 'humidity' | 'water_level' | 'rain'
  value REAL NOT NULL,
  unit TEXT,                        -- '%' | 'C' | 'cm' | ...
  zone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sensor_readings_farm_created ON sensor_readings(farm_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sensor_readings_sensor_created ON sensor_readings(sensor_id, created_at DESC);

-- ── Phase 3: Irrigation ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS irrigation_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  farm_id TEXT NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  zone TEXT,
  trigger_reason TEXT NOT NULL,      -- 'low_soil_moisture' | 'scheduled' | 'manual'
  soil_moisture_pct REAL,            -- reading that triggered it, if applicable
  duration_seconds INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_irrigation_events_farm_created ON irrigation_events(farm_id, created_at DESC);

-- Per-zone irrigation config (moisture threshold that triggers watering,
-- and an optional fixed daily schedule as a fallback/override).
CREATE TABLE IF NOT EXISTS irrigation_zones (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  farm_id TEXT NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  zone TEXT NOT NULL,
  moisture_threshold_pct REAL NOT NULL DEFAULT 30,
  watering_duration_seconds INTEGER NOT NULL DEFAULT 120,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (farm_id, zone)
);

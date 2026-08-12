const { supabase } = require('../config/db');

async function recordReading({ farmId, sensorId, sensorType, value, unit, zone }) {
  const { data, error } = await supabase
    .from('sensor_readings')
    .insert({
      farm_id: farmId,
      sensor_id: sensorId,
      sensor_type: sensorType,
      value,
      unit: unit || null,
      zone: zone || null,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function latestBySensorType(farmId, sensorType, { zone, limit = 50 } = {}) {
  let req = supabase
    .from('sensor_readings')
    .select('*')
    .eq('farm_id', farmId)
    .eq('sensor_type', sensorType)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (zone) req = req.eq('zone', zone);
  const { data, error } = await req;
  if (error) throw new Error(error.message);
  return data || [];
}

async function latestReadingPerSensor(farmId) {
  // Get the most recent reading for each sensor_id
  const { data, error } = await supabase
    .from('sensor_readings')
    .select('*')
    .eq('farm_id', farmId)
    .order('created_at', { ascending: false })
    .limit(500); // fetch a batch and de-dup in JS (PostgREST doesn't support DISTINCT ON)
  if (error) throw new Error(error.message);
  // De-dup: keep first (most recent) per sensor_id
  const seen = new Set();
  return (data || []).filter(r => { if (seen.has(r.sensor_id)) return false; seen.add(r.sensor_id); return true; });
}

async function getIrrigationZones(farmId) {
  const { data, error } = await supabase
    .from('irrigation_zones')
    .select('*')
    .eq('farm_id', farmId);
  if (error) throw new Error(error.message);
  return data || [];
}

async function upsertIrrigationZone({ farmId, zone, moistureThresholdPct, wateringDurationSeconds, enabled }) {
  const { data, error } = await supabase
    .from('irrigation_zones')
    .upsert({
      farm_id: farmId,
      zone,
      moisture_threshold_pct: moistureThresholdPct ?? 30,
      watering_duration_seconds: wateringDurationSeconds ?? 120,
      enabled: enabled ?? true,
    }, { onConflict: 'farm_id,zone' })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function createIrrigationEvent({ farmId, zone, triggerReason, soilMoisturePct, durationSeconds }) {
  const { data, error } = await supabase
    .from('irrigation_events')
    .insert({
      farm_id: farmId,
      zone: zone || null,
      trigger_reason: triggerReason,
      soil_moisture_pct: soilMoisturePct ?? null,
      duration_seconds: durationSeconds ?? null,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function recentIrrigationEvents(farmId, limit = 50) {
  const { data, error } = await supabase
    .from('irrigation_events')
    .select('*')
    .eq('farm_id', farmId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data || [];
}

module.exports = {
  recordReading, latestBySensorType, latestReadingPerSensor,
  getIrrigationZones, upsertIrrigationZone,
  createIrrigationEvent, recentIrrigationEvents,
};

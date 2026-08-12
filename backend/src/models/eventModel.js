const { supabase } = require('../config/db');

async function createDetectionEvent({
  farmId, cameraId, module: moduleName, eventType, confidence, boundingBox, snapshotPath, metadata,
}) {
  const { data, error } = await supabase
    .from('detection_events')
    .insert({
      farm_id: farmId,
      camera_id: cameraId || null,
      module: moduleName,
      event_type: eventType,
      confidence: confidence ?? null,
      bounding_box: boundingBox || null,
      snapshot_path: snapshotPath || null,
      metadata: metadata || {},
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function createAlert({ farmId, eventId, module: moduleName, severity, message, channel }) {
  const { data, error } = await supabase
    .from('alerts')
    .insert({
      farm_id: farmId,
      event_id: eventId || null,
      module: moduleName || null,
      severity: severity || 'critical',
      message,
      channel: channel || 'dashboard',
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function recentEvents(farmId, { module: moduleName, limit = 50 } = {}) {
  let req = supabase
    .from('detection_events')
    .select('*')
    .eq('farm_id', farmId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (moduleName) req = req.eq('module', moduleName);
  const { data, error } = await req;
  if (error) throw new Error(error.message);
  return data || [];
}

async function recentAlerts(farmId, { limit = 50 } = {}) {
  const { data, error } = await supabase
    .from('alerts')
    .select('*')
    .eq('farm_id', farmId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data || [];
}

module.exports = { createDetectionEvent, createAlert, recentEvents, recentAlerts };

const { supabase } = require('../config/db');

async function listByFarm(farmId) {
  const { data, error } = await supabase
    .from('cameras')
    .select('*')
    .eq('farm_id', farmId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

function slugify(name) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// id is client-supplied (must match the ESP32's x-camera-id header)
async function create({ id, farmId, name, streamUrl, zone }) {
  const cameraId = id || slugify(name);
  const { data, error } = await supabase
    .from('cameras')
    .insert({ id: cameraId, farm_id: farmId, name, stream_url: streamUrl, zone: zone || null })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function markStatus(cameraId, status) {
  const { error } = await supabase
    .from('cameras')
    .update({ status, last_seen_at: new Date().toISOString() })
    .eq('id', cameraId);
  if (error) throw new Error(error.message);
}

module.exports = { listByFarm, create, markStatus };

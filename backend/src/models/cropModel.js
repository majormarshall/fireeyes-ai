const { supabase } = require('../config/db');

// ── Helpers ────────────────────────────────────────────────────────────────────
// PostgREST schema cache sometimes doesn't reflect newly created tables.
// We use supabase.rpc() with a helper function, or fall back to a direct
// REST call with the raw SQL via the Postgres REST functions.
//
// Simpler fix: query via .from() and catch the schema-cache error gracefully,
// returning [] so the dashboard doesn't crash while the cache refreshes (~5 min).
async function safeFrom(table, buildQuery) {
  try {
    const req = supabase.from(table);
    const { data, error } = await buildQuery(req);
    if (error) {
      if (error.message && error.message.includes('schema cache')) {
        console.warn(`[cropModel] Schema cache miss for ${table} — returning [] (will auto-resolve)`);
        return [];
      }
      throw new Error(error.message);
    }
    return data || [];
  } catch (e) {
    console.warn(`[cropModel] ${table} error: ${e.message}`);
    return [];
  }
}

// ── Crop Growth ───────────────────────────────────────────────────────────────
async function createGrowthObservation({
  farmId, cameraId, cropType, plantHeightCm, leafCount, growthStage,
  canopyCoveragePct, estimatedHarvestDate, imagePath, modelVersion,
}) {
  const { data, error } = await supabase
    .from('crop_growth_observations')
    .insert({
      farm_id: farmId,
      camera_id: cameraId || null,
      crop_type: cropType || 'tomato',
      plant_height_cm: plantHeightCm ?? null,
      leaf_count: leafCount ?? null,
      growth_stage: growthStage ?? null,
      canopy_coverage_pct: canopyCoveragePct ?? null,
      estimated_harvest_date: estimatedHarvestDate ?? null,
      image_path: imagePath ?? null,
      model_version: modelVersion ?? null,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function recentGrowth(farmId, { cameraId, limit = 100 } = {}) {
  return safeFrom('crop_growth_observations', req => {
    let q = req.select('*')
      .eq('farm_id', farmId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (cameraId) q = q.eq('camera_id', cameraId);
    return q;
  });
}

// ── Disease Observations ──────────────────────────────────────────────────────
async function createDiseaseObservation({
  farmId, cameraId, cropType, label, confidence, imagePath, modelVersion,
}) {
  const { data, error } = await supabase
    .from('disease_observations')
    .insert({
      farm_id: farmId,
      camera_id: cameraId || null,
      crop_type: cropType || 'tomato',
      label,
      confidence: confidence ?? null,
      image_path: imagePath ?? null,
      model_version: modelVersion ?? null,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function recentDisease(farmId, { cameraId, limit = 100 } = {}) {
  return safeFrom('disease_observations', req => {
    let q = req.select('*')
      .eq('farm_id', farmId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (cameraId) q = q.eq('camera_id', cameraId);
    return q;
  });
}

module.exports = {
  createGrowthObservation, recentGrowth,
  createDiseaseObservation, recentDisease,
};

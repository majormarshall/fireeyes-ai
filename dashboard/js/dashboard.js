// ── Config ────────────────────────────────────────────────────
// Use relative URLs — works on both localhost:4000 and Vercel production
const FARM_ID  = 'default';
const API_BASE = ''; // empty = same origin (relative paths)

const socket      = new AgriEyesSocket(FARM_ID);
const cameraTiles = new Map(); // cameraId → <img> element

// ── Navigation ────────────────────────────────────────────────
document.querySelectorAll('.nav-link:not(.disabled)').forEach((link) => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    document.querySelectorAll('.nav-link').forEach((l) => l.classList.remove('active'));
    document.querySelectorAll('.section').forEach((s) => s.classList.remove('active'));
    link.classList.add('active');
    const id = link.dataset.section;
    document.getElementById(id).classList.add('active');
    document.getElementById('section-title').textContent = link.textContent.trim().split('\n')[0];
  });
});

// ── Connection status ────────────────────────────────────────
socket.on('status', (status) => {
  const el = document.getElementById('conn-status');
  el.textContent = status === 'online' ? 'live' : 'reconnecting…';
  el.className = `conn-status ${status}`;
  const sc = document.getElementById('stat-conn');
  if (sc) sc.textContent = status === 'online' ? '🟢 Live' : '🔴 Offline';
});

socket.on('connected', () => {
  fetch(`/health`).then((r) => r.json()).then((h) => {
    document.getElementById('mode-badge').textContent = `mode: ${h.mode}`;
    const sm = document.getElementById('stat-mode');
    if (sm) sm.textContent = h.mode.toUpperCase();
  });
  const sc = document.getElementById('stat-conn');
  if (sc) sc.textContent = '🟢 Live';
  loadCameras();
  loadRecentEvents();
  loadAlerts();
});


// ── Live camera frames ───────────────────────────────────────
function ensureTile(cameraId) {
  if (cameraTiles.has(cameraId)) return cameraTiles.get(cameraId);

  const grid = document.getElementById('camera-grid');
  grid.querySelector('.empty-state')?.remove();

  const tile = document.createElement('div');
  tile.className = 'camera-tile';
  tile.innerHTML = `
    <img id="img-${cameraId}" alt="${cameraId}" />
    <div class="label">
      <span><span class="status-dot online"></span>${cameraId}</span>
    </div>`;
  grid.appendChild(tile);
  const img = tile.querySelector('img');
  cameraTiles.set(cameraId, img);
  return img;
}

socket.on('frame', ({ cameraId, image }) => {
  const img = ensureTile(cameraId);
  img.src = `data:image/jpeg;base64,${image}`;
});

async function loadCameras() {
  try {
    const cameras = await fetch(`/api/cameras?farmId=${FARM_ID}`).then((r) => r.json());
    cameras.forEach((cam) => ensureTile(cam.id));
    const total = cameras.length;
    const online = cameras.filter(c => c.status === 'online').length;
    const tot = document.getElementById('stat-cameras-total');
    const onl = document.getElementById('stat-cameras-online');
    if (tot) tot.textContent = total;
    if (onl) { onl.textContent = online; onl.className = `stat-value ${online > 0 ? 'green' : ''}`; }
  } catch (e) {
    console.error('failed to load cameras', e);
  }
}

// ── Fire monitoring: alerts + events ────────────────────────
socket.on('alert', (alert) => {
  if (alert.module === 'fire_safety') prependAlert(alert);
});
socket.on('detection_event', (event) => {
  if (event.module === 'fire_safety') prependEvent(event);
});

function prependAlert(alert) {
  const list = document.getElementById('alerts-list');
  list.querySelector('.empty-state')?.remove();
  const li = document.createElement('li');
  li.className = alert.severity;
  li.innerHTML = `<span>🚨 ${alert.message}</span><span class="timestamp">${new Date(alert.created_at || Date.now()).toLocaleTimeString()}</span>`;
  list.prepend(li);
}

function prependEvent(event) {
  const list = document.getElementById('events-list');
  list.querySelector('.empty-state')?.remove();
  const li = document.createElement('li');
  li.innerHTML = `<span>${event.event_type} — ${Math.round((event.confidence || 0) * 100)}% confidence</span><span class="timestamp">${new Date(event.created_at || Date.now()).toLocaleTimeString()} <a href="#" class="rec-link" data-event-id="${event.id}">🎬 clip</a></span>`;
  list.prepend(li);
}

document.getElementById('events-list').addEventListener('click', async (e) => {
  if (!e.target.classList.contains('rec-link')) return;
  e.preventDefault();
  const eventId = e.target.dataset.eventId;
  try {
    const rec = await fetch(`/api/events/${eventId}/recording`).then((r) => r.json());
    if (rec.error) return alert(rec.error);
    window.open(rec.manifest_url, '_blank');
  } catch (err) {
    alert('Could not load recording: ' + err.message);
  }
});

async function loadRecentEvents() {
  try {
    const events = await fetch(`/api/events?farmId=${FARM_ID}&module=fire_safety&limit=20`).then((r) => r.json());
    events.forEach(prependEvent);
  } catch (e) { console.error('failed to load events', e); }
}

async function loadAlerts() {
  try {
    const alerts = await fetch(`/api/alerts?farmId=${FARM_ID}`).then((r) => r.json());
    alerts.filter((a) => a.module === 'fire_safety').forEach(prependAlert);
    alerts.filter((a) => a.module === 'plant_disease').forEach(addDiseaseAlert);
    alerts.filter((a) => a.module === 'farm_security').forEach(addSecurityAlert);
  } catch (e) { console.error('failed to load alerts', e); }
}

// ── Phase 2: Crop Growth AI ──────────────────────────────────
let growthChart = null;

function initGrowthChart() {
  const ctx = document.getElementById('growth-chart');
  if (!ctx || typeof Chart === 'undefined') return;
  growthChart = new Chart(ctx, {
    type: 'line',
    data: { labels: [], datasets: [{ label: 'Plant height (cm)', data: [], borderColor: '#35c46b', tension: 0.3 }] },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#8a97a1' }, grid: { color: '#263038' } },
        y: { ticks: { color: '#8a97a1' }, grid: { color: '#263038' } },
      },
    },
  });
}

function addGrowthPoint(obs) {
  const list = document.getElementById('growth-list');
  list.querySelector('.empty-state')?.remove();
  const li = document.createElement('li');
  const parts = [];
  if (obs.growth_stage) parts.push(obs.growth_stage);
  if (obs.leaf_count != null) parts.push(`${obs.leaf_count} leaves`);
  if (obs.canopy_coverage_pct != null) parts.push(`${Math.round(obs.canopy_coverage_pct)}% canopy`);
  li.innerHTML = `<span>${parts.join(' · ') || 'Growth check (no model loaded yet)'}</span><span class="timestamp">${new Date(obs.created_at || Date.now()).toLocaleString()}</span>`;
  list.prepend(li);

  if (growthChart && obs.plant_height_cm != null) {
    growthChart.data.labels.push(new Date(obs.created_at || Date.now()).toLocaleDateString());
    growthChart.data.datasets[0].data.push(obs.plant_height_cm);
    growthChart.update();
  }
}

async function loadGrowthHistory() {
  try {
    const rows = await fetch(`/api/crop-growth?farmId=${FARM_ID}&limit=30`).then((r) => r.json());
    [...rows].reverse().forEach(addGrowthPoint);
  } catch (e) { console.error('failed to load growth history', e); }
}

socket.on('growth_observation', addGrowthPoint);

// ── Phase 2: Plant Disease AI ────────────────────────────────
function addDiseaseEntry(obs) {
  const list = document.getElementById('disease-list');
  list.querySelector('.empty-state')?.remove();
  const li = document.createElement('li');
  const label = obs.label ? obs.label.replace(/_/g, ' ') : 'no model loaded yet';
  li.innerHTML = `<span>${label} — ${Math.round((obs.confidence || 0) * 100)}% confidence</span><span class="timestamp">${new Date(obs.created_at || Date.now()).toLocaleString()}</span>`;
  list.prepend(li);
}

function addDiseaseAlert(alert) {
  const list = document.getElementById('disease-alerts-list');
  list.querySelector('.empty-state')?.remove();
  const li = document.createElement('li');
  li.className = alert.severity;
  li.innerHTML = `<span>🍅 ${alert.message}</span><span class="timestamp">${new Date(alert.created_at || Date.now()).toLocaleTimeString()}</span>`;
  list.prepend(li);
}

async function loadDiseaseHistory() {
  try {
    const rows = await fetch(`/api/disease?farmId=${FARM_ID}&limit=30`).then((r) => r.json());
    rows.forEach(addDiseaseEntry);
  } catch (e) { console.error('failed to load disease history', e); }
}

socket.on('disease_observation', addDiseaseEntry);
socket.on('alert', (alert) => {
  if (alert.module === 'plant_disease') addDiseaseAlert(alert);
});

// Kick off Phase 2 data once connected (alongside Phase 1 loads in the
// existing 'connected' handler above).
socket.on('connected', () => {
  initGrowthChart();
  loadGrowthHistory();
  loadDiseaseHistory();
  loadSecurityHistory();
  loadMoistureSnapshot();
  loadIrrigationHistory();
});

// ── Phase 3: Farm Security AI ────────────────────────────────
function addSecurityEntry(event) {
  const list = document.getElementById('security-list');
  list.querySelector('.empty-state')?.remove();
  const li = document.createElement('li');
  li.innerHTML = `<span>${event.event_type} — ${Math.round((event.confidence || 0) * 100)}% confidence</span><span class="timestamp">${new Date(event.created_at || Date.now()).toLocaleString()}</span>`;
  list.prepend(li);
}

function addSecurityAlert(alert) {
  const list = document.getElementById('security-alerts-list');
  list.querySelector('.empty-state')?.remove();
  const li = document.createElement('li');
  li.className = alert.severity;
  li.innerHTML = `<span>🛡️ ${alert.message}</span><span class="timestamp">${new Date(alert.created_at || Date.now()).toLocaleTimeString()}</span>`;
  list.prepend(li);
}

async function loadSecurityHistory() {
  try {
    const rows = await fetch(`/api/events?farmId=${FARM_ID}&module=farm_security&limit=30`).then((r) => r.json());
    rows.forEach(addSecurityEntry);
  } catch (e) { console.error('failed to load security history', e); }
}

socket.on('detection_event', (event) => {
  if (event.module === 'farm_security') addSecurityEntry(event);
});
socket.on('alert', (alert) => {
  if (alert.module === 'farm_security') addSecurityAlert(alert);
});

// ── Phase 3: Farm Intelligence — sensors + irrigation ────────
function renderMoistureSnapshot(readings) {
  const list = document.getElementById('moisture-list');
  const soilReadings = readings.filter((r) => r.sensor_type === 'soil_moisture');
  if (soilReadings.length === 0) return;
  list.querySelector('.empty-state')?.remove();
  list.innerHTML = '';
  soilReadings.forEach((r) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${r.zone || r.sensor_id}: ${r.value.toFixed(1)}${r.unit || '%'}</span><span class="timestamp">${new Date(r.created_at).toLocaleTimeString()}</span>`;
    list.appendChild(li);
  });
}

async function loadMoistureSnapshot() {
  try {
    const rows = await fetch(`/api/sensors/latest?farmId=${FARM_ID}`).then((r) => r.json());
    renderMoistureSnapshot(rows);
  } catch (e) { console.error('failed to load sensor snapshot', e); }
}

socket.on('sensor_reading', () => loadMoistureSnapshot()); // simplest correct approach: re-pull the snapshot

function addIrrigationEntry(evt) {
  const list = document.getElementById('irrigation-list');
  list.querySelector('.empty-state')?.remove();
  const li = document.createElement('li');
  const moisture = evt.soil_moisture_pct != null ? ` (soil at ${evt.soil_moisture_pct.toFixed?.(1) ?? evt.soil_moisture_pct}%)` : '';
  li.innerHTML = `<span>${evt.zone || 'unknown zone'} — ${evt.trigger_reason || evt.reason}${moisture}</span><span class="timestamp">${new Date(evt.created_at || Date.now()).toLocaleString()}</span>`;
  list.prepend(li);
}

async function loadIrrigationHistory() {
  try {
    const rows = await fetch(`/api/irrigation/history?farmId=${FARM_ID}`).then((r) => r.json());
    rows.forEach(addIrrigationEntry);
  } catch (e) { console.error('failed to load irrigation history', e); }
}

socket.on('irrigation_event', addIrrigationEntry);

// ── Heat Signature Map ────────────────────────────────────────
let heatMap = null;
let heatDetectionCount = 0;

function initHeatMap() {
  if (typeof HeatSignatureMap === 'undefined') return;
  heatMap = new HeatSignatureMap('heat-canvas', { cols: 24, rows: 14, decayRate: 0.98 });
  heatMap.start();

  // Reset button
  document.getElementById('heatmap-reset-btn')?.addEventListener('click', () => {
    if (heatMap) {
      heatMap.grid = Array.from({ length: heatMap.rows }, () => new Float32Array(heatMap.cols));
      heatMap.peakTemp = 0;
      heatDetectionCount = 0;
      updateHeatStats();
    }
  });

  // Resize canvas when section becomes visible
  document.querySelector('[data-section="heat-map"]')?.addEventListener('click', () => {
    setTimeout(() => heatMap?._resize(), 50);
  });
}

function updateHeatStats() {
  if (!heatMap) return;
  // Count active zones (cells > 5% intensity)
  let activeZones = 0;
  heatMap.grid.forEach(row => row.forEach(v => { if (v > 0.05) activeZones++; }));
  const el = (id) => document.getElementById(id);
  if (el('hstat-zones'))   el('hstat-zones').textContent   = activeZones;
  if (el('hstat-cameras')) el('hstat-cameras').textContent = heatMap.cameraZoneMap.size;
  if (el('hstat-peak'))    el('hstat-peak').textContent    = `${Math.round(heatMap.peakTemp * 100)}%`;
}

// Feed fire/smoke detection events into the heat map
socket.on('detection_event', (event) => {
  if (!heatMap) return;
  if (!['fire_safety'].includes(event.module)) return;
  heatMap.addDetection({
    cameraId: event.camera_id || 'unknown',
    confidence: event.confidence || 0.5,
    eventType: event.event_type,
  });
  heatDetectionCount++;
  const el = document.getElementById('hstat-last');
  if (el) el.textContent = new Date().toLocaleTimeString();
  updateHeatStats();
});

// Also feed historical cameras into the zone map when loaded
function registerCamerasWithHeatMap(cameras) {
  if (!heatMap || !Array.isArray(cameras)) return;
  cameras.forEach((cam) => heatMap.registerCamera(cam.id, cam.zone || ''));
  updateHeatStats();
}

// Initialise heat map once connected and load history
socket.on('connected', () => {
  initHeatMap();
  if (heatMap) {
    heatMap.loadHistory(FARM_ID).then(() => updateHeatStats());
    // Pre-load cameras so zones are mapped
    fetch(`/api/cameras?farmId=${FARM_ID}`)
      .then((r) => r.json())
      .then((cams) => registerCamerasWithHeatMap(cams))
      .catch(() => {});
  }
});

// ── Camera Registration Modal ─────────────────────────────────
const modal      = document.getElementById('camera-modal');
const openBtn    = document.getElementById('add-camera-btn');
const closeBtn   = document.getElementById('modal-close-btn');
const cancelBtn  = document.getElementById('modal-cancel-btn');
const camForm    = document.getElementById('add-camera-form');
const camError   = document.getElementById('cam-error');
const submitBtn  = document.getElementById('cam-submit-btn');

function openModal() {
  camForm.reset();
  camError.className = 'form-error';
  submitBtn.disabled = false;
  submitBtn.className = 'btn-submit';
  submitBtn.textContent = '✔ Register Camera';
  modal.style.display = 'flex';
  document.getElementById('cam-name').focus();
}

function closeModal() {
  modal.style.display = 'none';
}

openBtn?.addEventListener('click', openModal);
closeBtn?.addEventListener('click', closeModal);
cancelBtn?.addEventListener('click', closeModal);

// Close on backdrop click
modal?.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

// Escape key closes modal
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

camForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  camError.className = 'form-error';

  const name      = document.getElementById('cam-name').value.trim();
  const streamUrl = document.getElementById('cam-url').value.trim();
  const zone      = document.getElementById('cam-zone').value.trim();
  const id        = document.getElementById('cam-id').value.trim();

  if (!name || !streamUrl) {
    camError.textContent = 'Camera name and stream URL are required.';
    camError.className = 'form-error visible';
    return;
  }

  submitBtn.disabled = true;
  submitBtn.className = 'btn-submit loading';
  submitBtn.textContent = 'Registering…';

  try {
    const res = await fetch('/api/cameras', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id || undefined, farmId: FARM_ID, name, streamUrl, zone: zone || undefined }),
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || `Server error ${res.status}`);
    }

    // Success — add tile and update stats
    closeModal();
    document.getElementById('camera-empty')?.remove();
    ensureTile(data.id, data);

    // Refresh camera count
    const tot = document.getElementById('stat-cameras-total');
    const onl = document.getElementById('stat-cameras-online');
    if (tot) tot.textContent = parseInt(tot.textContent || '0') + 1;

  } catch (err) {
    camError.textContent = err.message;
    camError.className = 'form-error visible';
    submitBtn.disabled = false;
    submitBtn.className = 'btn-submit';
    submitBtn.textContent = '✔ Register Camera';
  }
});

// ── Updated ensureTile with delete button ─────────────────────
// Override the earlier ensureTile to add delete functionality
function ensureTile(cameraId, camData = {}) {
  if (cameraTiles.has(cameraId)) return cameraTiles.get(cameraId);

  const grid = document.getElementById('camera-grid');
  grid.querySelector('.empty-card')?.remove();

  const tile = document.createElement('div');
  tile.className = 'camera-tile';
  tile.id = `tile-${cameraId}`;
  tile.innerHTML = `
    <img id="img-${cameraId}" alt="${camData.name || cameraId}" />
    <div class="tile-actions">
      <button class="tile-del-btn" data-id="${cameraId}" title="Remove camera">🗑 Remove</button>
    </div>
    <div class="label">
      <span><span class="status-dot ${camData.status === 'online' ? 'online' : 'offline'}"></span>${camData.name || cameraId}</span>
      <span style="font-size:10px;color:var(--text-muted)">${camData.zone || ''}</span>
    </div>`;
  grid.appendChild(tile);

  // Delete handler
  tile.querySelector('.tile-del-btn').addEventListener('click', async () => {
    if (!confirm(`Remove camera "${camData.name || cameraId}" from the farm?`)) return;
    try {
      const res = await fetch(`/api/cameras/${cameraId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error);
      tile.remove();
      cameraTiles.delete(cameraId);
      // Update count
      const tot = document.getElementById('stat-cameras-total');
      if (tot) tot.textContent = Math.max(0, parseInt(tot.textContent || '0') - 1);
      // Show empty state if no cameras left
      if (cameraTiles.size === 0) {
        const grid = document.getElementById('camera-grid');
        grid.innerHTML = `<div class="empty-card" id="camera-empty">
          <div class="empty-icon">📷</div>
          <p class="empty-title">No cameras registered yet</p>
          <p class="empty-hint">Click <strong>+ Add Camera</strong> above to register your first ESP32-CAM</p>
        </div>`;
      }
    } catch (err) {
      alert('Could not remove camera: ' + err.message);
    }
  });

  const img = tile.querySelector('img');
  cameraTiles.set(cameraId, img);
  return img;
}

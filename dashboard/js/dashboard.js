const FARM_ID = 'default'; // Phase 1: single farm. Multi-farm selector comes in Phase 4.
const socket = new FireEyesSocket(FARM_ID);
const cameraTiles = new Map(); // cameraId -> <img> element

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
});

socket.on('connected', () => {
  fetch(`/health`).then((r) => r.json()).then((h) => {
    document.getElementById('mode-badge').textContent = `mode: ${h.mode}`;
  });
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

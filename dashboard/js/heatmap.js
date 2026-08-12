/**
 * AgriEyes AI — Heat Signature Map
 *
 * Renders a thermal/heat-distribution overlay on a canvas grid.
 * Data comes from:
 *   1. Detection events (fire/smoke/high-temp zones) — pushed via WebSocket
 *   2. GET /api/heatmap?farmId=xxx — aggregated historical heat points
 *
 * The map represents a top-down view of the farm, divided into a grid.
 * Each cell's intensity is driven by recent fire/smoke detection confidence
 * values from each camera's zone, decaying over time to show "cooling".
 */

class HeatSignatureMap {
  constructor(canvasId, options = {}) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.cols = options.cols || 20;
    this.rows = options.rows || 12;
    this.decayRate = options.decayRate || 0.97; // per-second decay factor
    this.grid = Array.from({ length: this.rows }, () => new Float32Array(this.cols));
    this.cameraZoneMap = new Map(); // cameraId → {col, row}
    this.animFrame = null;
    this.lastTick = Date.now();
    this.peakTemp = 0;

    // Colour stops: cold→warm→hot (blue→cyan→green→yellow→orange→red)
    this.colorStops = [
      { t: 0.00, r: 10,  g: 15,  b: 40  },
      { t: 0.15, r: 20,  g: 60,  b: 120 },
      { t: 0.35, r: 30,  g: 160, b: 80  },
      { t: 0.55, r: 220, g: 200, b: 20  },
      { t: 0.75, r: 255, g: 120, b: 10  },
      { t: 1.00, r: 255, g: 30,  b: 10  },
    ];

    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    if (!this.canvas) return;
    const container = this.canvas.parentElement;
    if (!container) return;
    this.canvas.width  = container.clientWidth  || 800;
    this.canvas.height = container.clientHeight || 320;
  }

  /** Map a camera to a grid cell based on its registered zone name */
  registerCamera(cameraId, zone) {
    // Parse zone hints: "North field" → top half, "South field" → bottom half, etc.
    const zoneLower = (zone || '').toLowerCase();
    let col = Math.floor(this.cols / 2);
    let row = Math.floor(this.rows / 2);

    if (zoneLower.includes('north'))  row = Math.floor(this.rows * 0.15);
    if (zoneLower.includes('south'))  row = Math.floor(this.rows * 0.85);
    if (zoneLower.includes('east'))   col = Math.floor(this.cols * 0.85);
    if (zoneLower.includes('west'))   col = Math.floor(this.cols * 0.15);
    if (zoneLower.includes('center') || zoneLower.includes('centre')) {
      col = Math.floor(this.cols / 2); row = Math.floor(this.rows / 2);
    }
    if (zoneLower.includes('barn'))   { col = Math.floor(this.cols * 0.7); row = Math.floor(this.rows * 0.7); }
    if (zoneLower.includes('gate'))   { col = Math.floor(this.cols * 0.1); row = Math.floor(this.rows * 0.9); }

    this.cameraZoneMap.set(cameraId, { col: Math.min(col, this.cols - 1), row: Math.min(row, this.rows - 1) });
  }

  /** Inject a heat point from a detection event */
  addDetection({ cameraId, confidence, eventType }) {
    const zone = this.cameraZoneMap.get(cameraId);
    const intensity = Math.min((confidence || 0.5) * (eventType === 'fire' ? 1.0 : 0.65), 1.0);

    if (zone) {
      this._splat(zone.col, zone.row, intensity, 3);
    } else {
      // Camera not mapped yet — pick a pseudo-random but stable cell
      const h = [...cameraId].reduce((a, c) => a + c.charCodeAt(0), 0);
      this._splat(h % this.cols, (h >> 4) % this.rows, intensity, 2);
    }
    this.peakTemp = Math.max(this.peakTemp, intensity);
  }

  /** Add a Gaussian "splat" of heat centred at (cx, cy) */
  _splat(cx, cy, intensity, radius) {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const dist = Math.sqrt((c - cx) ** 2 + (r - cy) ** 2);
        if (dist > radius * 2) continue;
        const weight = Math.exp(-(dist * dist) / (radius * radius));
        this.grid[r][c] = Math.min(1, this.grid[r][c] + intensity * weight);
      }
    }
  }

  /** Apply time-based decay to the whole grid */
  _decay() {
    const now = Date.now();
    const dt  = (now - this.lastTick) / 1000;
    this.lastTick = now;
    let peak = 0;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        this.grid[r][c] = Math.max(0, this.grid[r][c] * Math.pow(this.decayRate, dt * 10));
        if (this.grid[r][c] > peak) peak = this.grid[r][c];
      }
    }
    this.peakTemp = peak;
  }

  /** Map intensity [0-1] to RGBA colour using the gradient stops */
  _colorAt(t) {
    const stops = this.colorStops;
    for (let i = 1; i < stops.length; i++) {
      if (t <= stops[i].t) {
        const prev = stops[i - 1];
        const curr = stops[i];
        const f = (t - prev.t) / (curr.t - prev.t);
        return [
          Math.round(prev.r + (curr.r - prev.r) * f),
          Math.round(prev.g + (curr.g - prev.g) * f),
          Math.round(prev.b + (curr.b - prev.b) * f),
        ];
      }
    }
    return [255, 30, 10];
  }

  /** Draw the heat map onto the canvas */
  _draw() {
    if (!this.ctx) return;
    const { width, height } = this.canvas;
    const cellW = width  / this.cols;
    const cellH = height / this.rows;

    // Clear
    this.ctx.clearRect(0, 0, width, height);

    // Draw cells with blur effect using multiple overlapping circles
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const val = this.grid[r][c];
        if (val < 0.005) continue;

        const x = c * cellW + cellW / 2;
        const y = r * cellH + cellH / 2;
        const radius = Math.max(cellW, cellH) * 1.2;
        const [red, green, blue] = this._colorAt(val);

        const grad = this.ctx.createRadialGradient(x, y, 0, x, y, radius);
        grad.addColorStop(0,   `rgba(${red},${green},${blue},${val * 0.85})`);
        grad.addColorStop(0.5, `rgba(${red},${green},${blue},${val * 0.4})`);
        grad.addColorStop(1,   `rgba(${red},${green},${blue},0)`);

        this.ctx.beginPath();
        this.ctx.arc(x, y, radius, 0, Math.PI * 2);
        this.ctx.fillStyle = grad;
        this.ctx.fill();
      }
    }

    // Draw camera zone markers
    this.cameraZoneMap.forEach(({ col, row }, camId) => {
      const x = col * cellW + cellW / 2;
      const y = row * cellH + cellH / 2;
      const intensity = this.grid[row]?.[col] || 0;
      const [red, green, blue] = this._colorAt(Math.max(0.05, intensity));

      // Outer ring
      this.ctx.beginPath();
      this.ctx.arc(x, y, 10, 0, Math.PI * 2);
      this.ctx.strokeStyle = `rgb(${red},${green},${blue})`;
      this.ctx.lineWidth = 2;
      this.ctx.stroke();

      // Camera icon dot
      this.ctx.beginPath();
      this.ctx.arc(x, y, 4, 0, Math.PI * 2);
      this.ctx.fillStyle = `rgb(${red},${green},${blue})`;
      this.ctx.fill();

      // Label
      this.ctx.font = '10px Inter, sans-serif';
      this.ctx.fillStyle = 'rgba(255,255,255,0.8)';
      this.ctx.textAlign = 'center';
      this.ctx.fillText(camId.replace(/cam-?/i, '').substring(0, 12), x, y + 22);
    });

    // Grid overlay (subtle)
    this.ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    this.ctx.lineWidth = 0.5;
    for (let c = 0; c <= this.cols; c++) {
      this.ctx.beginPath();
      this.ctx.moveTo(c * cellW, 0);
      this.ctx.lineTo(c * cellW, height);
      this.ctx.stroke();
    }
    for (let r = 0; r <= this.rows; r++) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, r * cellH);
      this.ctx.lineTo(width, r * cellH);
      this.ctx.stroke();
    }

    // Compass
    this._drawCompass(width - 36, 36);
    // Peak temperature indicator
    this._drawPeakIndicator(width);
  }

  _drawCompass(x, y) {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = 'bold 10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText('N', x, y - 14);
    ctx.fillText('S', x, y + 20);
    ctx.fillText('W', x - 16, y + 4);
    ctx.fillText('E', x + 16, y + 4);

    ctx.beginPath();
    ctx.arc(x, y, 12, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  _drawPeakIndicator(width) {
    const ctx = this.ctx;
    const pct = Math.round(this.peakTemp * 100);
    const label = pct > 70 ? '🔴 HIGH' : pct > 40 ? '🟠 MEDIUM' : pct > 10 ? '🟡 LOW' : '🟢 CLEAR';
    ctx.save();
    ctx.font = '11px Inter, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.textAlign = 'right';
    ctx.fillText(`Peak: ${pct}% · ${label}`, width - 12, this.canvas.height - 10);
    ctx.restore();
  }

  /** Main animation loop */
  start() {
    const loop = () => {
      this._decay();
      this._draw();
      this.animFrame = requestAnimationFrame(loop);
    };
    this.animFrame = requestAnimationFrame(loop);
  }

  stop() {
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
  }

  /** Load historical detections to pre-warm the map */
  async loadHistory(farmId = 'default') {
    try {
      const res = await fetch(`/api/events?farmId=${farmId}&module=fire_safety&limit=50`);
      const events = await res.json();
      if (!Array.isArray(events)) return;
      events.forEach((e) => this.addDetection({
        cameraId: e.camera_id || 'unknown',
        confidence: (e.confidence || 0.3) * 0.4, // damped — old history shouldn't dominate
        eventType: e.event_type,
      }));
    } catch (e) {
      console.warn('[heatmap] Could not load history:', e.message);
    }
  }
}

// Export for use in dashboard.js
window.HeatSignatureMap = HeatSignatureMap;

/**
 * AgriEyes WS Client — with automatic polling fallback.
 *
 * In production (Vercel serverless) WebSockets are not supported.
 * The client detects this and falls back to polling /api/events,
 * /api/alerts, /api/sensors/latest and /api/heatmap every 5 seconds.
 *
 * Emits the same events as the WebSocket version so dashboard.js
 * works identically in both modes.
 */
class AgriEyesSocket {
  constructor(farmId = 'default') {
    this.farmId   = farmId;
    this.handlers = {};
    this._polling = false;
    this._pollTimer = null;

    // Register all known event types
    ['frame','detection_event','alert','connected','status',
     'growth_observation','disease_observation','sensor_reading',
     'irrigation_event','error'].forEach(t => (this.handlers[t] = []));

    this._tryWebSocket();
  }

  // ── WebSocket attempt ───────────────────────────────────────
  _tryWebSocket() {
    try {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      this.ws = new WebSocket(`${proto}://${location.host}/ws?farmId=${this.farmId}`);

      this.ws.onopen = () => {
        this._polling = false;
        clearInterval(this._pollTimer);
        this._emit('status', 'online');
        this._emit('connected');
        console.log('[ws] Connected via WebSocket');
      };

      this.ws.onclose = () => {
        this._emit('status', 'offline');
        // Try to reconnect; fall back to polling after 3 failed attempts
        if (this._wsRetries === undefined) this._wsRetries = 0;
        this._wsRetries++;
        if (this._wsRetries <= 3) {
          setTimeout(() => this._tryWebSocket(), 2000);
        } else {
          console.log('[ws] WebSocket unavailable — switching to polling mode');
          this._startPolling();
        }
      };

      this.ws.onerror = () => this.ws.close();

      this.ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          this._emit(msg.type, msg.data);
        } catch (e) {
          console.error('[ws] bad message', e);
        }
      };
    } catch (e) {
      // WebSocket not available at all (e.g. Vercel preview)
      this._startPolling();
    }
  }

  // ── Polling fallback ────────────────────────────────────────
  _startPolling() {
    if (this._polling) return;
    this._polling = true;
    this._emit('status', 'online');   // REST is always "online"
    this._emit('connected');
    console.log('[ws] Polling mode active (5s interval)');
    this._poll();
    this._pollTimer = setInterval(() => this._poll(), 5000);
  }

  async _poll() {
    const fid = encodeURIComponent(this.farmId);
    try {
      // Events (fire safety)
      const [evts, alerts, sensors] = await Promise.all([
        fetch(`/api/events?farmId=${fid}&module=fire_safety&limit=5`).then(r => r.json()),
        fetch(`/api/alerts?farmId=${fid}&limit=10`).then(r => r.json()),
        fetch(`/api/sensors/latest?farmId=${fid}`).then(r => r.json()),
      ]);

      const now = Date.now();
      // Only emit events/alerts newer than last poll
      if (Array.isArray(evts)) {
        evts.forEach(e => {
          const age = now - new Date(e.created_at).getTime();
          if (age < 6000) this._emit('detection_event', e);
        });
      }
      if (Array.isArray(alerts)) {
        alerts.forEach(a => {
          const age = now - new Date(a.created_at).getTime();
          if (age < 6000) this._emit('alert', a);
        });
      }
      if (Array.isArray(sensors) && sensors.length) {
        this._emit('sensor_reading', sensors);
      }
    } catch (e) {
      console.warn('[poll] fetch error', e.message);
    }
  }

  on(type, cb) {
    (this.handlers[type] ||= []).push(cb);
    return this; // chainable
  }

  _emit(type, data) {
    (this.handlers[type] || []).forEach(cb => {
      try { cb(data); } catch(e) { console.error('[ws] handler error', e); }
    });
  }

  /** Manual disconnect / cleanup */
  disconnect() {
    clearInterval(this._pollTimer);
    this.ws?.close();
  }
}

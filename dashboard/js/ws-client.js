// Minimal WS client with auto-reconnect. Emits events via a plain callback map
// so dashboard.js doesn't need any framework to consume live data.
class AgriEyesSocket {
  constructor(farmId = 'default') {
    this.farmId = farmId;
    this.handlers = { frame: [], detection_event: [], alert: [], connected: [], status: [] };
    this.connect();
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/ws?farmId=${this.farmId}`);

    this.ws.onopen = () => this._emit('status', 'online');
    this.ws.onclose = () => {
      this._emit('status', 'offline');
      setTimeout(() => this.connect(), 2000); // auto-reconnect
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
  }

  on(type, cb) {
    (this.handlers[type] ||= []).push(cb);
  }

  _emit(type, data) {
    (this.handlers[type] || []).forEach((cb) => cb(data));
  }
}

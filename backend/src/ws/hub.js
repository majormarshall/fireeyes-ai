const { WebSocketServer } = require('ws');

// Rooms: dashboard clients subscribe to a farm's channel.
// Any part of the backend can call broadcast() to push data to that farm's
// connected dashboards without touching HTTP at all.
class Hub {
  constructor() {
    this.wss = null;
    this.clientsByFarm = new Map(); // farmId -> Set<ws>
  }

  attach(server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws, req) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const farmId = url.searchParams.get('farmId') || 'default';

      if (!this.clientsByFarm.has(farmId)) {
        this.clientsByFarm.set(farmId, new Set());
      }
      this.clientsByFarm.get(farmId).add(ws);

      ws.on('close', () => {
        this.clientsByFarm.get(farmId)?.delete(ws);
      });

      ws.send(JSON.stringify({ type: 'connected', farmId }));
    });

    console.log('[ws] Hub attached at /ws');
  }

  // type: 'frame' | 'detection_event' | 'alert' | 'camera_status'
  broadcast(farmId, type, data) {
    const clients = this.clientsByFarm.get(farmId);
    if (!clients || clients.size === 0) return;

    const message = JSON.stringify({ type, data, ts: Date.now() });
    for (const ws of clients) {
      if (ws.readyState === ws.OPEN) ws.send(message);
    }
  }
}

module.exports = new Hub();

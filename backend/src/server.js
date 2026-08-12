const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const config = require('./config');
const hub = require('./ws/hub');

const camerasRoute   = require('./routes/cameras');
const streamRoute    = require('./routes/stream');
const eventsRoute    = require('./routes/events');
const cropRoute      = require('./routes/crop');
const sensorsRoute   = require('./routes/sensors');
const irrigationRoute = require('./routes/irrigation');
const heatmapRoute   = require('./routes/heatmap');
const scheduler      = require('./services/scheduler');

const app = express();

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors());
app.use(morgan(config.env === 'development' ? 'dev' : 'combined'));
app.use(express.json({ limit: '2mb' }));

app.get('/health', (req, res) => {
  res.json({ ok: true, mode: config.mode, time: new Date().toISOString() });
});

app.use('/api/cameras', camerasRoute);
app.use('/api/stream',  streamRoute);
app.use('/api',         eventsRoute);    // /api/events and /api/alerts
app.use('/api',         cropRoute);      // /api/crop-growth and /api/disease
app.use('/api',         sensorsRoute);   // /api/sensors/*
app.use('/api',         irrigationRoute); // /api/irrigation/*
app.use('/api',         heatmapRoute);   // /api/heatmap

// Serve the dashboard as static files (simple HTML/CSS/JS per Phase 1 stack)
app.use('/', express.static(require('path').join(__dirname, '../../dashboard')));

// Serve recorded event clips (frame sequences + manifest.json per event)
app.use('/recordings', express.static(require('path').join(__dirname, '../storage/recordings')));

app.use((err, req, res, next) => {
  console.error('[server] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const server = http.createServer(app);
hub.attach(server);

server.listen(config.port, () => {
  console.log(`[server] AgriEyes AI backend running in ${config.mode.toUpperCase()} mode on port ${config.port}`);
  console.log(`[server] Dashboard:    http://localhost:${config.port}/`);
  console.log(`[server] Health check: http://localhost:${config.port}/health`);
  console.log(`[server] WS endpoint:  ws://localhost:${config.port}/ws?farmId=<id>`);
  scheduler.start();
});

'use strict';
/**
 * app.js — Pure Express application (no server.listen).
 * Used by:
 *   - server.js (local dev, wraps with http.createServer + WebSocket hub)
 *   - api/index.js (Vercel serverless, exported directly as a handler)
 */
// Load .env in dev (silently ignored on Vercel where env vars come from dashboard)
try { require('dotenv').config(); } catch (_) {}

const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const morgan  = require('morgan');
const path    = require('path');

const config = require('./config');

const camerasRoute    = require('./routes/cameras');
const streamRoute     = require('./routes/stream');
const eventsRoute     = require('./routes/events');
const cropRoute       = require('./routes/crop');
const sensorsRoute    = require('./routes/sensors');
const irrigationRoute = require('./routes/irrigation');
const heatmapRoute    = require('./routes/heatmap');

const app = express();

// ── Security & middleware ─────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: false,
  contentSecurityPolicy: false, // relaxed for dashboard scripts
}));
app.use(cors());
app.use(morgan(config.env === 'development' ? 'dev' : 'combined'));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));

// ── Health ────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    mode: config.mode,
    time: new Date().toISOString(),
    region: process.env.VERCEL_REGION || 'local',
  });
});

// ── API routes ────────────────────────────────────────────────
app.use('/api/cameras',   camerasRoute);
app.use('/api/stream',    streamRoute);
app.use('/api',           eventsRoute);      // /api/events  /api/alerts
app.use('/api',           cropRoute);        // /api/crop-growth  /api/disease
app.use('/api',           sensorsRoute);     // /api/sensors/*
app.use('/api',           irrigationRoute);  // /api/irrigation/*
app.use('/api',           heatmapRoute);     // /api/heatmap

// ── Static dashboard (local dev only; Vercel serves from dashboard/) ──
if (config.env !== 'production') {
  const staticOpts = {
    etag: false,
    lastModified: false,
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
  };
  app.use('/', express.static(path.join(__dirname, '../../dashboard'), staticOpts));
  app.use('/recordings', express.static(path.join(__dirname, '../storage/recordings'), staticOpts));
}

// ── 404 catch-all for /api/* ──────────────────────────────────
app.use('/api', (req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

// ── Global error handler ──────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[server] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;

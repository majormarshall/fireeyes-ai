'use strict';
/**
 * server.js — Local development entry point.
 * Creates an HTTP server, attaches the WebSocket hub, and listens on PORT.
 * On Vercel this file is NOT used — api/index.js is used instead.
 */
require('dotenv').config();

const http      = require('http');
const app       = require('./app');
const config    = require('./config');
const hub       = require('./ws/hub');
const scheduler = require('./services/scheduler');

const server = http.createServer(app);
hub.attach(server);

server.listen(config.port, () => {
  console.log(`[server] AgriEyes AI backend running in ${config.mode.toUpperCase()} mode on port ${config.port}`);
  console.log(`[server] Dashboard:    http://localhost:${config.port}/`);
  console.log(`[server] Health check: http://localhost:${config.port}/health`);
  console.log(`[server] WS endpoint:  ws://localhost:${config.port}/ws?farmId=<id>`);
  scheduler.start();
});

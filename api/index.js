/**
 * Vercel serverless entry point.
 * Wraps the Express app so Vercel can call it as a function.
 * WebSocket support is NOT available on Vercel — the ws-client.js
 * automatically falls back to long-polling in production.
 */
'use strict';

// Load env from root .env when running locally via `vercel dev`
require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') });

const app = require('../backend/src/app');

module.exports = app;

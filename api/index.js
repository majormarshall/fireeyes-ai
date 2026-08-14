/**
 * Vercel serverless entry point.
 * Wraps the Express app so Vercel can call it as a function per-request.
 *
 * File layout on Vercel:
 *   /api/index.js          ← this file
 *   /backend/src/app.js    ← Express app (no server.listen)
 *   /backend/.env          ← NOT deployed (env vars set in Vercel dashboard)
 */
'use strict';

const app = require('../backend/src/app');

// Vercel calls module.exports as (req, res) → Express handles it
module.exports = app;

const { Pool } = require('pg');
const config = require('./index');

// Supabase (and most hosted Postgres) requires SSL.
// When DATABASE_URL contains "supabase.co" or NODE_ENV is production we
// enable SSL but disable certificate verification (rejectUnauthorized: false)
// so self-signed certs on hosted providers don't block the connection.
const isHosted =
  (config.databaseUrl || '').includes('supabase') ||
  (config.databaseUrl || '').includes('supabase.co') ||
  process.env.NODE_ENV === 'production';

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: isHosted ? { rejectUnauthorized: false } : false,
});

pool.on('connect', () => {
  console.log(`[db] Connected to ${isHosted ? 'Supabase/hosted' : 'local'} PostgreSQL`);
});

pool.on('error', (err) => {
  console.error('[db] Unexpected error on idle client', err.message);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};

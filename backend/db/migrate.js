// Applies schema.sql to whatever DATABASE_URL points to.
// Works for both Cloud (hosted Postgres/Supabase) and Edge (local Postgres).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  console.log('[migrate] Applying schema.sql ...');
  await pool.query(schema);
  console.log('[migrate] Done.');
  await pool.end();
}

main().catch((err) => {
  console.error('[migrate] Failed:', err);
  process.exit(1);
});

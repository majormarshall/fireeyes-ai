/**
 * AgriEyes AI — Database adapter (Supabase JS client)
 *
 * Uses @supabase/supabase-js which connects via PostgREST (HTTPS REST API).
 * No direct PostgreSQL / connection pooler needed — works with SUPABASE_URL
 * and either SUPABASE_SERVICE_KEY (preferred, bypasses RLS) or SUPABASE_ANON_KEY.
 *
 * Also exposes a pg-compatible query(sql, params) wrapper so existing models
 * that call db.query() keep working without modification.
 */
require('dotenv').config();
const config = require('./index');
const { createClient } = require('@supabase/supabase-js');

const { url, anonKey, serviceKey } = config.supabase;

if (!url || (!anonKey && !serviceKey)) {
  console.warn('[db] ⚠️  SUPABASE_URL / SUPABASE_ANON_KEY not set. DB calls will fail gracefully.');
}

// Prefer service key (bypasses RLS, safe for server-side use).
// Fall back to anon key if service key not provided.
const activeKey = serviceKey || anonKey;

const supabase = url && activeKey
  ? createClient(url, activeKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

if (supabase) {
  const keyType = serviceKey ? 'service role key (RLS bypassed)' : 'anon key (RLS active)';
  console.log(`[db] ✅ Supabase JS client ready — ${keyType}`);
} else {
  console.warn('[db] ⚠️  Supabase client not initialised — set SUPABASE_URL + SUPABASE_ANON_KEY in .env');
}

// ── pg-compatible query() wrapper ─────────────────────────────────────────────
// Translates the SQL query patterns used in our models into Supabase JS calls.
async function query(text, params = []) {
  if (!supabase) throw new Error('[db] No database configured. Set SUPABASE_URL + SUPABASE_ANON_KEY in .env');
  return supabaseQuery(supabase, text.replace(/\s+/g, ' ').trim(), params);
}

async function supabaseQuery(sb, sql, params) {

  // ── INSERT … VALUES … [ON CONFLICT …] RETURNING * ────────────────────────
  const insertMatch = sql.match(/^INSERT INTO (\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)([\s\S]*?)RETURNING \*/i);
  if (insertMatch) {
    const table = insertMatch[1];
    const cols  = insertMatch[2].split(',').map(c => c.trim());
    const rest  = insertMatch[4] || '';
    const row   = {};
    cols.forEach((c, i) => { row[c] = params[i] ?? null; });

    let req;
    if (/ON CONFLICT.+DO NOTHING/i.test(rest)) {
      req = sb.from(table).upsert(row, { onConflict: cols[0], ignoreDuplicates: true }).select();
    } else if (/ON CONFLICT.+DO UPDATE/i.test(rest)) {
      req = sb.from(table).upsert(row).select();
    } else {
      req = sb.from(table).insert(row).select();
    }
    const { data, error } = await req;
    if (error) throw new Error(`[db] insert ${table}: ${error.message}`);
    return { rows: data || [] };
  }

  // ── UPDATE … SET … WHERE id = $n ─────────────────────────────────────────
  const updateMatch = sql.match(/^UPDATE (\w+) SET (.+?) WHERE (\w+)\s*=\s*\$(\d+)/i);
  if (updateMatch) {
    const table    = updateMatch[1];
    const setCl    = updateMatch[2];
    const whereCol = updateMatch[3];
    const whereVal = params[parseInt(updateMatch[4]) - 1];
    const setObj   = {};
    setCl.split(',').forEach(pair => {
      const [col, ref] = pair.split('=').map(s => s.trim());
      const idx = parseInt((ref.match(/\$(\d+)/) || [, 0])[1]) - 1;
      if (idx >= 0) setObj[col] = params[idx];
    });
    const { error } = await sb.from(table).update(setObj).eq(whereCol, whereVal);
    if (error) throw new Error(`[db] update ${table}: ${error.message}`);
    return { rows: [] };
  }

  // ── SELECT … FROM table [WHERE …] [ORDER BY …] [LIMIT $n] ────────────────
  const selectMatch = sql.match(/^SELECT .+ FROM (\w+)(?:\s+WHERE (.+?))?(?:\s+ORDER BY (.+?))?(?:\s+LIMIT \$(\d+))?$/i);
  if (selectMatch) {
    const table    = selectMatch[1];
    const whereSql = selectMatch[2] || '';
    const orderSql = selectMatch[3] || '';
    const limitIdx = selectMatch[4] ? parseInt(selectMatch[4]) - 1 : null;

    let req = sb.from(table).select('*');

    // WHERE col = $n [AND col2 = $m …]
    if (whereSql) {
      whereSql.split(/\s+AND\s+/i).forEach(cond => {
        const m = cond.trim().match(/(\w+)\s*=\s*\$(\d+)/i);
        if (m) req = req.eq(m[1], params[parseInt(m[2]) - 1]);
      });
    }

    // ORDER BY col [ASC|DESC] [, …]
    if (orderSql) {
      orderSql.split(',').forEach(part => {
        const om = part.trim().match(/^(\w+)(?:\s+(ASC|DESC))?/i);
        if (om) req = req.order(om[1], { ascending: (om[2] || 'ASC').toUpperCase() === 'ASC' });
      });
    }

    if (limitIdx !== null && params[limitIdx] !== undefined) {
      req = req.limit(parseInt(params[limitIdx]));
    }

    const { data, error } = await req;
    if (error) throw new Error(`[db] select ${table}: ${error.message}`);
    return { rows: data || [] };
  }

  // ── DDL / unsupported — skip gracefully ──────────────────────────────────
  if (/^(CREATE|DROP|ALTER|GRANT|COMMENT)/i.test(sql)) {
    console.warn('[db] DDL skipped (run schema.sql in Supabase SQL Editor):', sql.slice(0, 70));
    return { rows: [] };
  }

  throw new Error('[db] Unsupported SQL pattern for Supabase adapter: ' + sql.slice(0, 100));
}

module.exports = { query, supabase };

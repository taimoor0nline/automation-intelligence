const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL || '';
const required = String(process.env.DATABASE_REQUIRED || '').toLowerCase() === 'true';
let pool = null;

function isConfigured() { return Boolean(connectionString); }
function isRequired() { return required; }
function getPool() {
  if (!isConfigured()) {
    if (required) throw new Error('DATABASE_URL is required but not configured.');
    return null;
  }
  if (!pool) {
    pool = new Pool({
      connectionString,
      max: Number(process.env.DATABASE_POOL_MAX || 10),
      ssl: String(process.env.DATABASE_SSL || '').toLowerCase() === 'true' ? { rejectUnauthorized: false } : undefined,
    });
    pool.on('error', (err) => console.error('[postgres] pool error', err));
  }
  return pool;
}

async function query(text, params = []) {
  const p = getPool();
  if (!p) return { rows: [], rowCount: 0, disabled: true };
  return p.query(text, params);
}

async function withTransaction(work) {
  const p = getPool();
  if (!p) return null;
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function health() {
  if (!isConfigured()) return { configured: false, required };
  try {
    const result = await query('select now() as now');
    return { configured: true, connected: true, required, serverTime: result.rows[0]?.now || null };
  } catch (err) {
    return { configured: true, connected: false, required, error: err.message };
  }
}

module.exports = { query, withTransaction, health, isConfigured, isRequired, getPool };

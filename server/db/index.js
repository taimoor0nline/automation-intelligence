function envTrue(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['true', '1', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

// PostgreSQL is strictly opt-in. A DATABASE_URL alone must never enable it.
const explicitlyEnabled = envTrue(process.env.DATABASE_ENABLED, false);
const connectionString = process.env.DATABASE_URL || '';
const required = explicitlyEnabled && envTrue(process.env.DATABASE_REQUIRED, false);
const connectionTimeoutMs = Math.max(500, Math.min(Number(process.env.DATABASE_CONNECTION_TIMEOUT_MS || 1500), 10000));
const healthTimeoutMs = Math.max(750, Math.min(Number(process.env.DATABASE_HEALTH_TIMEOUT_MS || 1800), 12000));
let Pool = null;
let pool = null;

function isEnabled() { return explicitlyEnabled; }
function isConfigured() { return explicitlyEnabled && Boolean(connectionString); }
function isRequired() { return required; }

function getPool() {
  // Hard gate: when disabled, do not load pg, create a pool, resolve the host,
  // open a socket, or perform any PostgreSQL network activity.
  if (!explicitlyEnabled) return null;
  if (!isConfigured()) {
    if (required) throw new Error('DATABASE_URL is required because DATABASE_ENABLED=true and DATABASE_REQUIRED=true.');
    return null;
  }

  if (!Pool) ({ Pool } = require('pg'));
  if (!pool) {
    pool = new Pool({
      connectionString,
      max: Number(process.env.DATABASE_POOL_MAX || 10),
      connectionTimeoutMillis: connectionTimeoutMs,
      ssl: envTrue(process.env.DATABASE_SSL, false) ? { rejectUnauthorized: false } : undefined,
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
  if (!explicitlyEnabled) {
    return {
      enabled: false,
      configured: false,
      connected: false,
      required: false,
      skipped: true,
      reason: 'DATABASE_ENABLED=false',
    };
  }
  if (!isConfigured()) return { enabled: true, configured: false, connected: false, required };

  let timer = null;
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`PostgreSQL health check timed out after ${healthTimeoutMs} ms.`)), healthTimeoutMs);
      timer.unref?.();
    });
    const result = await Promise.race([query('select now() as now'), timeout]);
    return { enabled: true, configured: true, connected: true, required, serverTime: result.rows[0]?.now || null };
  } catch (err) {
    return { enabled: true, configured: true, connected: false, required, error: err.message };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = { query, withTransaction, health, isEnabled, isConfigured, isRequired, getPool };

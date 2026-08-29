const db = require('../db');

let lastRefresh = null;
let source = 'environment';

function boolEnv(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return !['false', '0', 'no', 'off'].includes(String(value).trim().toLowerCase());
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeCapabilities(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => String(item || '').trim().toUpperCase()).filter(Boolean))];
}

function applyExternalAdapter(row) {
  if (!row?.enabled) return;
  const settings = safeObject(row.settings);
  const url = String(settings.url || '').trim();
  if (url) process.env.AUTOMATION_EXTERNAL_ADAPTER_URL = url;
  const capabilities = normalizeCapabilities(settings.capabilities);
  if (capabilities.length) process.env.AUTOMATION_EXTERNAL_CAPABILITIES = capabilities.join(',');
  const secretEnvKey = String(row.secret_env_key || '').trim();
  if (secretEnvKey) {
    process.env.AUTOMATION_EXTERNAL_ADAPTER_TOKEN_ENV = secretEnvKey;
    if (process.env[secretEnvKey]) process.env.AUTOMATION_EXTERNAL_ADAPTER_TOKEN = process.env[secretEnvKey];
  }
}

function applyDatabaseAssertions(row, queries) {
  if (!row?.enabled) return;
  const settings = safeObject(row.settings);
  const connectionEnvKey = String(settings.connectionEnvKey || 'AUTOMATION_DB_ASSERTION_URL').trim();
  const connectionString = String(process.env[connectionEnvKey] || '').trim();
  if (!connectionString) {
    console.warn(`[capabilities] DATABASE_ASSERTIONS enabled in platform DB but ${connectionEnvKey} is empty; keeping DB assertions unavailable.`);
    return;
  }

  const namedQueries = {};
  for (const query of queries || []) {
    if (!query?.enabled) continue;
    namedQueries[String(query.query_name)] = {
      sql: String(query.sql_text || ''),
      params: Array.isArray(query.parameter_keys) ? query.parameter_keys.map(String) : [],
      description: query.description || null,
    };
  }

  process.env.AUTOMATION_DB_ASSERTIONS_ENABLED = 'true';
  process.env.AUTOMATION_DB_ASSERTION_URL = connectionString;
  process.env.AUTOMATION_DB_ASSERTION_QUERIES_JSON = JSON.stringify(namedQueries);
  if (Number.isFinite(Number(settings.timeoutMs))) process.env.AUTOMATION_DB_ASSERTION_TIMEOUT_MS = String(Number(settings.timeoutMs));
}

function applyVisualConfig(row) {
  if (!row?.enabled) return;
  const settings = safeObject(row.settings);
  if (settings.baselineMode) process.env.AUTOMATION_VISUAL_BASELINE_MODE = String(settings.baselineMode);
  if (settings.baselineDir) process.env.AUTOMATION_VISUAL_BASELINE_DIR = String(settings.baselineDir);
}

function applyUploadConfig(row) {
  if (!row?.enabled) return;
  const settings = safeObject(row.settings);
  if (settings.fixtureDir) process.env.AUTOMATION_UPLOAD_FIXTURE_DIR = String(settings.fixtureDir);
}

async function refreshCapabilityConfiguration() {
  if (!db.isEnabled() || !db.isConfigured()) {
    source = 'environment';
    lastRefresh = { source, databaseEnabled: false, refreshedAt: new Date().toISOString() };
    return lastRefresh;
  }

  try {
    const configResult = await db.query('SELECT config_key, enabled, settings, secret_env_key FROM automation_capability_config');
    const queryResult = await db.query('SELECT query_name, sql_text, parameter_keys, description, enabled FROM automation_db_assertion_query WHERE enabled = true');
    const rows = new Map((configResult.rows || []).map((row) => [String(row.config_key || '').toUpperCase(), row]));

    applyExternalAdapter(rows.get('EXTERNAL_ADAPTER'));
    applyDatabaseAssertions(rows.get('DATABASE_ASSERTIONS'), queryResult.rows || []);
    applyVisualConfig(rows.get('VISUAL_REGRESSION'));
    applyUploadConfig(rows.get('FILE_UPLOAD'));

    source = 'database';
    lastRefresh = {
      source,
      databaseEnabled: true,
      refreshedAt: new Date().toISOString(),
      configuredKeys: [...rows.keys()],
      dbAssertionQueryCount: (queryResult.rows || []).length,
    };
    return lastRefresh;
  } catch (err) {
    source = 'environment-fallback';
    lastRefresh = {
      source,
      databaseEnabled: true,
      refreshedAt: new Date().toISOString(),
      error: err.message,
    };
    console.warn(`[capabilities] Could not load DB-backed capability configuration; using environment configuration: ${err.message}`);
    return lastRefresh;
  }
}

function configurationSource() {
  return lastRefresh || { source, databaseEnabled: db.isEnabled(), refreshedAt: null };
}

function visualBaselineMode() {
  const explicit = String(process.env.AUTOMATION_VISUAL_BASELINE_MODE || '').trim().toLowerCase();
  if (['compare', 'create-missing'].includes(explicit)) return explicit;
  return boolEnv(process.env.AUTOMATION_VISUAL_UPDATE_BASELINES, false) ? 'create-missing' : 'compare';
}

module.exports = { refreshCapabilityConfiguration, configurationSource, visualBaselineMode };

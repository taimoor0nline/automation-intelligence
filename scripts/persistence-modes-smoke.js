const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');

function runCase(name, env, source) {
  const result = spawnSync(process.execPath, ['-e', source], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`${name} failed:\n${result.stderr || result.stdout}`);
  }
  return JSON.parse(String(result.stdout || '').trim());
}

const sessionOnly = runCase(
  'session-only mode',
  {
    DATABASE_ENABLED: 'false',
    DATABASE_URL: 'postgresql://should-not-be-used:5432/testnexus',
    DATABASE_REQUIRED: 'true',
  },
  `
  const db = require('./server/db');
  const persistence = require('./server/services/persistenceService');
  const { getSession } = require('./server/data/sessionStore');
  (async () => {
    const beforePg = Object.keys(require.cache).some((key) => /[\\/]node_modules[\\/]pg[\\/]/.test(key));
    const queryResult = await db.query('select 1');
    const health = await db.health();
    const session = getSession('dual-mode-smoke');
    const afterPg = Object.keys(require.cache).some((key) => /[\\/]node_modules[\\/]pg[\\/]/.test(key));
    console.log(JSON.stringify({
      dbEnabled: db.isEnabled(),
      dbConfigured: db.isConfigured(),
      dbRequired: db.isRequired(),
      persistenceEnabled: persistence.enabled(),
      queryDisabled: queryResult.disabled === true,
      healthSkipped: health.skipped === true,
      healthReason: health.reason,
      sessionState: session.state,
      pgLoadedBefore: beforePg,
      pgLoadedAfter: afterPg,
    }));
  })().catch((err) => { console.error(err); process.exit(1); });
  `
);

assert.equal(sessionOnly.dbEnabled, false);
assert.equal(sessionOnly.dbConfigured, false);
assert.equal(sessionOnly.dbRequired, false, 'DATABASE_REQUIRED must not make DB mandatory while DATABASE_ENABLED=false');
assert.equal(sessionOnly.persistenceEnabled, false);
assert.equal(sessionOnly.queryDisabled, true);
assert.equal(sessionOnly.healthSkipped, true);
assert.equal(sessionOnly.healthReason, 'DATABASE_ENABLED=false');
assert.equal(sessionOnly.sessionState, 'IDLE');
assert.equal(sessionOnly.pgLoadedBefore, false);
assert.equal(sessionOnly.pgLoadedAfter, false, 'session-only mode must not load the pg runtime');

const databaseMode = runCase(
  'database mode selection',
  {
    DATABASE_ENABLED: 'true',
    DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/testnexus_mode_smoke',
    DATABASE_REQUIRED: 'false',
  },
  `
  const db = require('./server/db');
  const persistence = require('./server/services/persistenceService');
  console.log(JSON.stringify({
    dbEnabled: db.isEnabled(),
    dbConfigured: db.isConfigured(),
    dbRequired: db.isRequired(),
    persistenceEnabled: persistence.enabled(),
    pgLoaded: Object.keys(require.cache).some((key) => /[\\/]node_modules[\\/]pg[\\/]/.test(key)),
  }));
  `
);

assert.equal(databaseMode.dbEnabled, true);
assert.equal(databaseMode.dbConfigured, true);
assert.equal(databaseMode.dbRequired, false);
assert.equal(databaseMode.persistenceEnabled, true);
assert.equal(databaseMode.pgLoaded, false, 'selecting DB mode must remain lazy until a pool/query is actually requested');

const requiredDatabaseMode = runCase(
  'required database mode selection',
  {
    DATABASE_ENABLED: 'true',
    DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/testnexus_mode_smoke',
    DATABASE_REQUIRED: 'true',
  },
  `
  const db = require('./server/db');
  console.log(JSON.stringify({
    dbEnabled: db.isEnabled(),
    dbConfigured: db.isConfigured(),
    dbRequired: db.isRequired(),
  }));
  `
);

assert.equal(requiredDatabaseMode.dbEnabled, true);
assert.equal(requiredDatabaseMode.dbConfigured, true);
assert.equal(requiredDatabaseMode.dbRequired, true);

console.log('persistence-modes-smoke: PASS (session-only + PostgreSQL opt-in modes)');

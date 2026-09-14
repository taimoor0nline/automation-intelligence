const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { spawn } = require('child_process');
const requestContext = require('./requestContext');

const AUTOMATION_DIR = path.join(__dirname, '..', '..', 'automation-system');
const CYPRESS_BIN = path.join(AUTOMATION_DIR, 'node_modules', 'cypress', 'bin', 'cypress');
const ENGINE_CONFIG = path.join(AUTOMATION_DIR, 'engine.config.js');
const SPEC_RELATIVE = 'tests/e2e/system/browser-discovery.cy.js';
const DISCOVERY_DIR = path.join(AUTOMATION_DIR, 'artifacts', 'discovery');

function boolEnv(value, fallback) {
  if (value == null || value === '') return fallback;
  return !['false', '0', 'no', 'off'].includes(String(value).toLowerCase());
}

function numberEnv(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeToken(value) {
  return String(value || 'discovery').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'discovery';
}

function normalizeSeeds(urls = []) {
  const output = [];
  const seen = new Set();
  for (const raw of urls || []) {
    try {
      const url = new URL(String(raw || ''));
      if (!['http:', 'https:'].includes(url.protocol)) continue;
      url.hash = '';
      const value = url.toString();
      if (!seen.has(value)) { seen.add(value); output.push(value); }
    } catch {}
  }
  return output;
}

function runProcess(args, env, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: AUTOMATION_DIR,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGTERM'); } catch {}
      const error = new Error(`Rendered browser discovery timed out after ${Math.round(timeoutMs / 1000)}s.`);
      error.code = 'BROWSER_DISCOVERY_TIMEOUT';
      reject(error);
    }, timeoutMs);
    timer.unref?.();

    child.stdout.on('data', (chunk) => { stdout += String(chunk); if (stdout.length > 12000) stdout = stdout.slice(-12000); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); if (stderr.length > 12000) stderr = stderr.slice(-12000); });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

async function discoverRenderedPages(urls = [], options = {}) {
  const seeds = normalizeSeeds(urls);
  if (!seeds.length) return [];
  const enabled = boolEnv(process.env.CYPRESS_RENDERED_DISCOVERY, true);
  if (!enabled) return [];
  if (!fs.existsSync(CYPRESS_BIN)) {
    const error = new Error('Cypress runtime is not installed in automation-system; rendered web discovery is unavailable.');
    error.code = 'BROWSER_DISCOVERY_RUNTIME_MISSING';
    throw error;
  }

  fs.mkdirSync(DISCOVERY_DIR, { recursive: true });
  const context = requestContext.current();
  const token = `${safeToken(context.sessionId)}-${randomUUID().slice(0, 8)}`;
  const outputRelative = `artifacts/discovery/${token}.json`;
  const outputAbsolute = path.join(AUTOMATION_DIR, outputRelative);
  const resultFile = path.join(DISCOVERY_DIR, `${token}-runner-result.json`);
  const browser = String(options.browser || process.env.AUTOMATION_BROWSER || 'chrome');
  const pageScope = context.pageScope === 'STARTING_PAGE_ONLY' ? 'STARTING_PAGE_ONLY' : 'ALL_DISCOVERED_PAGES';
  const timeoutMs = Math.max(30000, Math.min(numberEnv(process.env.CYPRESS_DISCOVERY_TIMEOUT_MS, 60000), 180000));
  const maxPages = Math.max(1, Math.min(numberEnv(process.env.CYPRESS_DISCOVERY_MAX_PAGES, 6), 12));

  const env = {
    ...process.env,
    AUTOMATION_RUN_ID: `discovery-${token}`,
    AUTOMATION_RESULT_FILE: resultFile,
    AUTOMATION_BASE_URL: new URL(seeds[0]).origin,
    AUTOMATION_VIDEO: 'false',
    AUTOMATION_SCREENSHOT_ON_FAILURE: 'false',
    AUTOMATION_SCREENSHOT_EACH_TEST: 'false',
    AUTOMATION_TEST_COMPLETION_PAUSE_MS: '0',
    DEMO_STEP_DELAY_MS: '0',
    DISCOVERY_TARGET_URLS_JSON: JSON.stringify(seeds),
    DISCOVERY_OUTPUT_FILE: outputRelative.replace(/\\/g, '/'),
    DISCOVERY_PAGE_SCOPE: pageScope,
    DISCOVERY_MAX_PAGES: String(maxPages),
  };

  const args = [
    CYPRESS_BIN,
    'run',
    '--project', AUTOMATION_DIR,
    '--config-file', ENGINE_CONFIG,
    '--spec', SPEC_RELATIVE,
    '--browser', browser,
    '--headless',
  ];

  try {
    fs.rmSync(outputAbsolute, { force: true });
    fs.rmSync(resultFile, { force: true });
    const result = await runProcess(args, env, timeoutMs);
    if (!fs.existsSync(outputAbsolute)) {
      const tail = String(result.stderr || result.stdout || '').trim().slice(-1800);
      const error = new Error(`Rendered browser discovery did not produce a DOM snapshot${tail ? `: ${tail}` : '.'}`);
      error.code = 'BROWSER_DISCOVERY_FAILED';
      error.exitCode = result.code;
      throw error;
    }
    const payload = JSON.parse(fs.readFileSync(outputAbsolute, 'utf8'));
    const pages = Array.isArray(payload?.pages) ? payload.pages : [];
    if (!pages.length) {
      const error = new Error('Rendered browser discovery completed without any HTML pages.');
      error.code = 'BROWSER_DISCOVERY_EMPTY';
      throw error;
    }
    return pages.map((page, index) => ({
      ...page,
      discoveryEngine: 'CYPRESS_RENDERED_DOM',
      discoveryScope: pageScope,
      isStartingPage: index === 0,
    }));
  } finally {
    try { fs.rmSync(outputAbsolute, { force: true }); } catch {}
    try { fs.rmSync(resultFile, { force: true }); } catch {}
  }
}

module.exports = { discoverRenderedPages, normalizeSeeds };

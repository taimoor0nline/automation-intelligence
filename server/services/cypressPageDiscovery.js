const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { spawn, execFile } = require('child_process');
const { promisify } = require('util');
const requestContext = require('./requestContext');
const { cleanupAutomationBrowsers } = require('./browserProcessCleanup');

const execFileAsync = promisify(execFile);
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

async function terminateProcessTree(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    try {
      await execFileAsync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10000 });
      return;
    } catch {}
  }
  try { child.kill('SIGTERM'); } catch {}
}

function runProcess(args, env, timeoutMs, runId) {
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

    const finishError = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    };

    const timer = setTimeout(() => {
      if (settled) return;
      const error = new Error(`Rendered browser discovery exceeded its ${Math.round(timeoutMs / 1000)} second overall budget.`);
      error.code = 'BROWSER_DISCOVERY_TIMEOUT';
      void (async () => {
        await terminateProcessTree(child);
        await cleanupAutomationBrowsers({ runId, reason: 'rendered discovery timeout', log: false, attempts: 3, verifyDelayMs: 250 }).catch(() => {});
        finishError(error);
      })();
    }, timeoutMs);
    timer.unref?.();

    child.stdout.on('data', (chunk) => { stdout += String(chunk); if (stdout.length > 16000) stdout = stdout.slice(-16000); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); if (stderr.length > 16000) stderr = stderr.slice(-16000); });
    child.on('error', (err) => finishError(err));
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function readSnapshot(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!payload || !Array.isArray(payload.pages)) return null;
    return payload;
  } catch {
    return null;
  }
}

function resultTail(resultOrError) {
  return String(resultOrError?.stderr || resultOrError?.stdout || '').trim().slice(-1800);
}

async function discoverRenderedPages(urls = [], options = {}) {
  const seeds = normalizeSeeds(urls);
  if (!seeds.length) return [];
  const enabled = boolEnv(process.env.CYPRESS_RENDERED_DISCOVERY, true);
  if (!enabled) return [];
  if (!fs.existsSync(CYPRESS_BIN)) {
    const error = new Error('The browser automation runtime is not installed; rendered web discovery is unavailable.');
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
  const maxPages = Math.max(1, Math.min(Number(options.maxPages || numberEnv(process.env.CYPRESS_DISCOVERY_MAX_PAGES, 6)) || 6, 12));
  const pageLoadTimeoutMs = Math.max(10000, Math.min(numberEnv(process.env.BROWSER_DISCOVERY_PAGE_LOAD_TIMEOUT_MS, 30000), 60000));
  const commandTimeoutMs = Math.max(3000, Math.min(numberEnv(process.env.BROWSER_DISCOVERY_COMMAND_TIMEOUT_MS, 8000), 30000));
  const configuredOverall = numberEnv(process.env.BROWSER_DISCOVERY_TIMEOUT_MS || process.env.CYPRESS_DISCOVERY_TIMEOUT_MS, 90000);
  const timeoutMs = Math.max(pageLoadTimeoutMs + 30000, Math.min(configuredOverall, 180000));
  const discoveryRunId = `discovery-${token}`;

  const seedJson = JSON.stringify(seeds);
  const outputForCypress = outputRelative.replace(/\\/g, '/');
  const env = {
    ...process.env,
    AUTOMATION_RUN_ID: discoveryRunId,
    AUTOMATION_RESULT_FILE: resultFile,
    AUTOMATION_BASE_URL: new URL(seeds[0]).origin,
    AUTOMATION_VIDEO: 'false',
    AUTOMATION_SCREENSHOT_ON_FAILURE: 'false',
    AUTOMATION_SCREENSHOT_EACH_TEST: 'false',
    AUTOMATION_TEST_COMPLETION_PAUSE_MS: '0',
    DEMO_STEP_DELAY_MS: '0',
    CYPRESS_DISCOVERY_TARGET_URLS_JSON: seedJson,
    CYPRESS_DISCOVERY_OUTPUT_FILE: outputForCypress,
    CYPRESS_DISCOVERY_PAGE_SCOPE: pageScope,
    CYPRESS_DISCOVERY_MAX_PAGES: String(maxPages),
  };

  const configOverride = [
    'supportFile=false',
    `pageLoadTimeout=${pageLoadTimeoutMs}`,
    `defaultCommandTimeout=${commandTimeoutMs}`,
    `requestTimeout=${commandTimeoutMs}`,
    `responseTimeout=${Math.max(commandTimeoutMs, 10000)}`,
    'retries=0',
  ].join(',');

  const args = [
    CYPRESS_BIN,
    'run',
    '--project', AUTOMATION_DIR,
    '--config-file', ENGINE_CONFIG,
    '--config', configOverride,
    '--spec', SPEC_RELATIVE,
    '--browser', browser,
    '--headless',
  ];

  let processResult = null;
  let processError = null;
  try {
    fs.rmSync(outputAbsolute, { force: true });
    fs.rmSync(resultFile, { force: true });
    try {
      processResult = await runProcess(args, env, timeoutMs, discoveryRunId);
    } catch (err) {
      processError = err;
    }

    const payload = readSnapshot(outputAbsolute);
    const pages = Array.isArray(payload?.pages) ? payload.pages : [];

    if (!pages.length) {
      if (processError) throw processError;
      const tail = resultTail(processResult);
      const error = new Error(`Rendered browser discovery did not produce a grounded page snapshot${tail ? `: ${tail}` : '.'}`);
      error.code = 'BROWSER_DISCOVERY_FAILED';
      error.exitCode = processResult?.code;
      throw error;
    }

    const complete = payload?.complete === true && !processError && Number(processResult?.code || 0) === 0;
    const warnings = [...new Set([
      ...(Array.isArray(payload?.warnings) ? payload.warnings.map(String) : []),
      processError ? `Discovery stopped after ${pages.length} grounded page${pages.length === 1 ? '' : 's'}: ${processError.message}` : null,
      !processError && Number(processResult?.code || 0) !== 0 ? `Discovery runner exited after ${pages.length} grounded page${pages.length === 1 ? '' : 's'}; remaining public routes were not used for generation.` : null,
    ].filter(Boolean))];

    return pages.map((page, index) => ({
      ...page,
      discoveryEngine: 'BROWSER_RENDERED_DOM',
      discoveryScope: pageScope,
      discoveryComplete: complete,
      discoveryWarnings: warnings,
      isStartingPage: index === 0,
    }));
  } finally {
    await cleanupAutomationBrowsers({ runId: discoveryRunId, reason: 'rendered discovery completion', log: false, attempts: 3, verifyDelayMs: 200 }).catch(() => {});
    try { fs.rmSync(outputAbsolute, { force: true }); } catch {}
    try { fs.rmSync(resultFile, { force: true }); } catch {}
  }
}

module.exports = { discoverRenderedPages, normalizeSeeds, readSnapshot };

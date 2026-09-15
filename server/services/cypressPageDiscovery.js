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

function normalizeUrl(raw, base = null) {
  try {
    const url = base ? new URL(String(raw || ''), base) : new URL(String(raw || ''));
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeSeeds(urls = []) {
  const output = [];
  const seen = new Set();
  for (const raw of urls || []) {
    const value = normalizeUrl(raw);
    if (value && !seen.has(value)) { seen.add(value); output.push(value); }
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
      const error = new Error(`Rendered page discovery exceeded its ${Math.round(timeoutMs / 1000)} second page budget.`);
      error.code = 'BROWSER_DISCOVERY_PAGE_TIMEOUT';
      void (async () => {
        await terminateProcessTree(child);
        await cleanupAutomationBrowsers({ runId, reason: 'rendered discovery timeout', log: false, attempts: 3, verifyDelayMs: 250 }).catch(() => {});
        finishError(error);
      })();
    }, timeoutMs);
    timer.unref?.();

    child.stdout.on('data', (chunk) => { stdout += String(chunk); if (stdout.length > 24000) stdout = stdout.slice(-24000); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); if (stderr.length > 24000) stderr = stderr.slice(-24000); });
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

function stripTerminalFormatting(value) {
  return String(value || '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/gi, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/gi, '')
    .replace(/\[[0-9;]{1,12}m/g, '')
    .replace(/[─│┌┐└┘]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resultTail(resultOrError) {
  const stderr = stripTerminalFormatting(resultOrError?.stderr || '');
  const stdout = stripTerminalFormatting(resultOrError?.stdout || '');
  return (stderr || stdout).slice(-1800);
}

function readRunnerFailure(resultFile) {
  if (!fs.existsSync(resultFile)) return null;
  try {
    const payload = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
    const failed = (Array.isArray(payload?.tests) ? payload.tests : []).find((test) => String(test?.state || '').toLowerCase() === 'failed');
    const message = stripTerminalFormatting(failed?.err?.message || failed?.err?.stack || '');
    return message || null;
  } catch {
    return null;
  }
}

function discoveryCliEnv(seed, outputForCypress, pageScope) {
  // Duplicate the critical inputs through --env. The process environment remains
  // the primary bridge, while this explicit Cypress input prevents a config-layer
  // projection regression from silently turning discovery into a no-op.
  return [
    'DISCOVERY_ENABLED=true',
    `DISCOVERY_TARGET_URLS_JSON=${JSON.stringify([seed])}`,
    `DISCOVERY_OUTPUT_FILE=${outputForCypress}`,
    `DISCOVERY_PAGE_SCOPE=${pageScope}`,
    'DISCOVERY_MAX_PAGES=1',
  ].join(',');
}

function writeFailureDiagnostic(filePath, payload) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  } catch {}
}

async function discoverOneRenderedPage(seed, options) {
  const {
    context,
    browser,
    pageScope,
    pageLoadTimeoutMs,
    commandTimeoutMs,
    pageBudgetMs,
  } = options;
  const token = `${safeToken(context.sessionId)}-${randomUUID().slice(0, 8)}`;
  const outputRelative = `artifacts/discovery/${token}.json`;
  const outputAbsolute = path.join(AUTOMATION_DIR, outputRelative);
  const resultFile = path.join(DISCOVERY_DIR, `${token}-runner-result.json`);
  const failureFile = path.join(DISCOVERY_DIR, `${token}-failure.json`);
  const discoveryRunId = `discovery-${token}`;
  const outputForCypress = outputRelative.replace(/\\/g, '/');

  const env = {
    ...process.env,
    AUTOMATION_RUN_ID: discoveryRunId,
    AUTOMATION_RESULT_FILE: resultFile,
    AUTOMATION_BASE_URL: new URL(seed).origin,
    AUTOMATION_VIDEO: 'false',
    AUTOMATION_SCREENSHOT_ON_FAILURE: 'false',
    AUTOMATION_SCREENSHOT_EACH_TEST: 'false',
    AUTOMATION_TEST_COMPLETION_PAUSE_MS: '0',
    DEMO_STEP_DELAY_MS: '0',
    CYPRESS_DISCOVERY_ENABLED: 'true',
    CYPRESS_DISCOVERY_TARGET_URLS_JSON: JSON.stringify([seed]),
    CYPRESS_DISCOVERY_OUTPUT_FILE: outputForCypress,
    CYPRESS_DISCOVERY_PAGE_SCOPE: pageScope,
    CYPRESS_DISCOVERY_MAX_PAGES: '1',
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
    '--env', discoveryCliEnv(seed, outputForCypress, pageScope),
    '--spec', SPEC_RELATIVE,
    '--browser', browser,
    '--headless',
  ];

  let failed = false;
  try {
    fs.rmSync(outputAbsolute, { force: true });
    fs.rmSync(resultFile, { force: true });
    fs.rmSync(failureFile, { force: true });
    let result = null;
    let processError = null;
    try { result = await runProcess(args, env, pageBudgetMs, discoveryRunId); }
    catch (err) { processError = err; }

    const payload = readSnapshot(outputAbsolute);
    const page = payload?.pages?.[0] || null;
    if (!page) {
      failed = true;
      const runnerFailure = readRunnerFailure(resultFile);
      const exitCode = result?.code;
      const tail = resultTail(processError || result);
      let error = processError;
      if (!error && runnerFailure) {
        error = new Error(runnerFailure);
        error.code = 'BROWSER_DISCOVERY_RUNNER_FAILED';
      }
      if (!error && Number.isFinite(Number(exitCode)) && Number(exitCode) !== 0) {
        error = new Error(`Rendered discovery process exited with code ${exitCode}${tail ? `: ${tail}` : '.'}`);
        error.code = 'BROWSER_DISCOVERY_PROCESS_FAILED';
      }
      if (!error) {
        error = new Error(`Rendered discovery runner finished without writing a grounded snapshot${tail ? ` (${tail})` : '.'}`);
        error.code = 'BROWSER_DISCOVERY_SNAPSHOT_MISSING';
      }
      error.targetUrl = seed;
      writeFailureDiagnostic(failureFile, {
        at: new Date().toISOString(),
        code: error.code || null,
        message: error.message,
        targetUrl: seed,
        browser,
        pageScope,
        runnerExitCode: exitCode ?? null,
        runnerFailure: runnerFailure || null,
        outputExpected: outputForCypress,
        resultFilePresent: fs.existsSync(resultFile),
        snapshotFilePresent: fs.existsSync(outputAbsolute),
        terminalTail: tail || null,
      });
      error.diagnosticFile = failureFile;
      throw error;
    }

    return {
      page,
      runnerExitCode: result?.code ?? null,
      runnerWarning: processError ? processError.message : Number(result?.code || 0) !== 0 ? resultTail(result) || 'The page runtime exited after producing a grounded snapshot.' : null,
    };
  } finally {
    await cleanupAutomationBrowsers({ runId: discoveryRunId, reason: 'rendered page discovery completion', log: false, attempts: 3, verifyDelayMs: 200 }).catch(() => {});
    try { fs.rmSync(outputAbsolute, { force: true }); } catch {}
    try { fs.rmSync(resultFile, { force: true }); } catch {}
    if (!failed) {
      try { fs.rmSync(failureFile, { force: true }); } catch {}
    }
  }
}

async function discoverRenderedPages(urls = [], options = {}) {
  const seeds = normalizeSeeds(urls);
  if (!seeds.length) return [];
  if (!boolEnv(process.env.CYPRESS_RENDERED_DISCOVERY, true)) return [];
  if (!fs.existsSync(CYPRESS_BIN)) {
    const error = new Error('The browser automation runtime is not installed; rendered web discovery is unavailable.');
    error.code = 'BROWSER_DISCOVERY_RUNTIME_MISSING';
    throw error;
  }

  fs.mkdirSync(DISCOVERY_DIR, { recursive: true });
  const context = requestContext.current();
  const browser = String(options.browser || process.env.AUTOMATION_BROWSER || 'chrome');
  const pageScope = context.pageScope === 'STARTING_PAGE_ONLY' ? 'STARTING_PAGE_ONLY' : 'ALL_DISCOVERED_PAGES';
  const maxPages = Math.max(1, Math.min(Number(options.maxPages || numberEnv(process.env.CYPRESS_DISCOVERY_MAX_PAGES, 6)) || 6, 12));
  const pageLoadTimeoutMs = Math.max(10000, Math.min(numberEnv(process.env.BROWSER_DISCOVERY_PAGE_LOAD_TIMEOUT_MS, 30000), 60000));
  const commandTimeoutMs = Math.max(3000, Math.min(numberEnv(process.env.BROWSER_DISCOVERY_COMMAND_TIMEOUT_MS, 8000), 30000));
  const overallBudgetMs = Math.max(30000, Math.min(numberEnv(process.env.BROWSER_DISCOVERY_TIMEOUT_MS || process.env.CYPRESS_DISCOVERY_TIMEOUT_MS, 90000), 180000));
  const pageBudgetDefault = Math.max(pageLoadTimeoutMs + 12000, 30000);
  const deadline = Date.now() + overallBudgetMs;
  const startingOrigin = new URL(seeds[0]).origin;
  const queue = pageScope === 'STARTING_PAGE_ONLY' ? [seeds[0]] : [...seeds];
  const queued = new Set(queue);
  const visited = new Set();
  const pages = [];
  const warnings = [];

  while (queue.length && pages.length < maxPages) {
    const seed = queue.shift();
    if (!seed || visited.has(seed)) continue;
    visited.add(seed);

    const remainingMs = deadline - Date.now();
    if (remainingMs < 5000) {
      warnings.push(`Public-page discovery stopped after ${pages.length} grounded page${pages.length === 1 ? '' : 's'} because the overall discovery budget was reached.`);
      break;
    }

    try {
      const discovered = await discoverOneRenderedPage(seed, {
        context,
        browser,
        pageScope,
        pageLoadTimeoutMs,
        commandTimeoutMs,
        pageBudgetMs: Math.max(5000, Math.min(pageBudgetDefault, remainingMs)),
      });
      const page = discovered.page;
      pages.push(page);
      if (discovered.runnerWarning) warnings.push(`${seed}: ${discovered.runnerWarning}`);

      if (pageScope !== 'STARTING_PAGE_ONLY') {
        for (const rawHint of page.routeHints || []) {
          const hint = normalizeUrl(rawHint, page.finalUrl || page.url || seed);
          if (!hint) continue;
          let sameOrigin = false;
          try { sameOrigin = new URL(hint).origin === startingOrigin; } catch {}
          if (!sameOrigin || visited.has(hint) || queued.has(hint)) continue;
          queue.push(hint);
          queued.add(hint);
        }
      }
    } catch (err) {
      if (!pages.length) {
        if (err.code === 'BROWSER_DISCOVERY_PAGE_TIMEOUT') err.code = 'BROWSER_DISCOVERY_START_PAGE_TIMEOUT';
        else if (!err.code || err.code === 'BROWSER_DISCOVERY_PAGE_FAILED') err.code = 'BROWSER_DISCOVERY_START_PAGE_FAILED';
        err.message = `Starting page could not be rendered into a grounded browser snapshot. ${err.message}`;
        throw err;
      }
      warnings.push(`Skipped public page ${seed}: ${err.message}`);
    }
  }

  if (!pages.length) {
    const error = new Error('Rendered browser discovery completed without any grounded HTML pages.');
    error.code = 'BROWSER_DISCOVERY_EMPTY';
    throw error;
  }
  if (queue.length && pages.length >= maxPages) warnings.push(`Public-page discovery reached its ${maxPages}-page safety limit; additional discovered routes were not used for generation.`);

  const complete = warnings.length === 0 && queue.length === 0;
  return pages.map((page, index) => ({
    ...page,
    discoveryEngine: 'BROWSER_RENDERED_DOM',
    discoveryScope: pageScope,
    discoveryComplete: complete,
    discoveryWarnings: warnings,
    isStartingPage: index === 0,
  }));
}

module.exports = {
  discoverRenderedPages,
  normalizeSeeds,
  readSnapshot,
  readRunnerFailure,
  stripTerminalFormatting,
  discoveryCliEnv,
};

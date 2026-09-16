const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const {
  resolveChrome,
  serializeRenderedDocument,
  waitForQuietDomExpression,
} = require('./directChromeRenderedDiscovery');

function boolEnv(value, fallback) {
  if (value == null || value === '') return fallback;
  return !['false', '0', 'no', 'off'].includes(String(value).toLowerCase());
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanTerminal(value, max = 3000) {
  return String(value || '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(-max);
}

function terminateProcessTree(child) {
  if (!child?.pid) return Promise.resolve();
  if (process.platform !== 'win32') {
    try { child.kill('SIGKILL'); } catch {}
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    killer.once('close', resolve);
    killer.once('error', resolve);
  });
}

function browserHttpBase(browserWsUrl) {
  const parsed = new URL(browserWsUrl);
  return `http://${parsed.hostname}:${parsed.port}`;
}

function getJson(url, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { timeout: timeoutMs }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.once('timeout', () => request.destroy(new Error('Chrome DevTools HTTP endpoint timed out.')));
    request.once('error', reject);
  });
}

function launchChromeAtTarget(chromePath, targetUrl, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnexus-cdp2-discovery-'));
    const args = [
      '--headless=new',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-popup-blocking',
      '--disable-renderer-backgrounding',
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=0',
      '--remote-allow-origins=*',
      `--user-data-dir=${profileDir}`,
      targetUrl,
    ];
    const child = spawn(chromePath, args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    let settled = false;

    const cleanupFailure = async (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      await terminateProcessTree(child).catch(() => {});
      try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
      error.stderr = stderr;
      reject(error);
    };

    const succeed = (browserWsUrl) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ child, profileDir, browserWsUrl, stderr: () => stderr });
    };

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 16000) stderr = stderr.slice(-16000);
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) succeed(match[1]);
    });
    child.once('error', cleanupFailure);
    child.once('close', (code) => {
      if (settled) return;
      const error = new Error(`Chrome exited before exposing its DevTools endpoint (code ${code}).`);
      error.code = 'DIRECT_CHROME_START_FAILED';
      void cleanupFailure(error);
    });

    const timer = setTimeout(() => {
      const error = new Error(`Chrome did not expose its DevTools endpoint within ${Math.round(timeoutMs / 1000)} seconds.`);
      error.code = 'DIRECT_CHROME_START_TIMEOUT';
      void cleanupFailure(error);
    }, timeoutMs);
    timer.unref?.();
  });
}

class PageCdpClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  open(timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      const timer = setTimeout(() => {
        try { ws.terminate(); } catch {}
        reject(new Error('Timed out connecting to the page DevTools endpoint.'));
      }, timeoutMs);
      timer.unref?.();
      ws.once('open', () => { clearTimeout(timer); resolve(); });
      ws.once('error', (error) => { clearTimeout(timer); reject(error); });
      ws.on('message', (raw) => this.handleMessage(raw));
      ws.on('close', () => {
        for (const pending of this.pending.values()) pending.reject(new Error('Page DevTools connection closed.'));
        this.pending.clear();
      });
    });
  }

  handleMessage(raw) {
    let message;
    try { message = JSON.parse(String(raw)); } catch { return; }
    if (!message.id || !this.pending.has(message.id)) return;
    const pending = this.pending.get(message.id);
    this.pending.delete(message.id);
    if (message.error) pending.reject(new Error(message.error.message || 'Chrome DevTools command failed.'));
    else pending.resolve(message.result || {});
  }

  send(method, params = {}, timeoutMs = 12000) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Page DevTools connection is not open.'));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Chrome DevTools command ${method} timed out.`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      try { this.ws.send(JSON.stringify({ id, method, params })); }
      catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  close() {
    try { this.ws?.close(); } catch {}
  }
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

async function waitForStablePageTarget(httpBase, targetUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const expectedOrigin = new URL(targetUrl).origin;
  let previousKey = null;
  let stableCount = 0;
  let lastTargets = [];

  while (Date.now() < deadline) {
    try {
      const targets = await getJson(`${httpBase}/json/list`, 2500);
      lastTargets = Array.isArray(targets) ? targets : [];
      const candidates = lastTargets.filter((item) => item?.type === 'page' && item.webSocketDebuggerUrl && /^https?:\/\//i.test(String(item.url || '')));
      const preferred = candidates.find((item) => {
        try { return new URL(item.url).origin === expectedOrigin; } catch { return false; }
      }) || candidates[0];

      if (preferred) {
        const key = `${preferred.id}|${preferred.url}|${preferred.webSocketDebuggerUrl}`;
        if (key === previousKey) stableCount += 1;
        else { previousKey = key; stableCount = 1; }
        if (stableCount >= 3) return preferred;
      }
    } catch {}
    await delay(150);
  }

  const error = new Error(`Chrome did not expose a stable rendered page target for ${targetUrl}.`);
  error.code = 'DIRECT_CHROME_TARGET_MISSING';
  error.targetSummary = lastTargets.map((item) => ({ type: item?.type, url: item?.url, title: item?.title })).slice(0, 10);
  throw error;
}

function isTransientTargetError(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('inspected target navigated or closed') ||
    message.includes('target closed') ||
    message.includes('connection closed') ||
    message.includes('not attached') ||
    message.includes('session with given id not found');
}

async function waitForReadyDocument(client, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const evaluated = await client.send('Runtime.evaluate', {
      expression: `({ href: location.href, readyState: document.readyState, title: document.title })`,
      returnByValue: true,
    }, 5000);
    last = evaluated.result?.value || null;
    if (last && /^https?:\/\//i.test(String(last.href || '')) && ['interactive', 'complete'].includes(String(last.readyState || ''))) {
      return last;
    }
    await delay(150);
  }
  const error = new Error(`Chrome page did not reach an inspectable document state within ${Math.round(timeoutMs / 1000)} seconds.`);
  error.code = 'DIRECT_CHROME_DOCUMENT_TIMEOUT';
  error.lastDocumentState = last;
  throw error;
}

async function inspectStableTarget(httpBase, targetUrl, options) {
  const deadline = Date.now() + options.pageLoadTimeoutMs;
  let lastError = null;

  for (let attempt = 1; attempt <= 4 && Date.now() < deadline; attempt += 1) {
    let client = null;
    try {
      const target = await waitForStablePageTarget(httpBase, targetUrl, Math.max(1500, Math.min(7000, deadline - Date.now())));
      client = new PageCdpClient(target.webSocketDebuggerUrl);
      await client.open();
      await client.send('Runtime.enable').catch(() => {});
      await client.send('Page.enable').catch(() => {});
      await waitForReadyDocument(client, Math.max(2000, Math.min(10000, deadline - Date.now())));

      await client.send('Runtime.evaluate', {
        expression: waitForQuietDomExpression(options.maxSettleMs, options.quietMs),
        awaitPromise: true,
        returnByValue: true,
      }, options.maxSettleMs + 3000);

      const evaluated = await client.send('Runtime.evaluate', {
        expression: `(${serializeRenderedDocument.toString()})()`,
        awaitPromise: true,
        returnByValue: true,
      }, 15000);
      if (evaluated.exceptionDetails) {
        const error = new Error(evaluated.exceptionDetails?.text || 'Chrome failed to serialize the rendered DOM.');
        error.code = 'DIRECT_CHROME_SERIALIZATION_FAILED';
        throw error;
      }
      const page = evaluated.result?.value;
      if (!page || !Array.isArray(page.elements)) {
        const error = new Error('Chrome reached the rendered page but did not return a grounded DOM snapshot.');
        error.code = 'DIRECT_CHROME_SNAPSHOT_MISSING';
        throw error;
      }
      return page;
    } catch (error) {
      lastError = error;
      if (!isTransientTargetError(error) || attempt >= 4) throw error;
      await delay(250);
    } finally {
      client?.close();
    }
  }

  throw lastError || new Error('Direct Chrome target inspection did not complete.');
}

async function discoverPageWithDirectChrome(targetUrl, options = {}) {
  const parsedUrl = normalizeUrl(targetUrl);
  if (!parsedUrl) {
    const error = new Error('Direct Chrome discovery requires an http:// or https:// URL.');
    error.code = 'DIRECT_CHROME_URL_INVALID';
    throw error;
  }

  const chromePath = resolveChrome();
  if (!chromePath) {
    const error = new Error('Google Chrome/Chromium is unavailable for direct rendered discovery. Set CHROME_PATH if installed in a non-standard location.');
    error.code = 'DIRECT_CHROME_NOT_FOUND';
    throw error;
  }

  const pageLoadTimeoutMs = Math.max(10000, Math.min(Number(options.pageLoadTimeoutMs || 30000), 60000));
  const maxSettleMs = Math.max(1000, Math.min(Number(options.maxSettleMs || process.env.DIRECT_CHROME_DISCOVERY_SETTLE_MS || 6000), 15000));
  const quietMs = Math.max(100, Math.min(Number(options.quietMs || 450), 2000));
  const launched = await launchChromeAtTarget(chromePath, parsedUrl, Math.min(pageLoadTimeoutMs, 15000));

  try {
    const page = await inspectStableTarget(browserHttpBase(launched.browserWsUrl), parsedUrl, {
      pageLoadTimeoutMs,
      maxSettleMs,
      quietMs,
    });
    return {
      ...page,
      discoveryBrowser: 'chrome',
      discoveryTransport: 'DIRECT_CHROME_CDP_V2',
      networkHints: Array.isArray(page.networkHints) ? page.networkHints : [],
    };
  } catch (error) {
    error.chromePath = chromePath;
    error.terminalTail = cleanTerminal(launched.stderr());
    throw error;
  } finally {
    await terminateProcessTree(launched.child).catch(() => {});
    try { fs.rmSync(launched.profileDir, { recursive: true, force: true }); } catch {}
  }
}

async function discoverPagesWithDirectChrome(urls = [], options = {}) {
  const seeds = [...new Set((urls || []).map((value) => normalizeUrl(value)).filter(Boolean))];
  if (!seeds.length) return [];
  const pageScope = String(options.pageScope || 'ALL_DISCOVERED_PAGES').toUpperCase() === 'STARTING_PAGE_ONLY' ? 'STARTING_PAGE_ONLY' : 'ALL_DISCOVERED_PAGES';
  const maxPages = Math.max(1, Math.min(Number(options.maxPages || 6) || 6, 12));
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
    try {
      const page = await discoverPageWithDirectChrome(seed, options);
      pages.push(page);
      if (pageScope !== 'STARTING_PAGE_ONLY') {
        for (const rawHint of page.routeHints || []) {
          const hint = normalizeUrl(rawHint, page.finalUrl || page.url || seed);
          if (!hint || visited.has(hint) || queued.has(hint)) continue;
          try { if (new URL(hint).origin !== startingOrigin) continue; } catch { continue; }
          queue.push(hint);
          queued.add(hint);
        }
      }
    } catch (error) {
      if (!pages.length) throw error;
      warnings.push(`Skipped public page ${seed}: ${error.message}`);
    }
  }

  if (!pages.length) {
    const error = new Error('Direct Chrome rendered discovery completed without a grounded HTML page.');
    error.code = 'DIRECT_CHROME_EMPTY';
    throw error;
  }
  if (queue.length && pages.length >= maxPages) warnings.push(`Public-page discovery reached its ${maxPages}-page safety limit; additional discovered routes were not used for generation.`);
  const complete = warnings.length === 0 && queue.length === 0;
  return pages.map((page, index) => ({
    ...page,
    discoveryScope: pageScope,
    discoveryComplete: complete,
    discoveryWarnings: warnings,
    isStartingPage: index === 0,
  }));
}

function isDirectChromeFallbackEligible(error) {
  if (!boolEnv(process.env.DIRECT_CHROME_DISCOVERY_FALLBACK, true)) return false;
  if (!error) return false;
  if (error.runnerFailure) return false;
  if (error.snapshotFilePresent === true) return false;
  return error.code === 'BROWSER_DISCOVERY_PROCESS_FAILED';
}

module.exports = {
  discoverPageWithDirectChrome,
  discoverPagesWithDirectChrome,
  isDirectChromeFallbackEligible,
  isTransientTargetError,
  waitForStablePageTarget,
};

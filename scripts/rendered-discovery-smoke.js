const assert = require('assert');
const http = require('http');
const https = require('https');
const path = require('path');
const { spawn } = require('child_process');
const { discoverRenderedPages } = require('../server/services/cypressPageDiscovery');

const DEFAULT_TARGET = 'http://127.0.0.1:4000/capabilities.html';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function probe(url, timeoutMs = 1500) {
  return new Promise((resolve) => {
    let parsed;
    try { parsed = new URL(url); }
    catch { resolve(false); return; }

    const client = parsed.protocol === 'https:' ? https : http;
    const request = client.get(parsed, { timeout: timeoutMs }, (response) => {
      response.resume();
      resolve(Number(response.statusCode || 0) >= 200 && Number(response.statusCode || 0) < 500);
    });
    request.on('timeout', () => { request.destroy(); resolve(false); });
    request.on('error', () => resolve(false));
  });
}

async function waitUntilReachable(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe(url)) return true;
    await sleep(250);
  }
  return false;
}

function startDemoApp() {
  const serverFile = path.join(__dirname, '..', 'demo-app', 'server.js');
  const child = spawn(process.execPath, [serverFile], {
    cwd: path.join(__dirname, '..'),
    env: process.env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  const collect = (chunk) => {
    output += String(chunk || '');
    if (output.length > 6000) output = output.slice(-6000);
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  child.testNexusOutput = () => output.trim();
  return child;
}

async function stopDemoApp(child) {
  if (!child || child.exitCode != null) return;
  try { child.kill('SIGTERM'); } catch {}
  await Promise.race([
    new Promise((resolve) => child.once('close', resolve)),
    sleep(2000),
  ]);
  if (child.exitCode == null) {
    try { child.kill('SIGKILL'); } catch {}
  }
}

(async () => {
  const target = String(process.env.RENDERED_DISCOVERY_SMOKE_URL || DEFAULT_TARGET);
  const browser = String(process.env.AUTOMATION_DISCOVERY_BROWSER || process.env.AUTOMATION_BROWSER || 'chrome');
  let demo = null;

  try {
    const targetAlreadyReachable = await probe(target);
    if (!targetAlreadyReachable && target === DEFAULT_TARGET) {
      demo = startDemoApp();
      const ready = await waitUntilReachable(target);
      if (!ready) {
        const output = typeof demo.testNexusOutput === 'function' ? demo.testNexusOutput() : '';
        throw new Error(`Demo capability target did not become reachable on ${target}${output ? `: ${output}` : '.'}`);
      }
    } else if (!targetAlreadyReachable) {
      throw new Error(`Rendered-discovery smoke target is not reachable: ${target}`);
    }

    const pages = await discoverRenderedPages([target], { browser, maxPages: 1 });

    assert(Array.isArray(pages), 'Rendered discovery must return an array.');
    assert.equal(pages.length, 1, `Expected exactly one grounded page, received ${pages.length}.`);
    const page = pages[0];
    assert(/^https?:\/\//i.test(String(page.finalUrl || page.url || '')), 'Grounded page must carry its real browser URL.');
    assert(Array.isArray(page.elements), 'Grounded page must contain an element registry source.');
    assert(page.elements.length > 0, 'Grounded page must contain at least one rendered element.');
    assert.equal(page.discoveryEngine, 'BROWSER_RENDERED_DOM');
    assert(page.capabilityDiscovery && Number(page.capabilityDiscovery.capturedElements) > 0, 'Capability discovery must report captured rendered elements.');

    const browserNote = page.discoveryBrowserFallbackFrom
      ? `${page.discoveryBrowser} fallback from ${page.discoveryBrowserFallbackFrom}`
      : (page.discoveryBrowser || browser);
    console.log(`rendered-discovery-smoke: PASS (${page.elements.length} rendered elements from ${page.finalUrl || page.url}; browser=${browserNote})`);
  } finally {
    await stopDemoApp(demo);
  }
})().catch((err) => {
  console.error(`rendered-discovery-smoke: FAIL: ${err.code || 'ERROR'} ${err.message}`);
  if (err.browser) console.error(`browser: ${err.browser}`);
  if (err.diagnosticFile) console.error(`diagnostic: ${err.diagnosticFile}`);
  process.exit(1);
});

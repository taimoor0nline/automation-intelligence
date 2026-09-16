const assert = require('assert');
const {
  discoveryBrowserCandidates,
  mayRetryWithFallbackBrowser,
} = require('../server/services/cypressPageDiscovery');

const oldFallback = process.env.BROWSER_DISCOVERY_ALLOW_ELECTRON_FALLBACK;
const oldDiscoveryBrowser = process.env.AUTOMATION_DISCOVERY_BROWSER;
const oldBrowser = process.env.AUTOMATION_BROWSER;

function restore() {
  if (oldFallback === undefined) delete process.env.BROWSER_DISCOVERY_ALLOW_ELECTRON_FALLBACK;
  else process.env.BROWSER_DISCOVERY_ALLOW_ELECTRON_FALLBACK = oldFallback;
  if (oldDiscoveryBrowser === undefined) delete process.env.AUTOMATION_DISCOVERY_BROWSER;
  else process.env.AUTOMATION_DISCOVERY_BROWSER = oldDiscoveryBrowser;
  if (oldBrowser === undefined) delete process.env.AUTOMATION_BROWSER;
  else process.env.AUTOMATION_BROWSER = oldBrowser;
}

try {
  delete process.env.BROWSER_DISCOVERY_ALLOW_ELECTRON_FALLBACK;
  delete process.env.AUTOMATION_DISCOVERY_BROWSER;
  delete process.env.AUTOMATION_BROWSER;

  assert.deepEqual(discoveryBrowserCandidates({ browser: 'chrome' }), ['chrome', 'electron']);
  assert.deepEqual(discoveryBrowserCandidates({ browser: 'electron' }), ['electron']);

  process.env.AUTOMATION_DISCOVERY_BROWSER = 'edge';
  assert.deepEqual(discoveryBrowserCandidates({}), ['edge', 'electron']);

  process.env.BROWSER_DISCOVERY_ALLOW_ELECTRON_FALLBACK = 'false';
  assert.deepEqual(discoveryBrowserCandidates({ browser: 'chrome' }), ['chrome']);

  assert.equal(mayRetryWithFallbackBrowser({
    code: 'BROWSER_DISCOVERY_PROCESS_FAILED',
    runnerFailure: null,
    snapshotFilePresent: false,
  }), true);

  assert.equal(mayRetryWithFallbackBrowser({
    code: 'BROWSER_DISCOVERY_PROCESS_FAILED',
    runnerFailure: 'ASSERT_VISIBLE failed',
    snapshotFilePresent: false,
  }), false, 'A genuine Cypress test failure must never be retried as a browser fallback.');

  assert.equal(mayRetryWithFallbackBrowser({
    code: 'BROWSER_DISCOVERY_RUNNER_FAILED',
    runnerFailure: 'Discovery input invalid',
    snapshotFilePresent: false,
  }), false);

  assert.equal(mayRetryWithFallbackBrowser({
    code: 'BROWSER_DISCOVERY_PROCESS_FAILED',
    runnerFailure: null,
    snapshotFilePresent: true,
  }), false, 'A produced snapshot must not trigger another browser run.');

  console.log('discovery-browser-fallback-smoke: PASS');
} finally {
  restore();
}

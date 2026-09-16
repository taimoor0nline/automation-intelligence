const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  discoveryBrowserCandidates,
  mayRetryWithFallbackBrowser,
} = require('../server/services/cypressPageDiscovery');
const {
  isDirectChromeFallbackEligible,
  isTransientTargetError,
} = require('../server/services/directChromeRenderedDiscoveryV2');

const oldFallback = process.env.BROWSER_DISCOVERY_ALLOW_ELECTRON_FALLBACK;
const oldDiscoveryBrowser = process.env.AUTOMATION_DISCOVERY_BROWSER;
const oldBrowser = process.env.AUTOMATION_BROWSER;
const oldDirectFallback = process.env.DIRECT_CHROME_DISCOVERY_FALLBACK;

function restore() {
  if (oldFallback === undefined) delete process.env.BROWSER_DISCOVERY_ALLOW_ELECTRON_FALLBACK;
  else process.env.BROWSER_DISCOVERY_ALLOW_ELECTRON_FALLBACK = oldFallback;
  if (oldDiscoveryBrowser === undefined) delete process.env.AUTOMATION_DISCOVERY_BROWSER;
  else process.env.AUTOMATION_DISCOVERY_BROWSER = oldDiscoveryBrowser;
  if (oldBrowser === undefined) delete process.env.AUTOMATION_BROWSER;
  else process.env.AUTOMATION_BROWSER = oldBrowser;
  if (oldDirectFallback === undefined) delete process.env.DIRECT_CHROME_DISCOVERY_FALLBACK;
  else process.env.DIRECT_CHROME_DISCOVERY_FALLBACK = oldDirectFallback;
}

try {
  delete process.env.BROWSER_DISCOVERY_ALLOW_ELECTRON_FALLBACK;
  delete process.env.AUTOMATION_DISCOVERY_BROWSER;
  delete process.env.AUTOMATION_BROWSER;
  delete process.env.DIRECT_CHROME_DISCOVERY_FALLBACK;

  assert.deepEqual(discoveryBrowserCandidates({ browser: 'chrome' }), ['chrome', 'electron']);
  assert.deepEqual(discoveryBrowserCandidates({ browser: 'electron' }), ['electron']);

  process.env.AUTOMATION_DISCOVERY_BROWSER = 'edge';
  assert.deepEqual(discoveryBrowserCandidates({}), ['edge', 'electron']);

  process.env.BROWSER_DISCOVERY_ALLOW_ELECTRON_FALLBACK = 'false';
  assert.deepEqual(discoveryBrowserCandidates({ browser: 'chrome' }), ['chrome']);

  const infrastructureFailure = {
    code: 'BROWSER_DISCOVERY_PROCESS_FAILED',
    runnerFailure: null,
    snapshotFilePresent: false,
  };
  assert.equal(mayRetryWithFallbackBrowser(infrastructureFailure), true);
  assert.equal(isDirectChromeFallbackEligible(infrastructureFailure), true, 'A browser-runner infrastructure crash should allow strict direct-Chrome rendered fallback.');

  assert.equal(mayRetryWithFallbackBrowser({
    code: 'BROWSER_DISCOVERY_PROCESS_FAILED',
    runnerFailure: 'ASSERT_VISIBLE failed',
    snapshotFilePresent: false,
  }), false, 'A genuine browser test failure must never be retried as a browser fallback.');
  assert.equal(isDirectChromeFallbackEligible({
    code: 'BROWSER_DISCOVERY_PROCESS_FAILED',
    runnerFailure: 'Discovery validation failed',
    snapshotFilePresent: false,
  }), false, 'Direct Chrome must not hide a genuine discovery validation failure.');

  assert.equal(mayRetryWithFallbackBrowser({
    code: 'BROWSER_DISCOVERY_RUNNER_FAILED',
    runnerFailure: 'Discovery input invalid',
    snapshotFilePresent: false,
  }), false);
  assert.equal(isDirectChromeFallbackEligible({
    code: 'BROWSER_DISCOVERY_PROCESS_FAILED',
    runnerFailure: null,
    snapshotFilePresent: true,
  }), false, 'A produced snapshot must not trigger direct Chrome fallback.');

  assert.equal(isTransientTargetError(new Error('Inspected target navigated or closed')), true, 'Cross-process navigation must be treated as a re-attachable target transition.');
  assert.equal(isTransientTargetError(new Error('Selector contract invalid')), false);

  process.env.DIRECT_CHROME_DISCOVERY_FALLBACK = 'false';
  assert.equal(isDirectChromeFallbackEligible(infrastructureFailure), false, 'Direct Chrome fallback must remain explicitly disableable.');

  const activeDiscovery = fs.readFileSync(path.join(__dirname, '..', 'server', 'services', 'pageDiscovery.js'), 'utf8');
  assert.ok(activeDiscovery.includes('pageDiscoveryV7'), 'Active page discovery must point to V7 so the strict direct-Chrome fallback is wired into production generation.');

  console.log('discovery-browser-fallback-smoke: PASS');
} finally {
  restore();
}

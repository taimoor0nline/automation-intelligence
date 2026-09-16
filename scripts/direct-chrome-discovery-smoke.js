const assert = require('assert');
const { resolveChrome } = require('../server/services/directChromeRenderedDiscovery');
const { discoverPageWithDirectChrome } = require('../server/services/directChromeRenderedDiscoveryV2');

(async () => {
  const target = String(process.argv[2] || process.env.RENDERED_DISCOVERY_SMOKE_URL || 'http://127.0.0.1:4000/capabilities.html').trim();
  assert.ok(resolveChrome(), 'Chrome/Chromium must be available for the direct rendered-discovery smoke.');

  const page = await discoverPageWithDirectChrome(target, { pageLoadTimeoutMs: 30000 });
  assert.ok(page, 'Direct Chrome discovery must return a page.');
  assert.equal(page.discoveryTransport, 'DIRECT_CHROME_CDP_V2');
  assert.equal(page.discoveryEngine, 'BROWSER_RENDERED_DOM_V3');
  assert.ok(/^https?:\/\//i.test(String(page.finalUrl || page.url || '')), 'Rendered page must retain a real HTTP(S) URL.');
  assert.ok(Array.isArray(page.elements), 'Rendered page must expose discovered elements.');
  assert.ok(page.elements.length > 0, 'Rendered page must contain grounded elements.');
  assert.ok(Number(page.capabilityDiscovery?.capturedElements || 0) > 0, 'Rendered capability discovery must capture elements.');

  const selectorKeys = page.elements
    .filter((item) => item?.selector)
    .map((item) => `${item.shadowHostSelector || 'light'}|${item.selector}`);
  assert.equal(new Set(selectorKeys).size, selectorKeys.length, 'Rendered discovery must not emit duplicate selector identities.');

  console.log(`direct-chrome-discovery-smoke: PASS (${page.elements.length} grounded elements from ${page.finalUrl || page.url})`);
})().catch((error) => {
  console.error(`direct-chrome-discovery-smoke: FAIL: ${error.code || 'ERROR'} ${error.message}`);
  if (error.terminalTail) console.error(`terminal: ${error.terminalTail}`);
  if (error.targetSummary) console.error(`targets: ${JSON.stringify(error.targetSummary)}`);
  process.exit(1);
});

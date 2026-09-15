const assert = require('assert');
const { discoverRenderedPages } = require('../server/services/cypressPageDiscovery');

(async () => {
  const target = String(process.env.RENDERED_DISCOVERY_SMOKE_URL || 'http://127.0.0.1:4000/capabilities.html');
  const browser = String(process.env.AUTOMATION_BROWSER || 'chrome');
  const pages = await discoverRenderedPages([target], { browser, maxPages: 1 });

  assert(Array.isArray(pages), 'Rendered discovery must return an array.');
  assert.equal(pages.length, 1, `Expected exactly one grounded page, received ${pages.length}.`);
  const page = pages[0];
  assert(/^https?:\/\//i.test(String(page.finalUrl || page.url || '')), 'Grounded page must carry its real browser URL.');
  assert(Array.isArray(page.elements), 'Grounded page must contain an element registry source.');
  assert(page.elements.length > 0, 'Grounded page must contain at least one rendered element.');
  assert.equal(page.discoveryEngine, 'BROWSER_RENDERED_DOM');
  assert(page.capabilityDiscovery && Number(page.capabilityDiscovery.capturedElements) > 0, 'Capability discovery must report captured rendered elements.');

  console.log(`rendered-discovery-smoke: PASS (${page.elements.length} rendered elements from ${page.finalUrl || page.url})`);
})().catch((err) => {
  console.error(`rendered-discovery-smoke: FAIL: ${err.code || 'ERROR'} ${err.message}`);
  if (err.diagnosticFile) console.error(`diagnostic: ${err.diagnosticFile}`);
  process.exit(1);
});

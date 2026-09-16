const assert = require('assert');
const path = require('path');

const configPath = path.join(__dirname, '..', 'automation-system', 'engine.config.js');
const config = require(configPath);

assert(config && typeof config === 'object', 'automation config must export an object');
assert.equal(config.testIsolation, undefined, 'testIsolation must not be configured at the Cypress root');
assert(config.e2e && typeof config.e2e === 'object', 'e2e configuration is required');
assert.equal(config.e2e.testIsolation, true, 'e2e.testIsolation must be enabled');
assert.equal(typeof config.e2e.setupNodeEvents, 'function', 'e2e.setupNodeEvents must remain configured');
assert.equal(config.e2e.includeShadowDom, true, 'open Shadow DOM support must remain enabled');

const previousDiscovery = process.env.CYPRESS_DISCOVERY_ENABLED;
const previousLiveStream = process.env.AUTOMATION_LIVE_STREAM;
const previousFakeMedia = process.env.AUTOMATION_FAKE_MEDIA_PERMISSIONS;
const previousBaseUrl = process.env.AUTOMATION_BASE_URL;
try {
  process.env.CYPRESS_DISCOVERY_ENABLED = 'true';
  process.env.AUTOMATION_LIVE_STREAM = 'true';
  process.env.AUTOMATION_FAKE_MEDIA_PERMISSIONS = 'true';
  process.env.AUTOMATION_BASE_URL = 'https://academy.ibsservices.co';

  // Reload the config after setting discovery mode. Hidden discovery visits an absolute
  // URL and must never anchor Cypress's own /__/ runner to the external AUT origin.
  delete require.cache[require.resolve(configPath)];
  const discoveryConfig = require(configPath);
  assert.strictEqual(discoveryConfig.e2e.baseUrl, null, 'hidden discovery must not configure an external Cypress baseUrl');

  let beforeBrowserLaunch = null;
  const on = (event, handler) => {
    if (event === 'before:browser:launch') beforeBrowserLaunch = handler;
  };
  const runtimeConfig = {
    env: {},
    browser: { name: 'chrome' },
  };
  discoveryConfig.e2e.setupNodeEvents(on, runtimeConfig);
  assert.equal(typeof beforeBrowserLaunch, 'function', 'before:browser:launch hook must be registered');

  for (const browser of [
    { family: 'chromium', name: 'chrome' },
    { family: 'chromium', name: 'electron' },
  ]) {
    const launchOptions = { args: [] };
    const returned = beforeBrowserLaunch(browser, launchOptions);
    assert.strictEqual(returned, launchOptions, `${browser.name} discovery launch options should be returned unchanged`);
    assert.deepEqual(launchOptions.args, [], `${browser.name} hidden discovery must not receive execution-only browser arguments`);
  }
} finally {
  if (previousDiscovery === undefined) delete process.env.CYPRESS_DISCOVERY_ENABLED;
  else process.env.CYPRESS_DISCOVERY_ENABLED = previousDiscovery;
  if (previousLiveStream === undefined) delete process.env.AUTOMATION_LIVE_STREAM;
  else process.env.AUTOMATION_LIVE_STREAM = previousLiveStream;
  if (previousFakeMedia === undefined) delete process.env.AUTOMATION_FAKE_MEDIA_PERMISSIONS;
  else process.env.AUTOMATION_FAKE_MEDIA_PERMISSIONS = previousFakeMedia;
  if (previousBaseUrl === undefined) delete process.env.AUTOMATION_BASE_URL;
  else process.env.AUTOMATION_BASE_URL = previousBaseUrl;
  delete require.cache[require.resolve(configPath)];
}

console.log('automation-config-smoke: PASS');

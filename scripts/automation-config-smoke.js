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

console.log('automation-config-smoke: PASS');

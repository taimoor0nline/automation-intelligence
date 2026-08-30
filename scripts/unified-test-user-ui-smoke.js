const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const actorUi = fs.readFileSync(path.join(root, 'testpilot-ui', 'test-actors.js'), 'utf8');
const loginVisibility = fs.readFileSync(path.join(root, 'testpilot-ui', 'test-actor-login-visibility.js'), 'utf8');
const progressive = fs.readFileSync(path.join(root, 'testpilot-ui', 'progressive-generation.js'), 'utf8');

assert(actorUi.includes('Test users & workflow'), 'Unified panel title is missing.');
assert(actorUi.includes('Default User'), 'Single-user Default User guidance is missing.');
assert(actorUi.includes('legacyUsernameField.hidden = true'), 'Legacy username UI is not hidden.');
assert(actorUi.includes('legacyPasswordField.hidden = true'), 'Legacy password UI is not hidden.');
assert(actorUi.includes("return 'actor_default'"), 'Default actor reference is not deterministic.');
assert(actorUi.includes('window.getTestNexusPrimaryCredentials'), 'Primary credential compatibility bridge is missing.');
assert(actorUi.includes("generateBtn?.addEventListener('click', syncLegacyPrimaryCredentials, true)"), 'Generation does not synchronize the primary actor into legacy compatibility fields.');
assert(actorUi.includes('payload.credentials = { username: runtime.credentials.username, password: runtime.credentials.password }'), 'Canonical generation is not receiving primary runtime credentials.');

assert(loginVisibility.includes('delete payload.credentials;'), 'No-login guard does not remove credentials.');
assert(loginVisibility.includes('delete payload.actorDirectorySessionId;'), 'No-login guard does not suppress imported actor directories.');
assert(loginVisibility.includes("username.value = ''"), 'No-login mode does not clear the hidden legacy username.');
assert(loginVisibility.includes("password.value = ''"), 'No-login mode does not clear the hidden legacy password.');

// The current progressive generator still intentionally reads the legacy DOM inputs.
// They are retained as hidden compatibility fields until the migration is complete.
assert(progressive.includes("$('username').value"), 'Expected compatibility username read changed; update the unified actor bridge/test.');
assert(progressive.includes("$('password').value"), 'Expected compatibility password read changed; update the unified actor bridge/test.');

console.log('Unified Test users & workflow regression: PASS');

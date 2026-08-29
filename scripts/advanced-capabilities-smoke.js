const assert = require('assert');
const { compileTestCase } = require('../server/services/automationDsl');
const { generateDeterministicAutomation } = require('../server/services/deterministicAutomationGenerator');

const discovery = [{
  url: 'http://localhost:4000/feedback',
  finalUrl: 'http://localhost:4000/feedback',
  elements: [
    { selector: '#file', id: 'file', tag: 'input', type: 'file' },
    { selector: '#dragSource', id: 'dragSource', tag: 'div', text: 'Source' },
    { selector: '#dropTarget', id: 'dropTarget', tag: 'div', text: 'Target' },
    { selector: '#copyBtn', id: 'copyBtn', tag: 'button', text: 'Copy' },
  ],
  messages: [],
}];

function tc(id, steps, expectedResults) {
  return { id, title: `Capability ${id}`, type: 'positive', priority: 'medium', preconditions: [], testData: {}, steps, expectedResults };
}

const directCases = [
  tc('TC101', [{ action: 'Navigate to', target: 'page', value: '/feedback' }], ['LCP at most 2500 ms']),
  tc('TC102', [{ action: 'Upload file', target: '#file', value: 'sample.pdf' }], ['Element #file exists']),
  tc('TC103', [{ action: 'Drag and drop', target: '#dragSource', value: '#dropTarget' }], ['Element #dropTarget is visible']),
  tc('TC104', [{ action: 'Navigate to', target: 'page', value: '/feedback' }], ['WebSocket message contains "ready"']),
  tc('TC105', [{ action: 'Click', target: '#copyBtn', value: null }], ['Clipboard contains "copied"']),
  tc('TC106', [{ action: 'Navigate to', target: 'page', value: '/feedback' }], ['Downloaded file "report.pdf" contains "Approved"']),
  tc('TC107', [{ action: 'Set browser permission', target: 'geolocation', value: 'granted' }, { action: 'Navigate to', target: 'page', value: '/feedback' }], ['Permission "geolocation" is granted']),
];

for (const item of directCases) {
  const compiled = compileTestCase(item, { pageDiscoveries: discovery, hasCredentials: false });
  assert.strictEqual(compiled.ok, true, `${item.id} should compile: ${compiled.reason || ''}`);
  item.automationReadiness = { status: 'READY', automationPlan: compiled.plan };
}

const operations = new Set(directCases.flatMap((item) => item.automationReadiness.automationPlan.assertions.map((assertion) => assertion.operation)));
for (const expected of [
  'ASSERT_WEB_VITAL_AT_MOST',
  'ASSERT_STREAM_MESSAGE_CONTAINS',
  'ASSERT_CLIPBOARD_CONTAINS',
  'ASSERT_DOWNLOADED_DOCUMENT_CONTAINS',
  'ASSERT_BROWSER_PERMISSION_EQUALS',
]) assert.ok(operations.has(expected), `missing ${expected}`);

const actionOperations = new Set(directCases.flatMap((item) => item.automationReadiness.automationPlan.actions.map((action) => action.operation)));
assert.ok(actionOperations.has('SELECT_FILE'));
assert.ok(actionOperations.has('DRAG_DROP'));
assert.ok(actionOperations.has('SET_PERMISSION_STATE'));

const generated = generateDeterministicAutomation(directCases);
assert.match(generated.script, /testNexusResolveUploadFixture/);
assert.match(generated.script, /DataTransfer/);
assert.match(generated.script, /__testNexusWebVitals/);
assert.match(generated.script, /__testNexusStreamMessages/);
assert.match(generated.script, /__testNexusClipboardWrites/);
assert.match(generated.script, /testNexusExtractDownloadedDocument/);

const oldAdapter = process.env.AUTOMATION_EXTERNAL_ADAPTER_URL;
const oldCapabilities = process.env.AUTOMATION_EXTERNAL_CAPABILITIES;
const oldDbEnabled = process.env.AUTOMATION_DB_ASSERTIONS_ENABLED;
const oldDbUrl = process.env.AUTOMATION_DB_ASSERTION_URL;
try {
  delete process.env.AUTOMATION_EXTERNAL_ADAPTER_URL;
  delete process.env.AUTOMATION_EXTERNAL_CAPABILITIES;
  process.env.AUTOMATION_DB_ASSERTIONS_ENABLED = 'false';
  delete process.env.AUTOMATION_DB_ASSERTION_URL;

  const email = compileTestCase(
    tc('TC201', [{ action: 'Navigate to', target: 'page', value: '/feedback' }], ['Email received containing "Welcome"']),
    { pageDiscoveries: discovery, hasCredentials: false }
  );
  assert.strictEqual(email.ok, false);
  assert.strictEqual(email.reasonCode, 'EXTERNAL_ADAPTER_NOT_CONFIGURED');

  const database = compileTestCase(
    tc('TC202', [{ action: 'Navigate to', target: 'page', value: '/feedback' }], ['Database query "feedback_created" field "status" equals "ACTIVE"']),
    { pageDiscoveries: discovery, hasCredentials: false }
  );
  assert.strictEqual(database.ok, false);
  assert.strictEqual(database.reasonCode, 'DATABASE_ASSERTION_NOT_CONFIGURED');

  const native = compileTestCase(
    tc('TC203', [{ action: 'Validate native mobile app', target: 'mobile app', value: null }], ['Native mobile app shows the dashboard']),
    { pageDiscoveries: discovery, hasCredentials: false }
  );
  assert.strictEqual(native.ok, false);
  assert.strictEqual(native.reasonCode, 'EXTERNAL_ADAPTER_NOT_CONFIGURED');
} finally {
  if (oldAdapter === undefined) delete process.env.AUTOMATION_EXTERNAL_ADAPTER_URL; else process.env.AUTOMATION_EXTERNAL_ADAPTER_URL = oldAdapter;
  if (oldCapabilities === undefined) delete process.env.AUTOMATION_EXTERNAL_CAPABILITIES; else process.env.AUTOMATION_EXTERNAL_CAPABILITIES = oldCapabilities;
  if (oldDbEnabled === undefined) delete process.env.AUTOMATION_DB_ASSERTIONS_ENABLED; else process.env.AUTOMATION_DB_ASSERTIONS_ENABLED = oldDbEnabled;
  if (oldDbUrl === undefined) delete process.env.AUTOMATION_DB_ASSERTION_URL; else process.env.AUTOMATION_DB_ASSERTION_URL = oldDbUrl;
}

console.log('advanced-capabilities-smoke: PASS');

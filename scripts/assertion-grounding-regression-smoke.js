const assert = require('assert');
const { compileTestCase } = require('../server/services/automationDsl');

const pageDiscoveries = [{
  url: 'http://localhost:4000/feedback',
  finalUrl: 'http://localhost:4000/feedback',
  elements: [],
  messages: [{
    selector: '#successPanel',
    id: 'successPanel',
    className: 'success-panel',
    tag: 'div',
    text: 'Thank you for your feedback.',
  }],
}];

function testCase(expectedResult) {
  return {
    id: 'TC001',
    title: 'Validate feedback success panel',
    type: 'positive',
    priority: 'high',
    preconditions: [],
    testData: {},
    steps: [{ action: 'Navigate to', target: 'page', value: '/feedback' }],
    expectedResults: [expectedResult],
  };
}

const identityConflict = compileTestCase(
  testCase('Text contains "success-panel" in #successPanel'),
  { pageDiscoveries, hasCredentials: false }
);
assert.strictEqual(identityConflict.ok, false, 'selector/class identity must not compile as visible text');
assert.strictEqual(identityConflict.reasonCode, 'ASSERTION_TEXT_IDENTITY_CONFLICT');

const realText = compileTestCase(
  testCase('Text contains "Thank you for your feedback." in #successPanel'),
  { pageDiscoveries, hasCredentials: false }
);
assert.strictEqual(realText.ok, true, 'independently discovered visible text should compile');
assert.ok(
  realText.plan.assertions.some((item) => item.operation === 'ASSERT_TEXT_CONTAINS' && item.text === 'Thank you for your feedback.'),
  'real visible text assertion should be preserved'
);

const hidden = compileTestCase(
  testCase('Element #successPanel is hidden'),
  { pageDiscoveries, hasCredentials: false }
);
assert.strictEqual(hidden.ok, true, 'explicit structural hidden intent should compile');
assert.ok(hidden.plan.assertions.some((item) => item.operation === 'ASSERT_HIDDEN'));

console.log('assertion-grounding-regression-smoke: PASS');

const assert = require('assert');
const { buildCanonicalElementRegistry } = require('../server/services/canonicalElementRegistry');
const { validateCanonicalIr } = require('../server/services/canonicalTestIrV2');
const { classifyTestCase, READY } = require('../server/services/testCaseFeasibility');

const pageDiscoveries = [
  {
    url: 'http://localhost:4000/',
    finalUrl: 'http://localhost:4000/',
    title: 'Login',
    elements: [
      { tag: 'input', type: 'text', testId: 'username', selector: '[data-testid="username"]', label: 'Username', required: true },
      { tag: 'input', type: 'password', testId: 'password', selector: '[data-testid="password"]', label: 'Password', required: true },
      { tag: 'button', type: 'submit', testId: 'login-button', selector: '[data-testid="login-button"]', text: 'Sign in' },
    ],
  },
  {
    url: 'http://localhost:4000/feedback',
    finalUrl: 'http://localhost:4000/feedback',
    title: 'Feedback',
    elements: [
      { tag: 'input', type: 'email', testId: 'email', selector: '[data-testid="email"]', label: 'Email', required: true, errorElement: { tag: 'div', testId: 'email-error', selector: '[data-testid="email-error"]', text: '' } },
      { tag: 'input', type: 'number', testId: 'age', selector: '[data-testid="age"]', label: 'Age', min: '18', max: '100', errorElement: { tag: 'div', testId: 'age-error', selector: '[data-testid="age-error"]', text: '' } },
      { tag: 'input', type: 'text', testId: 'subject', selector: '[data-testid="subject"]', label: 'Subject', minlength: '3', maxlength: '100' },
      { tag: 'select', testId: 'category', selector: '[data-testid="category"]', label: 'Category', options: [{ value: 'product', text: 'Product' }, { value: 'service', text: 'Service' }] },
      { tag: 'button', type: 'submit', testId: 'submit-feedback', selector: '[data-testid="submit-feedback"]', text: 'Submit feedback' },
    ],
    messages: [
      { tag: 'section', testId: 'success-panel', selector: '[data-testid="success-panel"]', text: 'Thank you for your feedback.' },
    ],
  },
];

const registry = buildCanonicalElementRegistry(pageDiscoveries);
assert.equal(registry.version, 1);
assert.equal(registry.pages.length, 2);
assert.ok(registry.registryHash && registry.registryHash.length === 64);

const refs = new Map(registry.elements.map((item) => [item.elementRef, item]));
for (const ref of ['el_username','el_password','el_email','el_age','el_subject','el_category','msg_success-panel']) {
  assert.ok(refs.has(ref), `expected canonical ref ${ref}`);
}
assert.equal(refs.get('el_age').selector, '[data-testid="age"]');
assert.equal(refs.get('el_email').errorRef, 'err_email-error');
assert.ok(refs.get('el_email').capabilities.includes('TYPE'));
assert.ok(refs.get('el_email').capabilities.includes('VALIDITY'));
assert.ok(!refs.get('el_email').capabilities.includes('TEXT'), 'input label must not be treated as input DOM text');
assert.ok(refs.get('msg_success-panel').capabilities.includes('TEXT'));

const ageUnit = {
  plannedId: 'P001',
  category: 'FUNCTIONAL',
  scenarioType: 'boundary',
  objective: 'Verify age minimum boundary at 18 is accepted',
};
const ageIr = {
  version: 1,
  plannedId: 'P001',
  objective: ageUnit.objective,
  actions: [
    { operation: 'NAVIGATE', path: '/feedback' },
    { operation: 'TYPE', elementRef: 'el_age', value: '18' },
  ],
  assertions: [
    { operation: 'ASSERT_VALUE_EQUALS', elementRef: 'el_age', value: '18' },
    { operation: 'ASSERT_PATH_EQUALS', path: '/feedback' },
  ],
};
const ageValidation = validateCanonicalIr(ageIr, { registry, plannedUnit: ageUnit, hasCredentials: false });
assert.equal(ageValidation.ok, true, ageValidation.errors?.join('\n'));
assert.equal(ageValidation.plan.canonical, true);
assert.equal(ageValidation.plan.expectationCoverage.percent, 100);
assert.ok(ageValidation.plan.actions.some((item) => item.operation === 'TYPE' && item.selector === '[data-testid="age"]'));
assert.ok(ageValidation.plan.assertions.some((item) => item.operation === 'ASSERT_VALUE_EQUALS'));

const emailUnit = {
  plannedId: 'P002',
  category: 'FUNCTIONAL',
  scenarioType: 'negative',
  objective: 'Verify email input validates proper email format',
};
const drift = validateCanonicalIr({
  version: 1,
  plannedId: 'P002',
  objective: emailUnit.objective,
  actions: [{ operation: 'TYPE', elementRef: 'el_subject', value: 'x' }],
  assertions: [{ operation: 'ASSERT_VALUE_EQUALS', elementRef: 'el_subject', value: 'x' }],
}, { registry, plannedUnit: emailUnit, hasCredentials: false });
assert.equal(drift.ok, false);
assert.match(drift.errors.join(' '), /planned objective/i);

const wrongCapability = validateCanonicalIr({
  version: 1,
  plannedId: 'P003',
  actions: [{ operation: 'TYPE', elementRef: 'msg_success-panel', value: 'not legal' }],
  assertions: [{ operation: 'ASSERT_VISIBLE', elementRef: 'msg_success-panel' }],
}, { registry, hasCredentials: false });
assert.equal(wrongCapability.ok, false);
assert.match(wrongCapability.errors.join(' '), /does not provide capability TYPE/i);

const rawSelector = validateCanonicalIr({
  version: 1,
  plannedId: 'P004',
  actions: [{ operation: 'TYPE', selector: '#age', elementRef: 'el_age', value: '17' }],
  assertions: [{ operation: 'ASSERT_VALUE_EQUALS', elementRef: 'el_age', value: '17' }],
}, { registry, hasCredentials: false });
assert.equal(rawSelector.ok, false);
assert.match(rawSelector.errors.join(' '), /elementRef, not selector/i);

const emptyType = validateCanonicalIr({
  version: 1,
  plannedId: 'P005',
  actions: [{ operation: 'TYPE', elementRef: 'el_email', value: '' }],
  assertions: [{ operation: 'ASSERT_VALUE_EMPTY', elementRef: 'el_email' }],
}, { registry, hasCredentials: false });
assert.equal(emptyType.ok, false);
assert.match(emptyType.errors.join(' '), /use CLEAR/i);

const identityText = validateCanonicalIr({
  version: 1,
  plannedId: 'P006',
  actions: [{ operation: 'NAVIGATE', path: '/feedback' }],
  assertions: [{ operation: 'ASSERT_TEXT_CONTAINS', elementRef: 'msg_success-panel', text: 'success-panel' }],
}, { registry, hasCredentials: false });
assert.equal(identityText.ok, false);
assert.match(identityText.errors.join(' '), /element identity/i);

const actualText = validateCanonicalIr({
  version: 1,
  plannedId: 'P007',
  actions: [{ operation: 'NAVIGATE', path: '/feedback' }],
  assertions: [{ operation: 'ASSERT_TEXT_CONTAINS', elementRef: 'msg_success-panel', text: 'Thank you for your feedback.' }],
}, { registry, hasCredentials: false });
assert.equal(actualText.ok, true, actualText.errors?.join('\n'));

const runtimeCredentialIr = {
  version: 1,
  plannedId: 'P008',
  actions: [
    { operation: 'TYPE_RUNTIME_CREDENTIAL', elementRef: 'el_username', credential: 'username' },
    { operation: 'CLEAR', elementRef: 'el_password' },
    { operation: 'CLICK', elementRef: 'el_login-button' },
  ],
  assertions: [{ operation: 'ASSERT_PATH_EQUALS', path: '/' }],
};
const noCredentials = validateCanonicalIr(runtimeCredentialIr, { registry, hasCredentials: false });
assert.equal(noCredentials.ok, false);
assert.equal(noCredentials.reasonCode, 'MISSING_CREDENTIALS');
const withCredentials = validateCanonicalIr(runtimeCredentialIr, { registry, hasCredentials: true });
assert.equal(withCredentials.ok, true, withCredentials.errors?.join('\n'));
assert.equal(withCredentials.plan.actions[0].operation, 'TYPE_RUNTIME_CREDENTIAL');

const loginUnit = {
  plannedId: 'P009',
  category: 'FUNCTIONAL',
  scenarioType: 'positive',
  objective: 'Verify valid login succeeds',
};
const validLogin = validateCanonicalIr({
  version: 1,
  plannedId: 'P009',
  objective: loginUnit.objective,
  actions: [{ operation: 'LOGIN_VALID' }],
  assertions: [{ operation: 'ASSERT_PATH_EQUALS', path: '/feedback' }],
}, { registry, plannedUnit: loginUnit, hasCredentials: true });
assert.equal(validLogin.ok, true, validLogin.errors?.join('\n'));
assert.equal(validLogin.plan.actions[0].operation, 'LOGIN_VALID');

const canonicalTestCase = {
  id: 'TC001',
  title: 'Accept minimum valid age',
  type: 'boundary',
  testCategory: 'FUNCTIONAL',
  priority: 'high',
  preconditions: [],
  testData: {},
  steps: ageValidation.display.steps,
  expectedResults: ageValidation.display.expectedResults,
  canonicalIr: ageIr,
};
const readiness = classifyTestCase(canonicalTestCase, { pageDiscoveries, hasCredentials: false });
assert.equal(readiness.status, READY, `${readiness.reasonCode}: ${readiness.reason}`);
assert.equal(readiness.automationPlan.canonical, true);
assert.equal(readiness.expectationCoverage.percent, 100);

console.log('[canonical-architecture-smoke] PASS');
console.log(JSON.stringify({
  registryHash: registry.registryHash,
  pages: registry.pages.length,
  elements: registry.elements.length,
  ageReadiness: readiness.status,
  canonicalAssertions: readiness.automationPlan.assertions.length,
  validLogin: validLogin.ok,
}, null, 2));

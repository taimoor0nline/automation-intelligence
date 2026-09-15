const assert = require('assert');
const { buildCanonicalElementRegistry } = require('../server/services/canonicalElementRegistry');
const { validateStaticExpectationContract } = require('../server/services/staticExpectationContract');

const pages = [
  {
    url: 'https://example.test/login', finalUrl: 'https://example.test/login', pageTitle: 'Login',
    elements: [
      { tag: 'input', type: 'email', id: 'email', selector: '#email', formId: 'loginForm', placeholder: 'Work email', maxlength: '100', label: 'Email' },
      { tag: 'button', type: 'submit', id: 'submit', selector: '#submit', formId: 'loginForm', label: 'Login', text: 'Login' },
      { tag: 'a', type: 'a', id: 'help', selector: '#help', href: '/help', label: 'Help', text: 'Help' },
    ], messages: [], networkHints: [], browserState: { cookieNames: [], localStorageKeys: [], sessionStorageKeys: [] },
  },
  {
    url: 'https://example.test/help', finalUrl: 'https://example.test/help', pageTitle: 'Help Center',
    elements: [{ tag: 'h1', type: 'h1', id: 'help-title', selector: '#help-title', text: 'Help Center' }],
    messages: [], networkHints: [], browserState: { cookieNames: [], localStorageKeys: [], sessionStorageKeys: [] },
  },
  {
    url: 'https://example.test/dashboard', finalUrl: 'https://example.test/dashboard', pageTitle: 'Dashboard',
    elements: [], messages: [], networkHints: [], browserState: { cookieNames: [], localStorageKeys: [], sessionStorageKeys: [] },
  },
];

const registry = buildCanonicalElementRegistry(pages);
const byId = new Map(registry.elements.filter((item) => item.id).map((item) => [item.id, item]));
const ref = (id) => byId.get(id).elementRef;

function validate(story, actions, assertions) {
  const testCase = {
    id: 'TCX',
    generationStory: story,
    canonicalIr: { actions, assertions },
  };
  return validateStaticExpectationContract(testCase, registry, { story });
}

function has(result, code) { return result.errors.some((item) => item.code === code); }

let result = validate(
  'User can enter an email address and submit the login form.',
  [{ operation: 'NAVIGATE', path: '/login' }],
  [{ operation: 'ASSERT_MAXLENGTH_EQUALS', elementRef: ref('email'), value: '50' }]
);
assert.equal(result.ok, false);
assert.equal(has(result, 'AUTOMATION_STATIC_EXPECTATION_UNGROUNDED'), true);

result = validate(
  'Email must allow a maximum of 50 characters.',
  [{ operation: 'NAVIGATE', path: '/login' }],
  [{ operation: 'ASSERT_MAXLENGTH_EQUALS', elementRef: ref('email'), value: '50' }]
);
assert.equal(result.ok, true, JSON.stringify(result.errors));

result = validate(
  'User can enter an email address.',
  [{ operation: 'NAVIGATE', path: '/login' }],
  [{ operation: 'ASSERT_INPUT_TYPE_EQUALS', elementRef: ref('email'), value: 'email' }]
);
assert.equal(result.ok, true, JSON.stringify(result.errors));

result = validate(
  'User can open the Help page.',
  [
    { operation: 'NAVIGATE', path: '/login' },
    { operation: 'CLICK', elementRef: ref('help') },
  ],
  [{ operation: 'ASSERT_TITLE_EQUALS', text: 'Forgot Password' }]
);
assert.equal(result.ok, false);
assert.equal(has(result, 'AUTOMATION_DOCUMENT_EXPECTATION_UNGROUNDED'), true);

result = validate(
  'The Help page title must be Forgot Password.',
  [
    { operation: 'NAVIGATE', path: '/login' },
    { operation: 'CLICK', elementRef: ref('help') },
  ],
  [{ operation: 'ASSERT_TITLE_EQUALS', text: 'Forgot Password' }]
);
assert.equal(result.ok, true, JSON.stringify(result.errors));

result = validate(
  'User can submit the login form successfully.',
  [
    { operation: 'NAVIGATE', path: '/login' },
    { operation: 'SUBMIT', elementRef: ref('submit') },
  ],
  [{ operation: 'ASSERT_PATH_EQUALS', path: '/dashboard' }]
);
assert.equal(result.ok, false);
assert.equal(has(result, 'AUTOMATION_LOCATION_EXPECTATION_UNGROUNDED_TRANSITION'), true);

result = validate(
  'After successful login the user must be redirected to /dashboard.',
  [
    { operation: 'NAVIGATE', path: '/login' },
    { operation: 'SUBMIT', elementRef: ref('submit') },
  ],
  [{ operation: 'ASSERT_PATH_EQUALS', path: '/dashboard' }]
);
assert.equal(result.ok, true, JSON.stringify(result.errors));

result = validate(
  'User can open the Help page.',
  [{ operation: 'NAVIGATE', path: '/login' }],
  [{ operation: 'ASSERT_ATTR_EQUALS', elementRef: ref('help'), name: 'href', value: '/forgot-password' }]
);
assert.equal(result.ok, false);
assert.equal(has(result, 'AUTOMATION_STATIC_EXPECTATION_UNGROUNDED'), true);

console.log('static-expectation-contract-smoke: PASS');

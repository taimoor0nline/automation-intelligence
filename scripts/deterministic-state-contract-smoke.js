const assert = require('assert');
const { buildCanonicalElementRegistry } = require('../server/services/canonicalElementRegistry');
const { validateDeterministicStateContract } = require('../server/services/deterministicStateContract');

const pages = [
  {
    url: 'https://example.test/login', finalUrl: 'https://example.test/login', pageTitle: 'Login',
    elements: [
      { tag: 'input', type: 'text', id: 'username', selector: '#username', formId: 'loginForm', label: 'Username' },
      { tag: 'input', type: 'password', id: 'password', selector: '#password', formId: 'loginForm', label: 'Password' },
      { tag: 'button', type: 'submit', id: 'login-submit', selector: '#login-submit', formId: 'loginForm', label: 'Login', text: 'Login' },
      { tag: 'input', type: 'text', id: 'search', selector: '#search', formId: 'searchForm', label: 'Search' },
      { tag: 'button', type: 'submit', id: 'search-submit', selector: '#search-submit', formId: 'searchForm', label: 'Search', text: 'Search' },
      { tag: 'input', type: 'radio', id: 'role-user', name: 'role', selector: '#role-user', formId: 'loginForm', label: 'User' },
      { tag: 'input', type: 'radio', id: 'role-admin', name: 'role', selector: '#role-admin', formId: 'loginForm', label: 'Admin' },
      { tag: 'div', type: 'div', id: 'status', selector: '#status', text: 'Ready' },
      { tag: 'a', type: 'a', id: 'help', selector: '#help', href: '/help', label: 'Help', text: 'Help' },
    ],
    messages: [], networkHints: [], browserState: { cookieNames: ['sid'], localStorageKeys: ['theme'], sessionStorageKeys: [] },
  },
  {
    url: 'https://example.test/help', finalUrl: 'https://example.test/help', pageTitle: 'Help',
    elements: [{ tag: 'h1', type: 'h1', id: 'help-title', selector: '#help-title', text: 'Help' }],
    messages: [], networkHints: [], browserState: { cookieNames: ['sid'], localStorageKeys: ['theme'], sessionStorageKeys: [] },
  },
];

const registry = buildCanonicalElementRegistry(pages);
const byId = new Map(registry.elements.filter((item) => item.id).map((item) => [item.id, item]));
const ref = (id) => {
  const element = byId.get(id);
  assert(element, `missing registry element ${id}`);
  return element.elementRef;
};

function validate(actions, assertions) {
  return validateDeterministicStateContract({ actions, assertions }, registry);
}

function has(result, code) {
  return result.errors.some((item) => item.code === code);
}

let result = validate(
  [{ operation: 'NAVIGATE', path: '/login' }],
  [
    { operation: 'ASSERT_VISIBLE', elementRef: ref('status') },
    { operation: 'ASSERT_HIDDEN', elementRef: ref('status') },
  ]
);
assert.equal(result.ok, false);
assert.equal(has(result, 'AUTOMATION_CONTRADICTORY_FINAL_ASSERTIONS'), true);

result = validate(
  [{ operation: 'NAVIGATE', path: '/login' }],
  [
    { operation: 'ASSERT_NOT_EXISTS', elementRef: ref('status') },
    { operation: 'ASSERT_TEXT_CONTAINS', elementRef: ref('status'), text: 'Ready' },
  ]
);
assert.equal(has(result, 'AUTOMATION_CONTRADICTORY_FINAL_ASSERTIONS'), true);

result = validate(
  [{ operation: 'NAVIGATE', path: '/login' }],
  [
    { operation: 'ASSERT_TEXT_EQUALS', elementRef: ref('status'), text: 'Ready' },
    { operation: 'ASSERT_TEXT_EQUALS', elementRef: ref('status'), text: 'Done' },
  ]
);
assert.equal(has(result, 'AUTOMATION_CONFLICTING_FINAL_VALUES'), true);

result = validate(
  [{ operation: 'NAVIGATE', path: '/login' }],
  [
    { operation: 'ASSERT_COUNT_AT_LEAST', elementRef: ref('status'), count: 5 },
    { operation: 'ASSERT_COUNT_AT_MOST', elementRef: ref('status'), count: 3 },
  ]
);
assert.equal(has(result, 'AUTOMATION_IMPOSSIBLE_FINAL_RANGE'), true);

result = validate(
  [{ operation: 'NAVIGATE', path: '/login' }],
  [
    { operation: 'ASSERT_CHECKED', elementRef: ref('role-user') },
    { operation: 'ASSERT_CHECKED', elementRef: ref('role-admin') },
  ]
);
assert.equal(has(result, 'AUTOMATION_IMPOSSIBLE_RADIO_FINAL_STATE'), true);

result = validate(
  [
    { operation: 'NAVIGATE', path: '/login' },
    { operation: 'TYPE', elementRef: ref('search'), value: 'hello' },
    { operation: 'TYPE', elementRef: ref('username'), value: 'tester' },
    { operation: 'SUBMIT', elementRef: ref('login-submit') },
  ],
  [{ operation: 'ASSERT_VISIBLE', elementRef: ref('status') }]
);
assert.equal(has(result, 'AUTOMATION_FORM_OWNERSHIP_MISMATCH'), true);

result = validate(
  [
    { operation: 'NAVIGATE', path: '/login' },
    { operation: 'CLICK', elementRef: ref('help') },
  ],
  [{ operation: 'ASSERT_VISIBLE', elementRef: ref('username') }]
);
assert.equal(has(result, 'AUTOMATION_ASSERTION_PAGE_CONTEXT_MISMATCH'), true);

result = validate(
  [{ operation: 'NAVIGATE', path: '/login' }],
  [
    { operation: 'ASSERT_QUERY_PARAM_ABSENT', name: 'mode' },
    { operation: 'ASSERT_QUERY_PARAM_EQUALS', name: 'mode', value: 'edit' },
  ]
);
assert.equal(has(result, 'AUTOMATION_CONTRADICTORY_FINAL_ASSERTIONS'), true);

result = validate(
  [{ operation: 'NAVIGATE', path: '/login' }],
  [
    { operation: 'ASSERT_COOKIE_ABSENT', name: 'sid' },
    { operation: 'ASSERT_COOKIE_EXISTS', name: 'sid' },
  ]
);
assert.equal(has(result, 'AUTOMATION_CONTRADICTORY_FINAL_ASSERTIONS'), true);

result = validate(
  [{ operation: 'NAVIGATE', path: '/login' }],
  [
    { operation: 'ASSERT_TITLE_EQUALS', text: 'Login' },
    { operation: 'ASSERT_TITLE_EQUALS', text: 'Other' },
  ]
);
assert.equal(has(result, 'AUTOMATION_CONFLICTING_FINAL_VALUES'), true);

result = validate(
  [
    { operation: 'NAVIGATE', path: '/login' },
    { operation: 'TYPE', elementRef: ref('username'), value: 'tester' },
    { operation: 'TYPE', elementRef: ref('password'), value: 'secret' },
    { operation: 'SUBMIT', elementRef: ref('login-submit') },
  ],
  [{ operation: 'ASSERT_TEXT_NOT_EMPTY', elementRef: ref('status') }]
);
assert.equal(result.errors.some((item) => item.code === 'AUTOMATION_FORM_OWNERSHIP_MISMATCH'), false, JSON.stringify(result.errors));

console.log('deterministic-state-contract-smoke: PASS');

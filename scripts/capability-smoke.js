const assert = require("assert");
const { ASSERTION_OPERATIONS } = require("../server/services/assertionRegistry");
const { compileTestCase, ACTION_OPERATIONS } = require("../server/services/automationDsl");
const { generateDeterministicAutomation } = require("../server/services/deterministicAutomationGenerator");
const { annotatePageDiscovery, buildWebCapabilityMatrix } = require("../server/services/webCapabilityMatrix");
const { resolveExpectedResults } = require("../server/services/expectationGrounding");

assert(ASSERTION_OPERATIONS.length >= 100, `Expected at least 100 assertions, found ${ASSERTION_OPERATIONS.length}`);
assert(ACTION_OPERATIONS.includes("SET_VIEWPORT"));
assert(ACTION_OPERATIONS.includes("DBLCLICK"));
assert(ACTION_OPERATIONS.includes("PRESS_KEY"));

const pageDiscoveries = [annotatePageDiscovery({
  url: "http://localhost:4000/feedback.html",
  finalUrl: "http://localhost:4000/feedback.html",
  pageTitle: "Customer Feedback",
  documentLanguage: "en",
  elements: [
    { tag: "input", type: "email", testId: "email", selector: '[data-testid="email"]', label: "Email", required: true },
    { tag: "input", type: "checkbox", testId: "consent", selector: '[data-testid="consent"]', label: "Consent", required: true },
    { tag: "select", type: "select", testId: "category", selector: '[data-testid="category"]', label: "Category", options: [{ value: "product", label: "Product" }] },
    { tag: "div", type: "div", testId: "success-panel", selector: '[data-testid="success-panel"]', text: "Thank you for your feedback." },
    { tag: "button", type: "submit", testId: "submit-feedback", selector: '[data-testid="submit-feedback"]', text: "Submit Feedback" },
  ],
  messages: [],
  networkHints: [{ method: "POST", url: "/api/feedback", source: "fetch" }],
})];

const matrix = buildWebCapabilityMatrix(pageDiscoveries);
const bySelector = new Map(matrix.pages[0].elements.map((entry) => [entry.selector, new Set(entry.capabilities)]));
assert(bySelector.get('[data-testid="consent"]').has('CHECKED'));
assert(bySelector.get('[data-testid="consent"]').has('UNCHECKED'));
assert(bySelector.get('[data-testid="category"]').has('SELECTED_VALUE'));
assert(bySelector.get('[data-testid="category"]').has('OPTION_COUNT'));
assert(bySelector.get('[data-testid="email"]').has('VALID'));
assert(bySelector.get('[data-testid="email"]').has('REQUIRED'));
assert(bySelector.get('[data-testid="success-panel"]').has('TEXT'));
assert(!bySelector.get('[data-testid="success-panel"]').has('CHECKED'));

const grounded = resolveExpectedResults([
  'Consent is checked',
  'Success panel with text "Thank you for your feedback." is visible',
], pageDiscoveries);
assert.equal(grounded.records[0].selector, '[data-testid="consent"]');
assert(grounded.records[0].matchedCapabilities.includes('CHECKED'));
assert.equal(grounded.records[1].selector, '[data-testid="success-panel"]');
assert(grounded.records[1].matchedCapabilities.includes('TEXT'));

const testCase = {
  id: "TC-H001",
  title: "Submit feedback and verify API",
  preconditions: [],
  steps: [
    { action: "Navigate to the page", target: "page", value: "/feedback.html" },
    { action: "Enter email", target: '[data-testid="email"]', value: "demo@example.com" },
    { action: "Click submit", target: '[data-testid="submit-feedback"]', value: null },
  ],
  expectedResults: [
    'The element [data-testid="email"] is required',
    'POST request to "/api/feedback" is sent',
    'POST response status for "/api/feedback" is 200',
    "No console errors are observed",
  ],
};

const compiled = compileTestCase(testCase, { pageDiscoveries, hasCredentials: false });
assert.equal(compiled.ok, true, compiled.reason || JSON.stringify(compiled.errors));
const operations = compiled.plan.assertions.map((item) => item.operation);
assert(operations.includes("ASSERT_REQUIRED"));
assert(operations.includes("ASSERT_REQUEST_SENT"));
assert(operations.includes("ASSERT_RESPONSE_STATUS"));
assert(operations.includes("ASSERT_NO_CONSOLE_ERRORS"));

const generated = generateDeterministicAutomation([{ ...testCase, automationReadiness: { automationPlan: compiled.plan } }]);
assert(generated.script.includes("cy.intercept"));
assert(generated.script.includes("__network"));
assert(generated.script.includes("__consoleErrors"));
assert(generated.script.includes("statusCode"));

const accessibilityCase = {
  id: "TC-H002",
  title: "Accessibility check",
  steps: [{ action: "Navigate to the page", target: "page", value: "/feedback.html" }],
  expectedResults: ["The page has no accessibility violations"],
};
const accessibilityCompiled = compileTestCase(accessibilityCase, { pageDiscoveries, hasCredentials: false });
assert.equal(accessibilityCompiled.ok, true, accessibilityCompiled.reason || JSON.stringify(accessibilityCompiled.errors));
const accessibilityGenerated = generateDeterministicAutomation([{ ...accessibilityCase, automationReadiness: { automationPlan: accessibilityCompiled.plan } }]);
assert(accessibilityGenerated.script.includes("cy.injectAxe()"));
assert(accessibilityGenerated.script.includes("cy.checkA11y()"));

const ungroundedCase = {
  id: "TC-H003",
  title: "Reject invented endpoint",
  steps: [{ action: "Navigate to the page", target: "page", value: "/feedback.html" }],
  expectedResults: ['POST response status for "/api/invented" is 200'],
};
const ungrounded = compileTestCase(ungroundedCase, { pageDiscoveries, hasCredentials: false });
assert.equal(ungrounded.ok, false);
assert.equal(ungrounded.reasonCode, "NETWORK_ENDPOINT_NOT_GROUNDED");

// Regression: a valid cross-page journey must not execute AI-invented login values.
// When runtime credentials are available and the discovered workflow crosses from
// login controls to controls on another page, V6 collapses the login sequence to LOGIN_VALID.
const crossPageDiscoveries = [
  annotatePageDiscovery({
    url: 'http://localhost:4000/',
    finalUrl: 'http://localhost:4000/',
    pageTitle: 'Login',
    elements: [
      { tag: 'input', type: 'text', testId: 'username', selector: '[data-testid="username"]', label: 'Username' },
      { tag: 'input', type: 'password', testId: 'password', selector: '[data-testid="password"]', label: 'Password' },
      { tag: 'button', type: 'submit', testId: 'login-button', selector: '[data-testid="login-button"]', text: 'Sign in' },
    ],
    messages: [],
  }),
  annotatePageDiscovery({
    url: 'http://localhost:4000/feedback',
    finalUrl: 'http://localhost:4000/feedback',
    pageTitle: 'Feedback',
    elements: [
      { tag: 'input', type: 'text', testId: 'full-name', selector: '[data-testid="full-name"]', label: 'Full name', required: true },
      { tag: 'button', type: 'submit', testId: 'submit-feedback', selector: '[data-testid="submit-feedback"]', text: 'Submit' },
    ],
    messages: [],
  }),
];
const validJourney = {
  id: 'TC-H004',
  title: 'Successful authenticated feedback journey',
  type: 'functional',
  preconditions: ['User can authenticate with valid credentials'],
  steps: [
    { action: 'fill', target: '[data-testid="username"]', value: 'invented-user' },
    { action: 'fill', target: '[data-testid="password"]', value: 'invented-password' },
    { action: 'click', target: '[data-testid="login-button"]', value: null },
    { action: 'fill', target: '[data-testid="full-name"]', value: 'Jane Smith' },
  ],
  expectedResults: ['Element [data-testid="full-name"] is visible'],
};
const validJourneyCompiled = compileTestCase(validJourney, { pageDiscoveries: crossPageDiscoveries, hasCredentials: true });
assert.equal(validJourneyCompiled.ok, true, validJourneyCompiled.reason || JSON.stringify(validJourneyCompiled.errors));
assert.equal(validJourneyCompiled.plan.actions[0].operation, 'LOGIN_VALID');
assert(!validJourneyCompiled.plan.actions.some((action) => action.operation === 'TYPE' && action.value === 'invented-user'));
assert(validJourneyCompiled.plan.actions.some((action) => action.operation === 'TYPE' && action.selector === '[data-testid="full-name"]'));

const invalidLoginCase = {
  ...validJourney,
  id: 'TC-H005',
  title: 'Reject invalid login credentials',
  type: 'negative',
  expectedResults: ['Login error is displayed'],
};
const invalidLoginCompiled = compileTestCase(invalidLoginCase, { pageDiscoveries: crossPageDiscoveries, hasCredentials: true });
assert(!invalidLoginCompiled.plan?.actions?.some((action) => action.operation === 'LOGIN_VALID'));

console.log(`Capability smoke test passed: ${ASSERTION_OPERATIONS.length} assertions, ${ACTION_OPERATIONS.length} actions, ${matrix.elementCount} capability-mapped elements.`);

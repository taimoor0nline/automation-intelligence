const assert = require("assert");
const { ASSERTION_OPERATIONS } = require("../server/services/assertionRegistry");
const { compileTestCase, ACTION_OPERATIONS } = require("../server/services/automationDsl");
const { generateDeterministicAutomation } = require("../server/services/deterministicAutomationGenerator");

assert(ASSERTION_OPERATIONS.length >= 100, `Expected at least 100 assertions, found ${ASSERTION_OPERATIONS.length}`);
assert(ACTION_OPERATIONS.includes("SET_VIEWPORT"));
assert(ACTION_OPERATIONS.includes("DBLCLICK"));
assert(ACTION_OPERATIONS.includes("PRESS_KEY"));

const pageDiscoveries = [{
  url: "http://localhost:4000/feedback.html",
  finalUrl: "http://localhost:4000/feedback.html",
  pageTitle: "Customer Feedback",
  documentLanguage: "en",
  elements: [
    { tag: "input", type: "email", testId: "email", selector: '[data-testid="email"]', required: true },
    { tag: "button", type: "submit", testId: "submit-feedback", selector: '[data-testid="submit-feedback"]' },
  ],
  messages: [],
  networkHints: [{ method: "POST", url: "/api/feedback", source: "fetch" }],
}];

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

console.log(`Capability smoke test passed: ${ASSERTION_OPERATIONS.length} assertions, ${ACTION_OPERATIONS.length} actions.`);

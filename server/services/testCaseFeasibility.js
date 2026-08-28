const { compileTestCase } = require("./automationDsl");

const READY = "READY";
const NOT_AUTOMATABLE = "NOT_AUTOMATABLE";
const INSUFFICIENT_EVIDENCE = "INSUFFICIENT_EVIDENCE";
const REQUIRES_FRAMEWORK_CAPABILITY = "REQUIRES_FRAMEWORK_CAPABILITY";
const INVALID_TEST_CASE = "INVALID_TEST_CASE";

const RESOLUTION_NONE = "NONE";
const RESOLUTION_AI_REPAIRABLE = "AI_REPAIRABLE";
const RESOLUTION_USER_INPUT_REQUIRED = "USER_INPUT_REQUIRED";
const RESOLUTION_MANUAL_TESTING = "MANUAL_TESTING";
const RESOLUTION_FRAMEWORK_CHANGE_REQUIRED = "FRAMEWORK_CHANGE_REQUIRED";

const CAPABILITY_RULES = [
  { pattern: /\b(captcha|recaptcha|hcaptcha)\b/i, status: NOT_AUTOMATABLE, reasonCode: "CAPTCHA_REQUIRED", resolutionType: RESOLUTION_MANUAL_TESTING, reason: "The scenario requires a CAPTCHA challenge, which the configured automation system intentionally does not automate." },
  { pattern: /\b(face\s?id|fingerprint|biometric|touch\s?id)\b/i, status: NOT_AUTOMATABLE, reasonCode: "BIOMETRIC_REQUIRED", resolutionType: RESOLUTION_MANUAL_TESTING, reason: "The scenario requires native biometric interaction, which is outside the configured web automation system." },
  { pattern: /\b(native\s+file\s+(?:dialog|picker)|windows\s+(?:dialog|prompt)|os\s+(?:dialog|prompt))\b/i, status: REQUIRES_FRAMEWORK_CAPABILITY, reasonCode: "NATIVE_OS_DIALOG_REQUIRED", resolutionType: RESOLUTION_FRAMEWORK_CHANGE_REQUIRED, reason: "The scenario requires a native operating-system dialog that the configured automation system does not control." },
  { pattern: /\b(browser\s+extension|extension\s+popup)\b/i, status: REQUIRES_FRAMEWORK_CAPABILITY, reasonCode: "BROWSER_EXTENSION_REQUIRED", resolutionType: RESOLUTION_FRAMEWORK_CHANGE_REQUIRED, reason: "The scenario requires browser-extension UI outside the configured application automation surface." },
  { pattern: /\b(native\s+mobile|android\s+app|ios\s+app|mobile\s+app)\b/i, status: REQUIRES_FRAMEWORK_CAPABILITY, reasonCode: "NATIVE_MOBILE_REQUIRED", resolutionType: RESOLUTION_FRAMEWORK_CHANGE_REQUIRED, reason: "The scenario targets a native mobile application and requires a mobile automation capability." },
  { pattern: /\b(camera\s+permission|microphone\s+permission|system\s+permission\s+prompt)\b/i, status: REQUIRES_FRAMEWORK_CAPABILITY, reasonCode: "SYSTEM_PERMISSION_PROMPT_REQUIRED", resolutionType: RESOLUTION_FRAMEWORK_CHANGE_REQUIRED, reason: "The scenario depends on a browser or operating-system permission prompt outside the current deterministic interaction contract." },
];

function result({
  status,
  automatable,
  reasonCode,
  reason,
  reasons = [],
  resolutionType,
  requiredInputs = [],
  evidence = [],
  automationPlan = null,
  assertionSuggestions = [],
  uncompiledExpectations = [],
}) {
  return {
    status,
    automatable,
    reasonCode,
    reason,
    reasons: reasons.length ? [...new Set(reasons)] : [reason],
    resolutionType,
    repairable: resolutionType === RESOLUTION_AI_REPAIRABLE,
    requiredInputs,
    evidence,
    automationPlan,
    assertionSuggestions: Array.isArray(assertionSuggestions) ? assertionSuggestions : [],
    uncompiledExpectations: Array.isArray(uncompiledExpectations) ? uncompiledExpectations : [],
    // A READY test is already executable. Optional narrative-strengthening ideas remain
    // available in metadata, but they should not be presented as another repair action.
    canSuggestAssertion: status !== READY && Boolean((assertionSuggestions || []).length || (uncompiledExpectations || []).length || resolutionType === RESOLUTION_FRAMEWORK_CHANGE_REQUIRED),
    validationSource: "deterministic",
  };
}

function addSelector(set, value) {
  const selector = String(value || "").trim();
  if (selector) set.add(selector);
}

function buildDiscoveryEvidence(pageDiscoveries = []) {
  const selectors = new Set();
  const paths = new Set();
  for (const page of pageDiscoveries || []) {
    try {
      const url = new URL(page?.finalUrl || page?.url || "http://local/");
      paths.add(`${url.pathname}${url.search}` || "/");
    } catch {}
    for (const item of page?.elements || []) {
      addSelector(selectors, item.selector);
      if (item.testId) addSelector(selectors, `[data-testid="${item.testId}"]`);
      if (item.id) addSelector(selectors, `#${item.id}`);
      if (item.name) addSelector(selectors, `[name="${item.name}"]`);
      const error = item.errorElement;
      addSelector(selectors, error?.selector);
      if (error?.testId) addSelector(selectors, `[data-testid="${error.testId}"]`);
      if (error?.id) addSelector(selectors, `#${error.id}`);
    }
    for (const message of page?.messages || []) {
      addSelector(selectors, message.selector);
      if (message.testId) addSelector(selectors, `[data-testid="${message.testId}"]`);
      if (message.id) addSelector(selectors, `#${message.id}`);
    }
  }
  return { selectors, paths };
}

function looksLikeSelector(value) {
  const text = String(value || "").trim();
  return text.startsWith("[") || text.startsWith("#") || text.startsWith(".");
}

function requiresRuntimeCredentials(testCase) {
  return (testCase.preconditions || []).some((item) => /valid test credentials|configured test credentials|runtime credentials/i.test(String(item))) ||
    (testCase.steps || []).some((step) => /configured test (?:username|password)|valid credentials|runtime credentials/i.test(String(step?.action || "")));
}

function classifyTestCase(testCase, { pageDiscoveries = [], hasCredentials = false } = {}) {
  if (!testCase || typeof testCase !== "object") return result({ status: INVALID_TEST_CASE, automatable: false, reasonCode: "MALFORMED_TEST_CASE", reason: "The test case is missing or malformed.", resolutionType: RESOLUTION_AI_REPAIRABLE });
  if (!String(testCase.title || "").trim()) return result({ status: INVALID_TEST_CASE, automatable: false, reasonCode: "MISSING_TITLE", reason: "A test-case title is required.", resolutionType: RESOLUTION_AI_REPAIRABLE });
  if (!Array.isArray(testCase.steps) || !testCase.steps.length) return result({ status: INVALID_TEST_CASE, automatable: false, reasonCode: "MISSING_STEPS", reason: "At least one executable test step is required.", resolutionType: RESOLUTION_AI_REPAIRABLE });
  if (!Array.isArray(testCase.expectedResults) || !testCase.expectedResults.length) return result({ status: INVALID_TEST_CASE, automatable: false, reasonCode: "MISSING_EXPECTED_RESULTS", reason: "At least one expected result is required.", resolutionType: RESOLUTION_AI_REPAIRABLE });

  const fullText = JSON.stringify(testCase);
  for (const rule of CAPABILITY_RULES) if (rule.pattern.test(fullText)) return result({ ...rule, automatable: false });

  if (requiresRuntimeCredentials(testCase) && !hasCredentials) {
    return result({ status: INSUFFICIENT_EVIDENCE, automatable: false, reasonCode: "MISSING_CREDENTIALS", reason: "Valid runtime credentials are required for this test case but have not been supplied.", resolutionType: RESOLUTION_USER_INPUT_REQUIRED, requiredInputs: ["username", "password"] });
  }

  const discovery = buildDiscoveryEvidence(pageDiscoveries);
  const selectorProblems = [];
  const pathProblems = [];
  for (const step of testCase.steps) {
    const target = String(step?.target || "").trim();
    const action = String(step?.action || "").toLowerCase();
    const value = String(step?.value ?? "").trim();
    if (looksLikeSelector(target) && !discovery.selectors.has(target)) selectorProblems.push(target);
    if (/navigate|open|visit|continue to/.test(action) && value.startsWith("/") && !discovery.paths.has(value)) pathProblems.push(value);
  }

  if (selectorProblems.length) return result({ status: INSUFFICIENT_EVIDENCE, automatable: false, reasonCode: "UNDISCOVERED_SELECTOR", reason: `The test references a selector that was not verified during page discovery: ${selectorProblems[0]}`, reasons: selectorProblems.map((selector) => `Undiscovered selector: ${selector}`), resolutionType: RESOLUTION_AI_REPAIRABLE, evidence: [...discovery.selectors].slice(0, 50) });
  if (pathProblems.length) return result({ status: INSUFFICIENT_EVIDENCE, automatable: false, reasonCode: "UNDISCOVERED_PATH", reason: `The test references a navigation path that was not verified during page discovery: ${pathProblems[0]}`, reasons: pathProblems.map((path) => `Undiscovered navigation path: ${path}`), resolutionType: RESOLUTION_AI_REPAIRABLE, evidence: [...discovery.paths].slice(0, 30) });

  const compiled = compileTestCase(testCase, { pageDiscoveries, hasCredentials });
  if (!compiled.ok) {
    const userInput = compiled.reasonCode === "MISSING_CREDENTIALS";
    const assertionGap = compiled.reasonCode === "ASSERTION_CAPABILITY_MISSING";
    return result({
      status: assertionGap ? REQUIRES_FRAMEWORK_CAPABILITY : INSUFFICIENT_EVIDENCE,
      automatable: false,
      reasonCode: compiled.reasonCode || "AUTOMATION_CONTRACT_INCOMPLETE",
      reason: assertionGap
        ? "The expected behavior is valid, but the deterministic Cypress assertion registry does not yet contain a matching assertion capability."
        : compiled.reason || "The test case could not be compiled into the supported automation contract.",
      reasons: compiled.errors || [],
      resolutionType: userInput ? RESOLUTION_USER_INPUT_REQUIRED : assertionGap ? RESOLUTION_FRAMEWORK_CHANGE_REQUIRED : RESOLUTION_AI_REPAIRABLE,
      requiredInputs: userInput ? ["username", "password"] : [],
      evidence: compiled.supportedAssertions || compiled.supportedOperations || [],
      assertionSuggestions: compiled.assertionSuggestions || [],
      uncompiledExpectations: compiled.uncompiledExpectations || [],
    });
  }

  const suggestions = compiled.plan.assertionSuggestions || [];
  const narratives = compiled.plan.narrativeExpectations || [];
  return result({
    status: READY,
    automatable: true,
    reasonCode: suggestions.length ? "SUPPORTED_WITH_ASSERTION_SUGGESTIONS" : "SUPPORTED_GROUNDED_AND_COMPILED",
    reason: suggestions.length
      ? "The test has deterministic assertions and can run. Some narrative expectations also have optional assertion-capability suggestions for stronger coverage. Execution PASS/FAIL is determined only when the browser runs the test."
      : "The test case is grounded and compiled successfully into the deterministic Cypress contract. Automation Ready means executable; it does not predict PASS/FAIL. The execution outcome is determined only when the browser runs the test.",
    resolutionType: RESOLUTION_NONE,
    automationPlan: compiled.plan,
    assertionSuggestions: suggestions,
    uncompiledExpectations: narratives,
    evidence: [
      `${compiled.plan.actions.length} deterministic action(s) compiled`,
      `${compiled.plan.assertions.length} deterministic assertion(s) compiled`,
      `${discovery.selectors.size} discovered selector(s) available`,
      `${discovery.paths.size} discovered path(s) available`,
      hasCredentials ? "Runtime credentials available when required" : "No runtime credential dependency detected",
    ],
  });
}

function assessTestCases(testCases = [], context = {}) {
  return (testCases || []).map((testCase) => ({ ...testCase, automationReadiness: classifyTestCase(testCase, context) }));
}

function readinessSummary(testCases = []) {
  const summary = { total: testCases.length, ready: 0, manual: 0, insufficientEvidence: 0, invalid: 0, userInputRequired: 0, aiRepairable: 0, frameworkChangeRequired: 0, assertionSuggestions: 0 };
  for (const tc of testCases) {
    const readiness = tc?.automationReadiness || {};
    if (readiness.status === READY) summary.ready += 1;
    else if (readiness.status === INSUFFICIENT_EVIDENCE) summary.insufficientEvidence += 1;
    else if (readiness.status === INVALID_TEST_CASE) summary.invalid += 1;
    else summary.manual += 1;
    if (readiness.resolutionType === RESOLUTION_USER_INPUT_REQUIRED) summary.userInputRequired += 1;
    if (readiness.resolutionType === RESOLUTION_AI_REPAIRABLE) summary.aiRepairable += 1;
    if (readiness.resolutionType === RESOLUTION_FRAMEWORK_CHANGE_REQUIRED) summary.frameworkChangeRequired += 1;
    if (readiness.canSuggestAssertion) summary.assertionSuggestions += 1;
  }
  return summary;
}

module.exports = {
  READY,
  NOT_AUTOMATABLE,
  INSUFFICIENT_EVIDENCE,
  REQUIRES_FRAMEWORK_CAPABILITY,
  INVALID_TEST_CASE,
  RESOLUTION_NONE,
  RESOLUTION_AI_REPAIRABLE,
  RESOLUTION_USER_INPUT_REQUIRED,
  RESOLUTION_MANUAL_TESTING,
  RESOLUTION_FRAMEWORK_CHANGE_REQUIRED,
  classifyTestCase,
  assessTestCases,
  readinessSummary,
  buildDiscoveryEvidence,
};

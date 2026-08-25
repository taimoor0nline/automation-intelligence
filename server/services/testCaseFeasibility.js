const READY = "READY";
const NOT_AUTOMATABLE = "NOT_AUTOMATABLE";
const INSUFFICIENT_EVIDENCE = "INSUFFICIENT_EVIDENCE";
const REQUIRES_FRAMEWORK_CAPABILITY = "REQUIRES_FRAMEWORK_CAPABILITY";
const INVALID_TEST_CASE = "INVALID_TEST_CASE";

const NATIVE_CAPABILITY_RULES = [
  { pattern: /\b(captcha|recaptcha|hcaptcha)\b/i, status: NOT_AUTOMATABLE, reason: "CAPTCHA interaction is intentionally not automated by the current browser test runtime." },
  { pattern: /\b(face\s?id|fingerprint|biometric|touch\s?id)\b/i, status: NOT_AUTOMATABLE, reason: "Native biometric interaction is outside the current Cypress browser automation capability." },
  { pattern: /\b(native\s+file\s+(?:dialog|picker)|windows\s+(?:dialog|prompt)|os\s+(?:dialog|prompt))\b/i, status: REQUIRES_FRAMEWORK_CAPABILITY, reason: "The scenario requires a native operating-system dialog that the configured browser runtime does not control." },
  { pattern: /\b(browser\s+extension|extension\s+popup)\b/i, status: REQUIRES_FRAMEWORK_CAPABILITY, reason: "Browser-extension UI is outside the configured Cypress application-under-test surface." },
  { pattern: /\b(native\s+mobile|android\s+app|ios\s+app|mobile\s+app)\b/i, status: REQUIRES_FRAMEWORK_CAPABILITY, reason: "Native mobile-app interaction requires a mobile automation framework rather than this Cypress web runtime." },
  { pattern: /\b(camera\s+permission|microphone\s+permission|system\s+permission\s+prompt)\b/i, status: REQUIRES_FRAMEWORK_CAPABILITY, reason: "The scenario depends on a browser/OS permission prompt that is not part of the current deterministic web interaction contract." },
];

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

function classifyTestCase(testCase, { pageDiscoveries = [], hasCredentials = false } = {}) {
  const reasons = [];
  if (!testCase || typeof testCase !== "object") {
    return { status: INVALID_TEST_CASE, automatable: false, reason: "Test case is missing or malformed.", reasons: ["Test case is missing or malformed."] };
  }

  if (!String(testCase.title || "").trim()) reasons.push("A title is required.");
  if (!Array.isArray(testCase.steps) || !testCase.steps.length) reasons.push("At least one executable step is required.");
  if (!Array.isArray(testCase.expectedResults) || !testCase.expectedResults.length) reasons.push("At least one expected result is required.");
  if (reasons.length) return { status: INVALID_TEST_CASE, automatable: false, reason: reasons[0], reasons };

  const fullText = JSON.stringify(testCase);
  for (const rule of NATIVE_CAPABILITY_RULES) {
    if (rule.pattern.test(fullText)) {
      return { status: rule.status, automatable: false, reason: rule.reason, reasons: [rule.reason] };
    }
  }

  const evidence = buildDiscoveryEvidence(pageDiscoveries);
  const evidenceProblems = [];

  for (const step of testCase.steps) {
    const target = String(step?.target || "").trim();
    const action = String(step?.action || "").toLowerCase();
    const value = String(step?.value ?? "").trim();

    if (looksLikeSelector(target) && !evidence.selectors.has(target)) {
      evidenceProblems.push(`Undiscovered selector: ${target}`);
    }

    if (/navigate|open|visit|continue to/.test(action) && value.startsWith("/") && !evidence.paths.has(value)) {
      evidenceProblems.push(`Undiscovered navigation path: ${value}`);
    }
  }

  const requiresConfiguredCredentials = (testCase.preconditions || []).some((item) => /valid test credentials|configured test credentials/i.test(String(item))) ||
    (testCase.steps || []).some((step) => /configured test (?:username|password)|valid credentials/i.test(String(step?.action || "")));

  if (requiresConfiguredCredentials && !hasCredentials) {
    evidenceProblems.push("Valid runtime credentials are required but were not supplied.");
  }

  if (evidenceProblems.length) {
    return {
      status: INSUFFICIENT_EVIDENCE,
      automatable: false,
      reason: evidenceProblems[0],
      reasons: [...new Set(evidenceProblems)],
    };
  }

  return {
    status: READY,
    automatable: true,
    reason: "Supported by the current Cypress browser runtime and grounded in discovered application evidence.",
    reasons: [],
  };
}

function assessTestCases(testCases = [], context = {}) {
  return (testCases || []).map((testCase) => ({
    ...testCase,
    automationReadiness: classifyTestCase(testCase, context),
  }));
}

function readinessSummary(testCases = []) {
  const summary = { total: testCases.length, ready: 0, manual: 0, insufficientEvidence: 0, invalid: 0 };
  for (const tc of testCases) {
    const status = tc?.automationReadiness?.status;
    if (status === READY) summary.ready += 1;
    else if (status === INSUFFICIENT_EVIDENCE) summary.insufficientEvidence += 1;
    else if (status === INVALID_TEST_CASE) summary.invalid += 1;
    else summary.manual += 1;
  }
  return summary;
}

module.exports = {
  READY,
  NOT_AUTOMATABLE,
  INSUFFICIENT_EVIDENCE,
  REQUIRES_FRAMEWORK_CAPABILITY,
  INVALID_TEST_CASE,
  classifyTestCase,
  assessTestCases,
  readinessSummary,
  buildDiscoveryEvidence,
};

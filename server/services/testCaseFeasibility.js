const { compileTestCase, externalConfigured } = require("./automationDsl");
const { normalizeTestCaseForAutomation } = require("./automationCaseNormalizer");
const { normalizeActorProfiles, publicActorCatalog } = require("./testActorProfiles");
const requestContext = require("./requestContext");
const { getSession } = require("../data/sessionStore");

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

const MIN_EXPECTATION_COVERAGE_PERCENT = Math.max(1, Math.min(Number(process.env.AUTOMATION_MIN_EXPECTATION_COVERAGE_PERCENT || 100) || 100, 100));

const CAPABILITY_RULES = [
  { pattern: /\b(captcha|recaptcha|hcaptcha|face\s?id|fingerprint|biometric|touch\s?id)\b/i, capability: "CAPTCHA_BIOMETRIC", reasonCode: "SECURITY_CHALLENGE_ADAPTER_REQUIRED", reason: "This real security challenge requires the configured non-production security-challenge adapter; TestNexus never guesses or bypasses it implicitly." },
  { pattern: /\b(native\s+file\s+(?:dialog|picker)|windows\s+(?:dialog|prompt)|os\s+(?:dialog|prompt)|native\s+(?:os\s+)?dialog)\b/i, capability: "OS_DIALOG", reasonCode: "OS_DIALOG_ADAPTER_REQUIRED", reason: "Native operating-system dialogs require the configured OS automation adapter." },
  { pattern: /\b(browser\s+extension|extension\s+popup|extension\s+ui)\b/i, capability: "BROWSER_EXTENSION", reasonCode: "BROWSER_EXTENSION_ADAPTER_REQUIRED", reason: "Browser-extension UI requires the configured extension automation adapter." },
  { pattern: /\b(native\s+mobile|android\s+app|ios\s+app|mobile\s+app)\b/i, capability: "NATIVE_MOBILE", reasonCode: "NATIVE_MOBILE_ADAPTER_REQUIRED", reason: "Native mobile execution requires the configured mobile automation adapter." },
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
  expectationCoverage = null,
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
    expectationCoverage,
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

function normalizationEvidence(testCase) {
  return (testCase?._deterministicNormalizations || []).map((item) => `Deterministic normalization: ${item}`);
}

function credentialRefsFromMap(value = {}) {
  return Object.entries(value && typeof value === "object" ? value : {})
    .filter(([, credentials]) => credentials?.username && credentials?.password)
    .map(([actorRef]) => String(actorRef));
}

function resolveActorContext(context = {}) {
  let actorCatalog = publicActorCatalog(context.actorCatalog || []);
  let actorCredentialRefs = [...new Set((Array.isArray(context.actorCredentialRefs) ? context.actorCredentialRefs : []).map(String).filter(Boolean))];
  const current = requestContext.current();
  const session = current.sessionId ? getSession(current.sessionId) : null;

  if (!actorCatalog.length && session?.testActors?.length) actorCatalog = publicActorCatalog(session.testActors);
  if (!actorCredentialRefs.length && session?.actorCredentials) actorCredentialRefs = credentialRefsFromMap(session.actorCredentials);

  if ((!actorCatalog.length || !actorCredentialRefs.length) && Array.isArray(current.testActors) && current.testActors.length) {
    const normalized = normalizeActorProfiles(current.testActors);
    if (!actorCatalog.length) actorCatalog = normalized.catalog;
    if (!actorCredentialRefs.length) actorCredentialRefs = credentialRefsFromMap(normalized.credentials);
    if (session) {
      session.testActors = normalized.catalog;
      session.actorCredentials = normalized.credentials;
    }
  }

  return { actorCatalog, actorCredentialRefs };
}

function requiredActorRefs(testCase) {
  return [...new Set((testCase?.canonicalIr?.actions || [])
    .filter((action) => String(action?.operation || "").toUpperCase() === "LOGIN_AS_ACTOR")
    .map((action) => String(action?.actorRef || "").trim())
    .filter(Boolean))];
}

function classifyTestCase(testCase, context = {}) {
  const pageDiscoveries = context.pageDiscoveries || [];
  const hasCredentials = Boolean(context.hasCredentials);
  const actorContext = resolveActorContext(context);

  if (!testCase || typeof testCase !== "object") return result({ status: INVALID_TEST_CASE, automatable: false, reasonCode: "MALFORMED_TEST_CASE", reason: "The test case is missing or malformed.", resolutionType: RESOLUTION_AI_REPAIRABLE });
  if (!String(testCase.title || "").trim()) return result({ status: INVALID_TEST_CASE, automatable: false, reasonCode: "MISSING_TITLE", reason: "A test-case title is required.", resolutionType: RESOLUTION_AI_REPAIRABLE });
  if (!Array.isArray(testCase.steps) || !testCase.steps.length) return result({ status: INVALID_TEST_CASE, automatable: false, reasonCode: "MISSING_STEPS", reason: "At least one executable test step is required.", resolutionType: RESOLUTION_AI_REPAIRABLE });
  if (!Array.isArray(testCase.expectedResults) || !testCase.expectedResults.length) return result({ status: INVALID_TEST_CASE, automatable: false, reasonCode: "MISSING_EXPECTED_RESULTS", reason: "At least one expected result is required.", resolutionType: RESOLUTION_AI_REPAIRABLE });

  const normalized = normalizeTestCaseForAutomation(testCase, { pageDiscoveries, hasCredentials });
  const normalizationNotes = normalizationEvidence(normalized);
  const fullText = JSON.stringify(normalized);
  for (const rule of CAPABILITY_RULES) {
    if (!rule.pattern.test(fullText)) continue;
    if (externalConfigured(rule.capability)) continue;
    return result({
      status: REQUIRES_FRAMEWORK_CAPABILITY,
      automatable: false,
      reasonCode: rule.reasonCode,
      reason: `${rule.reason} Configure AUTOMATION_EXTERNAL_ADAPTER_URL and enable ${rule.capability}.`,
      resolutionType: RESOLUTION_FRAMEWORK_CHANGE_REQUIRED,
      requiredInputs: ["AUTOMATION_EXTERNAL_ADAPTER_URL", rule.capability],
      evidence: normalizationNotes,
    });
  }

  if (requiresRuntimeCredentials(normalized) && !hasCredentials) {
    return result({ status: INSUFFICIENT_EVIDENCE, automatable: false, reasonCode: "MISSING_CREDENTIALS", reason: "Valid runtime credentials are required for this test case but have not been supplied.", resolutionType: RESOLUTION_USER_INPUT_REQUIRED, requiredInputs: ["username", "password"], evidence: normalizationNotes });
  }

  const discovery = buildDiscoveryEvidence(pageDiscoveries);
  const selectorProblems = [];
  const pathProblems = [];
  for (const step of normalized.steps || []) {
    const target = String(step?.target || "").trim();
    const action = String(step?.action || "").toLowerCase();
    const value = String(step?.value ?? "").trim();
    if (looksLikeSelector(target) && !discovery.selectors.has(target)) selectorProblems.push(target);
    if (/navigate|open|visit|continue to/.test(action) && value.startsWith("/") && !discovery.paths.has(value)) pathProblems.push(value);
  }

  if (selectorProblems.length) return result({ status: INSUFFICIENT_EVIDENCE, automatable: false, reasonCode: "UNDISCOVERED_SELECTOR", reason: `The test references a selector that was not verified during page discovery: ${selectorProblems[0]}`, reasons: selectorProblems.map((selector) => `Undiscovered selector: ${selector}`), resolutionType: RESOLUTION_AI_REPAIRABLE, evidence: [...normalizationNotes, ...[...discovery.selectors].slice(0, 50)] });
  if (pathProblems.length) return result({ status: INSUFFICIENT_EVIDENCE, automatable: false, reasonCode: "UNDISCOVERED_PATH", reason: `The test references a navigation path that was not verified during page discovery: ${pathProblems[0]}`, reasons: pathProblems.map((path) => `Undiscovered navigation path: ${path}`), resolutionType: RESOLUTION_AI_REPAIRABLE, evidence: [...normalizationNotes, ...[...discovery.paths].slice(0, 30)] });

  const compiled = compileTestCase(normalized, {
    pageDiscoveries,
    hasCredentials,
    actorCatalog: actorContext.actorCatalog,
    actorCredentialRefs: actorContext.actorCredentialRefs,
  });
  if (!compiled.ok) {
    const userInput = ["MISSING_CREDENTIALS", "MISSING_ACTOR_CREDENTIALS"].includes(compiled.reasonCode);
    const assertionGap = compiled.reasonCode === "ASSERTION_CAPABILITY_MISSING";
    const configurationGap = ["EXTERNAL_ADAPTER_NOT_CONFIGURED", "DATABASE_ASSERTION_NOT_CONFIGURED"].includes(compiled.reasonCode);
    const actorInputs = compiled.reasonCode === "MISSING_ACTOR_CREDENTIALS"
      ? requiredActorRefs(normalized).map((actorRef) => `credentials:${actorRef}`)
      : [];
    return result({
      status: assertionGap || configurationGap ? REQUIRES_FRAMEWORK_CAPABILITY : INSUFFICIENT_EVIDENCE,
      automatable: false,
      reasonCode: compiled.reasonCode || "AUTOMATION_CONTRACT_INCOMPLETE",
      reason: assertionGap
        ? "The expected behavior is valid, but the deterministic assertion registry does not yet contain a matching assertion capability."
        : compiled.reason || "The test case could not be compiled into the supported automation contract.",
      reasons: compiled.errors || [],
      resolutionType: userInput ? RESOLUTION_USER_INPUT_REQUIRED : assertionGap || configurationGap ? RESOLUTION_FRAMEWORK_CHANGE_REQUIRED : RESOLUTION_AI_REPAIRABLE,
      requiredInputs: compiled.reasonCode === "MISSING_CREDENTIALS" ? ["username", "password"] : actorInputs,
      evidence: [...normalizationNotes, ...(compiled.supportedAssertions || compiled.supportedOperations || [])],
      assertionSuggestions: compiled.assertionSuggestions || [],
      uncompiledExpectations: compiled.uncompiledExpectations || [],
      expectationCoverage: compiled.expectationCoverage || null,
    });
  }

  const suggestions = compiled.plan.assertionSuggestions || [];
  const narratives = compiled.plan.narrativeExpectations || [];
  const coverage = compiled.expectationCoverage || compiled.plan.expectationCoverage || null;
  const coveragePercent = coverage?.total > 0 ? Number(coverage.percent || 0) : 0;
  if (coverage?.total > 0 && coveragePercent < MIN_EXPECTATION_COVERAGE_PERCENT) {
    return result({
      status: INSUFFICIENT_EVIDENCE,
      automatable: false,
      reasonCode: "EXPECTED_RESULT_COVERAGE_INCOMPLETE",
      reason: `${coverage.compiled} of ${coverage.total} human expected result(s) compiled into deterministic assertions (${coveragePercent}%). Automation Ready requires at least ${MIN_EXPECTATION_COVERAGE_PERCENT}% expected-result grounding so unrelated structural assertions cannot make an unverified test executable.`,
      reasons: (coverage.details || []).filter((item) => !item.compiled).map((item) => `Unresolved expected result: ${item.expectation}`),
      resolutionType: RESOLUTION_AI_REPAIRABLE,
      evidence: [
        ...normalizationNotes,
        `${compiled.plan.actions.length} deterministic action(s) compiled`,
        `${compiled.plan.assertions.length} deterministic assertion(s) compiled`,
        `${coverage.compiled}/${coverage.total} expected result(s) compiled`,
      ],
      automationPlan: compiled.plan,
      assertionSuggestions: suggestions,
      uncompiledExpectations: narratives,
      expectationCoverage: coverage,
    });
  }

  const advanced = Array.isArray(compiled.plan.advancedCapabilities) ? compiled.plan.advancedCapabilities : [];
  return result({
    status: READY,
    automatable: true,
    reasonCode: suggestions.length
      ? "SUPPORTED_WITH_ASSERTION_SUGGESTIONS"
      : advanced.length
        ? "SUPPORTED_ADVANCED_CAPABILITIES"
        : "SUPPORTED_GROUNDED_AND_COMPILED",
    reason: suggestions.length
      ? "The test has fully grounded deterministic expected results and can run. Optional assertion-capability suggestions remain available for stronger coverage. Execution PASS/FAIL is determined only when the browser runs the test."
      : advanced.length
        ? `The test is grounded and executable with advanced capability support: ${advanced.join(", ")}.`
        : "The test case is grounded and compiled successfully into the deterministic automation contract. Automation Ready means executable; it does not predict PASS/FAIL. The execution outcome is determined only when the browser runs the test.",
    resolutionType: RESOLUTION_NONE,
    automationPlan: compiled.plan,
    assertionSuggestions: suggestions,
    uncompiledExpectations: narratives,
    expectationCoverage: coverage,
    evidence: [
      ...normalizationNotes,
      `${compiled.plan.actions.length} deterministic action(s) compiled`,
      `${compiled.plan.assertions.length} deterministic assertion(s) compiled`,
      coverage ? `${coverage.compiled}/${coverage.total} human expectation(s) compiled (${coverage.percent}%)` : null,
      advanced.length ? `Advanced capabilities: ${advanced.join(", ")}` : null,
      `${discovery.selectors.size} discovered selector(s) available`,
      `${discovery.paths.size} discovered path(s) available`,
      actorContext.actorCatalog.length ? `${actorContext.actorCredentialRefs.length}/${actorContext.actorCatalog.length} configured role actor credential set(s) available` : null,
      hasCredentials ? "Runtime credentials available when required" : "No default runtime credential dependency detected",
    ].filter(Boolean),
  });
}

function assessTestCases(testCases = [], context = {}) {
  return (testCases || []).map((testCase) => ({ ...testCase, automationReadiness: classifyTestCase(testCase, context) }));
}

function readinessSummary(testCases = []) {
  const summary = { total: testCases.length, ready: 0, manual: 0, insufficientEvidence: 0, invalid: 0, userInputRequired: 0, aiRepairable: 0, frameworkChangeRequired: 0, assertionSuggestions: 0, expectationCoverage: { compiled: 0, total: 0 } };
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
    if (readiness.expectationCoverage) {
      summary.expectationCoverage.compiled += Number(readiness.expectationCoverage.compiled || 0);
      summary.expectationCoverage.total += Number(readiness.expectationCoverage.total || 0);
    }
  }
  summary.expectationCoverage.percent = summary.expectationCoverage.total
    ? Math.round((summary.expectationCoverage.compiled / summary.expectationCoverage.total) * 100)
    : 0;
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
  MIN_EXPECTATION_COVERAGE_PERCENT,
  classifyTestCase,
  assessTestCases,
  readinessSummary,
  buildDiscoveryEvidence,
  resolveActorContext,
};

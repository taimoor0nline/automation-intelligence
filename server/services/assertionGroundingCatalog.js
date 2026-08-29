const { assertionCatalog } = require('./assertionRegistry');

const ACTIVE_GROUNDING_SAFEGUARDS = Object.freeze([
  { code: 'DISCOVERED_SELECTOR_REQUIRED', status: 'ACTIVE', title: 'Selectors must be discovered', description: 'CSS/test-id/id/name selectors used by steps and expectations must exist in page discovery before a test can be Automation Ready.' },
  { code: 'DISCOVERED_PATH_REQUIRED', status: 'ACTIVE', title: 'Navigation paths must be discovered', description: 'Relative navigation paths must be evidenced by discovery instead of being invented by AI or a stale test case.' },
  { code: 'TEXT_IDENTITY_SEPARATION', status: 'ACTIVE', title: 'Selector/id/class is not visible text', description: 'Element identity such as success-panel or #successPanel cannot become a text assertion unless discovery independently proves that literal is rendered content.' },
  { code: 'STRUCTURAL_INTENT_REQUIRED', status: 'ACTIVE', title: 'Structural state requires explicit intent', description: 'Visible/hidden/exists/checked/enabled/required/valid and related structural assertions are retained only when the human expectation actually expresses that state.' },
  { code: 'CAPABILITY_MATCH_REQUIRED', status: 'ACTIVE', title: 'Element capability must match expectation', description: 'Text, value, selected option, placeholder, validation and other expectations are grounded only to discovered elements that support the required capability.' },
  { code: 'UNIQUE_SEMANTIC_MATCH_REQUIRED', status: 'ACTIVE', title: 'Ambiguous semantic matches are rejected', description: 'Narrative expectations resolve to a discovered element only when there is a unique best semantic match; tied candidates remain unresolved for review.' },
  { code: 'ADJACENT_VALIDATION_ERROR_GROUNDING', status: 'ACTIVE', title: 'Validation errors use discovered error elements', description: 'Error/validation expectations can resolve to the error element discovered next to the relevant form control rather than inventing an error selector.' },
  { code: 'TEST_ID_NORMALIZATION', status: 'ACTIVE', title: 'Human test-id phrases are normalized', description: 'Narrative references such as test id "email-error" are normalized to an exact data-testid selector before deterministic compilation.' },
  { code: 'VALUE_GROUNDING', status: 'ACTIVE', title: 'Entered and selected values are grounded', description: 'Expected form values and selected values are tied to compatible discovered controls before value assertions are emitted.' },
  { code: 'NETWORK_ENDPOINT_GROUNDING', status: 'ACTIVE', title: 'Observed network assertions require discovered endpoints', description: 'Request/response assertions are rejected when the endpoint was not evidenced by discovery network hints.' },
  { code: 'EXPECTATION_COVERAGE_TRACKING', status: 'ACTIVE', title: 'Uncompiled expectations remain visible', description: 'Readiness tracks how many human expected results compile into deterministic assertions; unresolved narrative expectations are not silently discarded.' },
  { code: 'RUNTIME_LOGIN_NORMALIZATION', status: 'ACTIVE', title: 'Valid login uses grounded runtime controls', description: 'Cross-page valid-login flows can be normalized to the runtime credential helper only after username, password and submit controls are discovered.' },
  { code: 'PASSIVE_WAIT_NORMALIZATION', status: 'ACTIVE', title: 'Passive waits become state verification', description: 'Wait-for-selector steps are normalized into deterministic verification rather than arbitrary sleep timing.' },
  { code: 'ADVANCED_ADAPTER_READINESS', status: 'ACTIVE', title: 'Adapter-backed scenarios are readiness gated', description: 'External-message, database, cross-origin, multi-tab and native/security adapter scenarios cannot become Automation Ready unless their required runtime configuration is available.' },
]);

const ADVANCED_CAPABILITY_AVAILABILITY = Object.freeze([
  { capability: 'VISUAL_REGRESSION', status: 'AVAILABLE', scenario: 'Screenshot/pixel visual regression', implementation: 'ASSERT_VISUAL_MATCH', note: 'PNG baseline comparison uses pixelmatch/pngjs. Missing baselines fail unless explicit baseline-update mode is enabled.' },
  { capability: 'WEB_VITALS', status: 'AVAILABLE', scenario: 'LCP / CLS / INP thresholds', implementation: 'ASSERT_WEB_VITAL_AT_MOST', note: 'PerformanceObserver instrumentation is installed before navigation and measured values are asserted deterministically.' },
  { capability: 'EMAIL_SMS_OTP', status: 'CONFIG_REQUIRED', scenario: 'Email / SMS / OTP receipt', implementation: 'ASSERT_EXTERNAL_MESSAGE_RECEIVED', note: 'Uses the external capability adapter so provider credentials remain outside generated tests.' },
  { capability: 'DATABASE_ASSERTIONS', status: 'CONFIG_REQUIRED', scenario: 'Database record/state assertions', implementation: 'ASSERT_DATABASE_VALUE_EQUALS / ASSERT_DATABASE_ROW_COUNT_EQUALS', note: 'Uses named allow-listed read-only SELECT/WITH queries. Arbitrary model-generated SQL is rejected.' },
  { capability: 'CROSS_ORIGIN_IFRAME', status: 'CONFIG_REQUIRED', scenario: 'Cross-origin iframe assertions/workflows', implementation: 'ASSERT_EXTERNAL_ADAPTER', note: 'Real cross-origin frame control is delegated to the configured external browser adapter; readiness blocks when it is absent.' },
  { capability: 'REAL_MULTI_TAB', status: 'CONFIG_REQUIRED', scenario: 'Full second-tab/window workflow', implementation: 'ASSERT_EXTERNAL_ADAPTER', note: 'Real multi-context browser execution is delegated to the configured external browser adapter rather than simulated as same-tab navigation.' },
  { capability: 'FILE_UPLOAD', status: 'AVAILABLE', scenario: 'File upload through input[type=file]', implementation: 'SELECT_FILE', note: 'Uses safe named fixtures from AUTOMATION_UPLOAD_FIXTURE_DIR; paths outside that directory are rejected.' },
  { capability: 'DRAG_AND_DROP', status: 'AVAILABLE', scenario: 'Drag and drop interactions', implementation: 'DRAG_DROP', note: 'Uses grounded source and destination selectors with browser DataTransfer events.' },
  { capability: 'WEBSOCKET_SSE', status: 'AVAILABLE', scenario: 'Application WebSocket/SSE messages', implementation: 'ASSERT_STREAM_MESSAGE_CONTAINS', note: 'WebSocket and EventSource are instrumented before application navigation and observed messages remain browser-local.' },
  { capability: 'BROWSER_PERMISSION', status: 'AVAILABLE', scenario: 'Geolocation/camera/microphone/notification permission behavior', implementation: 'SET_PERMISSION_STATE / ASSERT_BROWSER_PERMISSION_EQUALS', note: 'Supports deterministic permission-state simulation. Fake media browser launch flags can be enabled separately for camera/microphone test media.' },
  { capability: 'CLIPBOARD', status: 'AVAILABLE', scenario: 'Copy-to-clipboard and clipboard content', implementation: 'ASSERT_CLIPBOARD_EQUALS / ASSERT_CLIPBOARD_CONTAINS', note: 'Clipboard writes are instrumented in the tested browser window without reading the user operating-system clipboard.' },
  { capability: 'BINARY_DOCUMENT_CONTENT', status: 'AVAILABLE', scenario: 'PDF/Office/download semantic content', implementation: 'ASSERT_DOWNLOADED_DOCUMENT_CONTAINS', note: 'Supports PDF, DOCX, XLS/XLSX, PPTX and common text formats from the controlled downloads directory.' },
  { capability: 'CAPTCHA_BIOMETRIC', status: 'CONFIG_REQUIRED', scenario: 'CAPTCHA / biometric challenge in controlled test environments', implementation: 'EXTERNAL_ADAPTER_ACTION / ASSERT_EXTERNAL_ADAPTER', note: 'Only a vendor-supported non-production bypass or dedicated test adapter is allowed; TestNexus does not defeat real production security challenges.' },
  { capability: 'NATIVE_MOBILE', status: 'CONFIG_REQUIRED', scenario: 'Native mobile workflow', implementation: 'EXTERNAL_ADAPTER_ACTION / ASSERT_EXTERNAL_ADAPTER', note: 'Uses the configured external native-mobile automation adapter.' },
  { capability: 'BROWSER_EXTENSION', status: 'CONFIG_REQUIRED', scenario: 'Browser extension UI/workflow', implementation: 'EXTERNAL_ADAPTER_ACTION / ASSERT_EXTERNAL_ADAPTER', note: 'Uses the configured extension-capable external adapter.' },
  { capability: 'OS_DIALOG', status: 'CONFIG_REQUIRED', scenario: 'Native OS dialog/file picker workflow', implementation: 'EXTERNAL_ADAPTER_ACTION / ASSERT_EXTERNAL_ADAPTER', note: 'Uses the configured desktop/OS automation adapter. Standard web file inputs use direct SELECT_FILE instead.' },
]);

function supportedFamilies() {
  const grouped = new Map();
  for (const item of assertionCatalog()) {
    const category = String(item.category || 'other');
    if (!grouped.has(category)) grouped.set(category, []);
    grouped.get(category).push(item);
  }
  return [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, assertions]) => ({ category, count: assertions.length, assertions }));
}

function executedCaseIds(summary = {}) {
  return new Set((summary.tests || []).map((test) => String(test?.testCaseId || String(test?.title || '').match(/TC(?:\d{3}|-H\d{3})/i)?.[0] || '').toUpperCase()).filter(Boolean));
}

function runGroundingSummary(testCases = [], summary = {}) {
  const ids = executedCaseIds(summary);
  const cases = (testCases || []).filter((tc) => !ids.size || ids.has(String(tc?.id || '').toUpperCase()));
  let expectationTotal = 0;
  let expectationCompiled = 0;
  let assertionCount = 0;
  let completeCases = 0;
  let partialCases = 0;
  let unresolvedCases = 0;
  const operationCounts = new Map();

  const details = cases.map((tc) => {
    const readiness = tc?.automationReadiness || {};
    const coverage = readiness.expectationCoverage || readiness.automationPlan?.expectationCoverage || null;
    const assertions = readiness.automationPlan?.assertions || [];
    if (coverage) {
      expectationTotal += Number(coverage.total || 0);
      expectationCompiled += Number(coverage.compiled || 0);
      if (coverage.quality === 'COMPLETE') completeCases += 1;
      else if (coverage.quality === 'PARTIAL') partialCases += 1;
      else unresolvedCases += 1;
    }
    assertionCount += assertions.length;
    for (const assertion of assertions) operationCounts.set(assertion.operation, (operationCounts.get(assertion.operation) || 0) + 1);
    return {
      id: tc.id,
      readinessStatus: readiness.status || 'UNKNOWN',
      reasonCode: readiness.reasonCode || null,
      coverage,
      assertionOperations: assertions.map((item) => item.operation),
      unresolvedExpectations: readiness.uncompiledExpectations || readiness.automationPlan?.narrativeExpectations || [],
      assertionSuggestions: readiness.assertionSuggestions || readiness.automationPlan?.assertionSuggestions || [],
      advancedCapabilities: readiness.automationPlan?.advancedCapabilities || [],
    };
  });

  return {
    caseCount: cases.length,
    assertionCount,
    expectationCoverage: {
      compiled: expectationCompiled,
      total: expectationTotal,
      percent: expectationTotal ? Math.round((expectationCompiled / expectationTotal) * 100) : 0,
    },
    completeCases,
    partialCases,
    unresolvedCases,
    usedOperations: [...operationCounts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([operation, count]) => ({ operation, count })),
    details,
  };
}

module.exports = {
  ACTIVE_GROUNDING_SAFEGUARDS,
  ADVANCED_CAPABILITY_AVAILABILITY,
  FUTURE_GROUNDING_GAPS: ADVANCED_CAPABILITY_AVAILABILITY,
  supportedFamilies,
  runGroundingSummary,
};

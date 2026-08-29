const { assertionCatalog } = require('./assertionRegistry');

const ACTIVE_GROUNDING_SAFEGUARDS = Object.freeze([
  {
    code: 'DISCOVERED_SELECTOR_REQUIRED',
    status: 'ACTIVE',
    title: 'Selectors must be discovered',
    description: 'CSS/test-id/id/name selectors used by steps and expectations must exist in page discovery before a test can be Automation Ready.',
  },
  {
    code: 'DISCOVERED_PATH_REQUIRED',
    status: 'ACTIVE',
    title: 'Navigation paths must be discovered',
    description: 'Relative navigation paths must be evidenced by discovery instead of being invented by AI or a stale test case.',
  },
  {
    code: 'TEXT_IDENTITY_SEPARATION',
    status: 'ACTIVE',
    title: 'Selector/id/class is not visible text',
    description: 'Element identity such as success-panel or #successPanel cannot become a text assertion unless discovery independently proves that literal is rendered content.',
  },
  {
    code: 'STRUCTURAL_INTENT_REQUIRED',
    status: 'ACTIVE',
    title: 'Structural state requires explicit intent',
    description: 'Visible/hidden/exists/checked/enabled/required/valid and related structural assertions are retained only when the human expectation actually expresses that state.',
  },
  {
    code: 'CAPABILITY_MATCH_REQUIRED',
    status: 'ACTIVE',
    title: 'Element capability must match expectation',
    description: 'Text, value, selected option, placeholder, validation and other expectations are grounded only to discovered elements that support the required capability.',
  },
  {
    code: 'UNIQUE_SEMANTIC_MATCH_REQUIRED',
    status: 'ACTIVE',
    title: 'Ambiguous semantic matches are rejected',
    description: 'Narrative expectations resolve to a discovered element only when there is a unique best semantic match; tied candidates remain unresolved for review.',
  },
  {
    code: 'ADJACENT_VALIDATION_ERROR_GROUNDING',
    status: 'ACTIVE',
    title: 'Validation errors use discovered error elements',
    description: 'Error/validation expectations can resolve to the error element discovered next to the relevant form control rather than inventing an error selector.',
  },
  {
    code: 'TEST_ID_NORMALIZATION',
    status: 'ACTIVE',
    title: 'Human test-id phrases are normalized',
    description: 'Narrative references such as test id "email-error" are normalized to an exact data-testid selector before deterministic compilation.',
  },
  {
    code: 'VALUE_GROUNDING',
    status: 'ACTIVE',
    title: 'Entered and selected values are grounded',
    description: 'Expected form values and selected values are tied to compatible discovered controls before value assertions are emitted.',
  },
  {
    code: 'NETWORK_ENDPOINT_GROUNDING',
    status: 'ACTIVE',
    title: 'Observed network assertions require discovered endpoints',
    description: 'Request/response assertions are rejected when the endpoint was not evidenced by discovery network hints.',
  },
  {
    code: 'EXPECTATION_COVERAGE_TRACKING',
    status: 'ACTIVE',
    title: 'Uncompiled expectations remain visible',
    description: 'Readiness tracks how many human expected results compile into deterministic assertions; unresolved narrative expectations are not silently discarded.',
  },
  {
    code: 'RUNTIME_LOGIN_NORMALIZATION',
    status: 'ACTIVE',
    title: 'Valid login uses grounded runtime controls',
    description: 'Cross-page valid-login flows can be normalized to the runtime credential helper only after username, password and submit controls are discovered.',
  },
  {
    code: 'PASSIVE_WAIT_NORMALIZATION',
    status: 'ACTIVE',
    title: 'Passive waits become state verification',
    description: 'Wait-for-selector steps are normalized into deterministic verification rather than arbitrary sleep timing.',
  },
]);

const FUTURE_GROUNDING_GAPS = Object.freeze([
  {
    capability: 'VISUAL_REGRESSION',
    status: 'ROADMAP',
    scenario: 'Pixel/screenshot baseline comparison',
    proposed: 'ASSERT_VISUAL_MATCH',
    note: 'Requires reviewed baseline storage and a visual-diff adapter.',
  },
  {
    capability: 'WEB_VITALS',
    status: 'ROADMAP',
    scenario: 'LCP, CLS, INP and other Web Vitals',
    proposed: 'ASSERT_WEB_VITAL_AT_MOST',
    note: 'Requires metric instrumentation before navigation and reviewed thresholds.',
  },
  {
    capability: 'EXTERNAL_MESSAGES',
    status: 'ROADMAP',
    scenario: 'Email/SMS/OTP delivery verification',
    proposed: 'ASSERT_EMAIL_RECEIVED / ASSERT_SMS_RECEIVED',
    note: 'Requires a controlled mailbox/SMS adapter and secret-safe provider integration.',
  },
  {
    capability: 'DATABASE_ASSERTIONS',
    status: 'ROADMAP',
    scenario: 'Read-only database state verification',
    proposed: 'ASSERT_DATABASE_RECORD',
    note: 'Should use allow-listed server-side read-only queries; model output must never generate arbitrary SQL.',
  },
  {
    capability: 'CROSS_ORIGIN_IFRAME',
    status: 'ROADMAP',
    scenario: 'Assertions inside cross-origin iframes',
    proposed: 'ASSERT_IFRAME_*',
    note: 'Needs an explicit origin/iframe execution contract and safe selector grounding inside the frame.',
  },
  {
    capability: 'REAL_MULTI_TAB',
    status: 'PARTIAL',
    scenario: 'Validate content/workflow in a newly opened tab/window',
    proposed: 'TAB/WINDOW CONTEXT ASSERTIONS',
    note: 'Current runtime can assert window.open calls and URLs, but does not execute a full second-tab workflow.',
  },
  {
    capability: 'FILE_UPLOAD',
    status: 'ROADMAP',
    scenario: 'Grounded upload through input[type=file]',
    proposed: 'SELECT_FILE / ASSERT_UPLOAD_STATE',
    note: 'Native OS file pickers remain unsupported; a safe browser-file fixture contract can be added separately.',
  },
  {
    capability: 'DRAG_AND_DROP',
    status: 'ROADMAP',
    scenario: 'Drag/drop interactions and resulting state',
    proposed: 'DRAG_DROP / ASSERT_DROP_STATE',
    note: 'Needs deterministic source/target discovery and event semantics.',
  },
  {
    capability: 'WEBSOCKET_SSE',
    status: 'ROADMAP',
    scenario: 'Application WebSocket/SSE message assertions',
    proposed: 'ASSERT_STREAM_MESSAGE',
    note: 'Current SSE is used internally by TestNexus; application stream observation is not yet in the deterministic DSL.',
  },
  {
    capability: 'BROWSER_PERMISSION',
    status: 'ROADMAP',
    scenario: 'Geolocation/camera/microphone/notification permission behavior',
    proposed: 'PERMISSION STATE ASSERTIONS',
    note: 'System/browser permission prompts need a controlled browser-context adapter.',
  },
  {
    capability: 'CLIPBOARD',
    status: 'ROADMAP',
    scenario: 'Copy-to-clipboard and clipboard content',
    proposed: 'ASSERT_CLIPBOARD_EQUALS',
    note: 'Needs permission-safe clipboard instrumentation.',
  },
  {
    capability: 'BINARY_DOCUMENT_CONTENT',
    status: 'ROADMAP',
    scenario: 'Semantic assertions inside PDF/Office/binary downloads',
    proposed: 'ASSERT_DOCUMENT_CONTENT',
    note: 'Current file assertions cover existence, text content and minimum size; binary parsing requires dedicated adapters.',
  },
  {
    capability: 'CAPTCHA_BIOMETRIC',
    status: 'MANUAL',
    scenario: 'CAPTCHA, biometric and similar real security challenges',
    proposed: 'None',
    note: 'Intentionally kept manual unless a vendor-supported non-production bypass is explicitly configured.',
  },
  {
    capability: 'NATIVE_NON_WEB',
    status: 'FRAMEWORK_REQUIRED',
    scenario: 'Native mobile, browser extensions and native OS dialogs',
    proposed: 'Separate automation adapter',
    note: 'Outside the current Cypress web deterministic contract.',
  },
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
  FUTURE_GROUNDING_GAPS,
  supportedFamilies,
  runGroundingSummary,
};

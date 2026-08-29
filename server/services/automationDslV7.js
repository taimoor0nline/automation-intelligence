const v6 = require('./automationDslV6');
const { ASSERTION_OPERATIONS } = require('./assertionRegistry');

const TEXT_ASSERTIONS = new Set([
  'ASSERT_TEXT_EQUALS',
  'ASSERT_TEXT_CONTAINS',
  'ASSERT_TEXT_NOT_CONTAINS',
]);

function identityToken(value) {
  return String(value || '').replace(/[^A-Za-z0-9]+/g, '').toLowerCase();
}

function identityCandidates(selector, element = {}) {
  return [
    selector,
    element.selector,
    element.testId,
    element.id,
    element.name,
    element.className,
    element.class,
  ].filter(Boolean);
}

function visibleTextCandidates(element = {}) {
  return [element.text, element.label, element.ariaLabel, element.title]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function isIdentityOnlyExpectedText(expected, selector, element) {
  const expectedText = String(expected || '').trim();
  const expectedToken = identityToken(expectedText);
  if (!expectedToken) return false;

  const identityMatch = identityCandidates(selector, element)
    .some((candidate) => identityToken(candidate) === expectedToken);
  if (!identityMatch) return false;

  // If discovery explicitly proves that the same literal is rendered text, keep it.
  return !visibleTextCandidates(element)
    .some((candidate) => candidate === expectedText);
}

function textIdentityConflicts(compiled, context = {}) {
  if (!compiled?.ok || !compiled.plan?.assertions?.length) return [];
  const discovery = v6.buildDiscoveryIndex(context.pageDiscoveries || []);
  const conflicts = [];

  for (const assertion of compiled.plan.assertions) {
    if (!TEXT_ASSERTIONS.has(assertion.operation)) continue;
    const selector = String(assertion.selector || '').trim();
    const expected = String(assertion.text || '').trim();
    if (!selector || !expected) continue;
    const element = discovery.selectors.get(selector) || {};
    if (!isIdentityOnlyExpectedText(expected, selector, element)) continue;

    conflicts.push({
      selector,
      expected,
      operation: assertion.operation,
      discoveredText: visibleTextCandidates(element),
      identities: identityCandidates(selector, element),
    });
  }
  return conflicts;
}

function compileTestCase(testCase, context = {}) {
  const compiled = v6.compileTestCase(testCase, context);
  const conflicts = textIdentityConflicts(compiled, context);
  if (!conflicts.length) return compiled;

  const first = conflicts[0];
  const discoveredText = first.discoveredText[0] || '';
  const proposed = discoveredText
    ? `Use discovered visible text ${JSON.stringify(discoveredText)} for ${first.selector}, or assert the intended structural state instead.`
    : `Do not use ${JSON.stringify(first.expected)} as visible text for ${first.selector}; it matches the element identity. Assert visibility/existence or provide independently evidenced business text.`;

  return {
    ok: false,
    reasonCode: 'ASSERTION_TEXT_IDENTITY_CONFLICT',
    reason: `Expected text ${JSON.stringify(first.expected)} matches the selector/id/class identity of ${first.selector} rather than independently evidenced visible content.`,
    errors: conflicts.map((item) => `Identity-as-text conflict: ${item.selector} -> ${JSON.stringify(item.expected)} (${item.operation})`),
    supportedOperations: compiled.supportedOperations || [...(v6.SUPPORTED_OPERATIONS || [])],
    supportedAssertions: compiled.supportedAssertions || [...ASSERTION_OPERATIONS],
    assertionSuggestions: conflicts.map((item) => ({
      expectation: `${item.selector} should be validated without treating ${JSON.stringify(item.expected)} as display text.`,
      source: 'deterministic-grounding-guard',
      capability: 'TEXT_IDENTITY_SEPARATION',
      proposedOperations: item.discoveredText.length ? ['ASSERT_TEXT_CONTAINS'] : ['ASSERT_VISIBLE', 'ASSERT_EXISTS'],
      cypressStrategy: item.discoveredText.length
        ? `Use discovered rendered text ${JSON.stringify(item.discoveredText[0])} instead of the selector/id/class identity.`
        : proposed,
    })),
    uncompiledExpectations: compiled.plan?.narrativeExpectations || [],
    expectationCoverage: compiled.expectationCoverage || compiled.plan?.expectationCoverage || null,
    groundingConflicts: conflicts,
  };
}

module.exports = {
  ...v6,
  compileTestCase,
  textIdentityConflicts,
  isIdentityOnlyExpectedText,
};

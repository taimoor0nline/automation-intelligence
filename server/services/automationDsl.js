const legacy = require('./automationDslV13');
const { buildCanonicalElementRegistry } = require('./canonicalElementRegistry');
const { validateCanonicalIr } = require('./canonicalTestIr');

function compileTestCase(testCase, context = {}) {
  if (testCase?.canonicalIr) {
    const registry = buildCanonicalElementRegistry(context.pageDiscoveries || []);
    const canonical = validateCanonicalIr(testCase.canonicalIr, {
      registry,
      story: '',
      hasCredentials: Boolean(context.hasCredentials),
    });
    if (!canonical.ok) {
      return {
        ok: false,
        reasonCode: canonical.reasonCode || 'CANONICAL_IR_INVALID',
        reason: canonical.reason || 'Canonical Test IR failed deterministic validation.',
        errors: canonical.errors || [],
        supportedOperations: [...(legacy.SUPPORTED_OPERATIONS || [])],
        supportedAssertions: [...(legacy.ASSERTION_OPERATIONS || [])],
        assertionSuggestions: [],
        uncompiledExpectations: [],
        expectationCoverage: null,
      };
    }
    return {
      ok: true,
      plan: canonical.plan,
      expectationCoverage: canonical.expectationCoverage,
      supportedOperations: [...(legacy.SUPPORTED_OPERATIONS || [])],
      supportedAssertions: [...(legacy.ASSERTION_OPERATIONS || [])],
      canonical: true,
    };
  }
  return legacy.compileTestCase(testCase, context);
}

module.exports = {
  ...legacy,
  compileTestCase,
};

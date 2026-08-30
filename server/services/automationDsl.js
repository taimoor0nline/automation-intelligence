const legacy = require('./automationDslV13');
const { buildCanonicalElementRegistry } = require('./canonicalElementRegistry');
const { validateCanonicalIr } = require('./canonicalTestIrV3');
const requestContext = require('./requestContext');
const { getSession } = require('../data/sessionStore');

function actorContext(context = {}) {
  if ((context.actorCatalog || []).length || (context.actorCredentialRefs || []).length) {
    return { actorCatalog: context.actorCatalog || [], actorCredentialRefs: context.actorCredentialRefs || [] };
  }
  const sessionId = requestContext.current().sessionId;
  if (!sessionId) return { actorCatalog: [], actorCredentialRefs: [] };
  const session = getSession(sessionId);
  const actorCredentialRefs = Object.entries(session.actorCredentials || {})
    .filter(([, credentials]) => credentials?.username && credentials?.password)
    .map(([actorRef]) => actorRef);
  return { actorCatalog: session.testActors || [], actorCredentialRefs };
}

function compileTestCase(testCase, context = {}) {
  if (testCase?.canonicalIr) {
    const registry = buildCanonicalElementRegistry(context.pageDiscoveries || []);
    const actors = actorContext(context);
    const canonical = validateCanonicalIr(testCase.canonicalIr, {
      registry,
      story: '',
      hasCredentials: Boolean(context.hasCredentials),
      actorCatalog: actors.actorCatalog,
      actorCredentialRefs: actors.actorCredentialRefs,
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

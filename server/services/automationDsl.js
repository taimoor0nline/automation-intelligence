const legacy = require('./automationDslV13');
const { buildCanonicalElementRegistry } = require('./canonicalElementRegistry');
const { validateCanonicalIr } = require('./canonicalTestIrV3');
const { normalizeBehavioralIr } = require('./canonicalBehaviorGrounding');
const { resolveRuntimeWorkflowContext } = require('./workflowRuntimeContext');

function canonicalFailure(reasonCode, reason, errors = []) {
  return {
    ok: false,
    reasonCode,
    reason,
    errors,
    supportedOperations: [...(legacy.SUPPORTED_OPERATIONS || [])],
    supportedAssertions: [...(legacy.ASSERTION_OPERATIONS || [])],
    assertionSuggestions: [],
    uncompiledExpectations: [],
    expectationCoverage: null,
  };
}

function compileTestCase(testCase, context = {}) {
  if (testCase?.canonicalIr) {
    const registry = buildCanonicalElementRegistry(context.pageDiscoveries || []);
    const runtime = resolveRuntimeWorkflowContext({
      actorCatalog: context.actorCatalog || [],
      actorCredentialRefs: context.actorCredentialRefs || [],
      workflowRequirements: context.workflowRequirements || testCase.workflowRequirements || null,
    });

    // Readiness is an independent behavioral safety gate. This catches canonical
    // cases created before behavioral grounding existed, as well as imported/edited
    // cases that omit deterministic form prerequisites or assume an unproven custom
    // validation trigger. The enriched plan, not free-form prose, is what Cypress
    // will execute when the case becomes READY.
    const plannedUnit = {
      plannedId: testCase.canonicalIr.plannedId || null,
      category: testCase.testCategory || testCase.category || null,
      scenarioType: testCase.type || null,
      objective: testCase.coverageRationale || testCase.canonicalIr.objective || testCase.title || '',
    };
    const behavioral = normalizeBehavioralIr(testCase.canonicalIr, {
      registry,
      plannedUnit,
      story: context.story || '',
    });
    if (behavioral.unresolved.length) {
      return canonicalFailure(
        'CANONICAL_BEHAVIOR_UNGROUNDED',
        behavioral.unresolved[0],
        behavioral.unresolved
      );
    }

    const canonical = validateCanonicalIr(behavioral.ir, {
      registry,
      plannedUnit,
      story: context.story || '',
      hasCredentials: Boolean(context.hasCredentials),
      actorCatalog: runtime.actorCatalog,
      actorCredentialRefs: runtime.actorCredentialRefs,
    });
    if (!canonical.ok) {
      return canonicalFailure(
        canonical.reasonCode || 'CANONICAL_IR_INVALID',
        canonical.reason || 'Canonical Test IR failed deterministic validation.',
        canonical.errors || []
      );
    }
    return {
      ok: true,
      plan: {
        ...canonical.plan,
        behavioralGrounding: behavioral.ir.behavioralGrounding,
      },
      expectationCoverage: canonical.expectationCoverage,
      supportedOperations: [...(legacy.SUPPORTED_OPERATIONS || [])],
      supportedAssertions: [...(legacy.ASSERTION_OPERATIONS || [])],
      canonical: true,
      behavioralGrounding: behavioral.ir.behavioralGrounding,
    };
  }
  return legacy.compileTestCase(testCase, context);
}

module.exports = {
  ...legacy,
  compileTestCase,
};

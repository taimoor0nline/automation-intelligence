const legacy = require('./automationDslV13');
const { buildCanonicalElementRegistry } = require('./canonicalElementRegistry');
const { validateCanonicalIr } = require('./canonicalTestIrV3');
const { normalizeBehavioralIr } = require('./canonicalBehaviorGrounding');
const { applyEffectiveRulesToIr } = require('./behaviorRuleRegistry');
const { resolveRuntimeWorkflowContext } = require('./workflowRuntimeContext');

function canonicalFailure(reasonCode, reason, errors = []) {
  return { ok:false, reasonCode, reason, errors, supportedOperations:[...(legacy.SUPPORTED_OPERATIONS||[])], supportedAssertions:[...(legacy.ASSERTION_OPERATIONS||[])], assertionSuggestions:[], uncompiledExpectations:[], expectationCoverage:null };
}

function compileTestCase(testCase, context = {}) {
  if (testCase?.canonicalIr) {
    const registry = buildCanonicalElementRegistry(context.pageDiscoveries || []);
    const runtime = resolveRuntimeWorkflowContext({ actorCatalog: context.actorCatalog || [], actorCredentialRefs: context.actorCredentialRefs || [], workflowRequirements: context.workflowRequirements || testCase.workflowRequirements || null });
    const plannedUnit = {
      plannedId: testCase.canonicalIr.plannedId || null,
      category: testCase.testCategory || testCase.category || null,
      scenarioType: testCase.type || null,
      objective: testCase.coverageRationale || testCase.canonicalIr.objective || testCase.title || '',
    };

    // Effective rules are reusable application knowledge. Apply them before
    // behavioral grounding so a shared boundary/length rule version change updates
    // every linked canonical case on the next readiness pass.
    const ruleAdjustedIr = applyEffectiveRulesToIr(testCase.canonicalIr, testCase.effectiveRules || [], testCase);
    const behavioral = normalizeBehavioralIr(ruleAdjustedIr, { registry, plannedUnit, story: context.story || '' });
    if (behavioral.unresolved.length) return canonicalFailure('CANONICAL_BEHAVIOR_UNGROUNDED', behavioral.unresolved[0], behavioral.unresolved);

    const canonical = validateCanonicalIr(behavioral.ir, {
      registry, plannedUnit, story: context.story || '', hasCredentials: Boolean(context.hasCredentials),
      actorCatalog: runtime.actorCatalog, actorCredentialRefs: runtime.actorCredentialRefs,
    });
    if (!canonical.ok) return canonicalFailure(canonical.reasonCode || 'CANONICAL_IR_INVALID', canonical.reason || 'Canonical Test IR failed deterministic validation.', canonical.errors || []);
    return {
      ok:true,
      plan:{ ...canonical.plan, behavioralGrounding:behavioral.ir.behavioralGrounding, appliedRuleRefs:ruleAdjustedIr.ruleApplication?.ruleRefs || [], effectiveRules:testCase.effectiveRules || [] },
      expectationCoverage:canonical.expectationCoverage,
      supportedOperations:[...(legacy.SUPPORTED_OPERATIONS||[])], supportedAssertions:[...(legacy.ASSERTION_OPERATIONS||[])],
      canonical:true, behavioralGrounding:behavioral.ir.behavioralGrounding,
    };
  }
  return legacy.compileTestCase(testCase, context);
}

module.exports = { ...legacy, compileTestCase };

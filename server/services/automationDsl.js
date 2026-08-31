const legacy = require('./automationDslV13');
const { buildCanonicalElementRegistry } = require('./canonicalElementRegistry');
const { validateCanonicalIr } = require('./canonicalTestIrV3');
const { normalizeBehavioralIr } = require('./canonicalBehaviorGrounding');
const { applyEffectiveRulesToIr } = require('./behaviorRuleRegistry');
const { projectRuleTriggers } = require('./behaviorRuleExecutionProjection');
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

    const ruleAdjustedIr = applyEffectiveRulesToIr(testCase.canonicalIr, testCase.effectiveRules || [], testCase);
    const projected = projectRuleTriggers(ruleAdjustedIr, testCase.effectiveRules || []);
    // Feed reviewed trigger evidence into behavioral grounding. This prevents the
    // generic fallback from replacing a user-approved BLUR/INPUT/CHANGE trigger with
    // SUBMIT simply because static discovery cannot prove timing.
    const groundingStory = [context.story || '', projected.timingHints].filter(Boolean).join(' | ');
    const behavioral = normalizeBehavioralIr(projected.ir, { registry, plannedUnit, story: groundingStory });
    if (behavioral.unresolved.length) return canonicalFailure('CANONICAL_BEHAVIOR_UNGROUNDED', behavioral.unresolved[0], behavioral.unresolved);

    const canonical = validateCanonicalIr(behavioral.ir, {
      registry, plannedUnit, story: groundingStory, hasCredentials: Boolean(context.hasCredentials),
      actorCatalog: runtime.actorCatalog, actorCredentialRefs: runtime.actorCredentialRefs,
    });
    if (!canonical.ok) return canonicalFailure(canonical.reasonCode || 'CANONICAL_IR_INVALID', canonical.reason || 'Canonical Test IR failed deterministic validation.', canonical.errors || []);
    return {
      ok:true,
      plan:{ ...canonical.plan, behavioralGrounding:behavioral.ir.behavioralGrounding, appliedRuleRefs:[...new Set([...(ruleAdjustedIr.ruleApplication?.ruleRefs||[]),...(projected.ir.ruleApplication?.triggerRuleRefs||[])])], effectiveRules:testCase.effectiveRules || [] },
      expectationCoverage:canonical.expectationCoverage,
      supportedOperations:[...(legacy.SUPPORTED_OPERATIONS||[])], supportedAssertions:[...(legacy.ASSERTION_OPERATIONS||[])],
      canonical:true, behavioralGrounding:behavioral.ir.behavioralGrounding,
    };
  }
  return legacy.compileTestCase(testCase, context);
}

module.exports = { ...legacy, compileTestCase };

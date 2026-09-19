const express = require('express');
const router = express.Router();

const { getSession } = require('../data/sessionStore');
const { generateCanonicalBatch } = require('../services/canonicalTestGenerationServiceV3');
const { assessTestCases, readinessSummary } = require('../services/testCaseFeasibility');
const { resolveRuntimeWorkflowContext } = require('../services/workflowRuntimeContext');
const { parseAutomationScript } = require('../services/manualAutomationScript');
const { validateCanonicalIr } = require('../services/canonicalTestIrV3');
const { generateCypressPreviewFromPlan } = require('../services/deterministicAutomationGeneratorV6');
const { attachStrictContract } = require('../services/strictCypressIntegration');

function clean(value, max = 2000) {
  return String(value ?? '').trim().slice(0, max);
}

function actorCredentialRefs(session) {
  return Object.entries(session.actorCredentials || {})
    .filter(([, credentials]) => credentials?.username && credentials?.password)
    .map(([actorRef]) => String(actorRef));
}

function assessmentContext(session) {
  return {
    pageDiscoveries: session.pageDiscoveries || [],
    hasCredentials: Boolean(session.credentials?.username && session.credentials?.password),
    actorCatalog: session.testActors || [],
    actorCredentialRefs: actorCredentialRefs(session),
    story: session.story || '',
  };
}

function findCase(session, raw) {
  const id = clean(raw?.id, 20).toUpperCase();
  return (session.testCases || []).find((item) => String(item?.id || '').toUpperCase() === id) || raw || null;
}

function plannedIdFor(testCase) {
  const existing = clean(testCase?.canonicalIr?.plannedId, 40);
  if (existing) return existing;
  const match = clean(testCase?.id, 20).match(/(\d{3})$/);
  return `P${match?.[1] || '999'}`;
}

function scenarioType(testCase) {
  const value = clean(testCase?.type, 30).toLowerCase();
  return ['positive', 'negative', 'boundary'].includes(value) ? value : 'positive';
}

function category(testCase) {
  const value = clean(testCase?.testCategory || testCase?.category, 80).toUpperCase();
  return value && value !== 'CUSTOM' && value !== 'API' ? value : 'FUNCTIONAL';
}

function baseObjective(testCase) {
  return clean(
    testCase?.coverageRationale ||
    testCase?.canonicalIr?.objective ||
    testCase?.title ||
    'Rewrite this test using only currently discovered browser evidence.',
    1200
  );
}

function repairHistory(testCase, action, priorReadiness, resultReadiness, instruction = '') {
  return [
    ...(Array.isArray(testCase?.repairHistory) ? testCase.repairHistory : []),
    {
      attempt: (testCase?.repairHistory || []).length + 1,
      action,
      at: new Date().toISOString(),
      originalStatus: priorReadiness?.status || null,
      reasonCode: priorReadiness?.reasonCode || null,
      reason: priorReadiness?.reason || null,
      instruction: instruction || null,
      explanation: action === 'AI_REGENERATE'
        ? 'Regenerated the case from the same business intent using the current rendered discovery and strict automation contract.'
        : 'Rewrote the case from the human repair instruction using the current rendered discovery and strict automation contract.',
      result: resultReadiness?.status || null,
    },
  ].slice(-20);
}

function clearApprovalSeal(session, id) {
  if (session.approvedContractSeals && typeof session.approvedContractSeals === 'object') {
    delete session.approvedContractSeals[id];
  }
  session.approvedIds = (session.approvedIds || []).filter((item) => String(item).toUpperCase() !== String(id).toUpperCase());
  session.generatedScript = null;
}

function upsert(session, candidate) {
  const id = String(candidate?.id || '').toUpperCase();
  const index = (session.testCases || []).findIndex((item) => String(item?.id || '').toUpperCase() === id);
  if (index >= 0) session.testCases[index] = candidate;
  else session.testCases = [...(session.testCases || []), candidate];
  session.automationReadiness = readinessSummary(session.testCases || []);
  session.readinessValidated = true;
}

function updateCredentials(session, credentials) {
  if (!credentials || typeof credentials !== 'object') return;
  session.credentials = {
    username: String(credentials.username || ''),
    password: String(credentials.password || ''),
  };
}

async function regenerateCanonical(session, original, mode, instruction) {
  const registry = session.canonicalElementRegistry;
  if (!registry?.elements?.length) throw new Error('Canonical rendered discovery is unavailable. Run fresh page discovery before AI regeneration.');

  const originalObjective = baseObjective(original);
  const objective = mode === 'rewrite-ai'
    ? `${originalObjective}\nHuman repair instruction: ${clean(instruction, 1200)}\nPreserve the business intent, but use only currently discovered evidence and supported deterministic browser operations/assertions.`
    : originalObjective;

  const plannedUnit = {
    plannedId: plannedIdFor(original),
    category: category(original),
    scenarioType: scenarioType(original),
    objective,
    rationale: objective,
    customCategory: null,
    customScenarioType: null,
  };

  const workflow = resolveRuntimeWorkflowContext({
    actorCatalog: session.testActors || [],
    actorCredentialRefs: actorCredentialRefs(session),
    workflowRequirements: session.workflowRequirements || null,
  });

  const generated = await generateCanonicalBatch({
    story: session.story || '',
    registry,
    plannedUnits: [plannedUnit],
    environment: 'Test',
    excludeTitles: (session.testCases || []).filter((item) => item?.id !== original?.id).map((item) => item?.title).filter(Boolean),
    modelTier: session.aiModelTier || 'fast',
    hasCredentials: Boolean(session.credentials?.username && session.credentials?.password),
    actorCatalog: workflow.actorCatalog,
    actorCredentialRefs: workflow.actorCredentialRefs,
    workflowRequirements: workflow.workflowRequirements,
    securitySubcategories: original?.securitySubcategory ? [String(original.securitySubcategory)] : [],
    securitySeverities: original?.severity ? [String(original.severity)] : [],
  });

  const raw = generated.testCases?.[0];
  if (!raw) throw new Error('AI regeneration returned no canonical test case.');

  const candidate = {
    ...raw,
    id: original.id,
    source: mode === 'rewrite-ai' ? 'ai-rewritten' : 'ai-regenerated',
    createdBy: 'human-repair-request',
    coverageRationale: objective,
    // Any rewrite is a new contract. Never carry a previous human approval seal.
    canonicalValidation: {
      ...(raw.canonicalValidation || {}),
      approvedCanonicalHash: undefined,
      approvedCompiledHash: undefined,
      approvedDisplayExpectationHash: undefined,
      approvedCypressArtifactHash: undefined,
      approvedAt: undefined,
      approvalContractVersion: undefined,
      approvalMode: undefined,
    },
  };

  const assessed = assessTestCases([candidate], assessmentContext(session))[0];
  assessed.repairHistory = repairHistory(
    original,
    mode === 'rewrite-ai' ? 'AI_REWRITE' : 'AI_REGENERATE',
    original.automationReadiness,
    assessed.automationReadiness,
    instruction
  );
  return assessed;
}

function manualScriptCandidate(session, original, script) {
  const registry = session.canonicalElementRegistry;
  if (!registry?.elements?.length) throw new Error('Rendered discovery is required before editing an Automation Script.');
  const { actions, assertions } = parseAutomationScript(script, registry);
  const plannedId = plannedIdFor(original);
  const objective = baseObjective(original);
  const workflow = resolveRuntimeWorkflowContext({
    actorCatalog: session.testActors || [],
    actorCredentialRefs: actorCredentialRefs(session),
    workflowRequirements: session.workflowRequirements || null,
  });
  const ir = {
    version: 1,
    plannedId,
    objective,
    actions,
    assertions,
    behavioralGrounding: {
      version: 1,
      status: 'GROUNDED',
      enrichments: [],
      unresolved: [],
    },
  };
  const checked = validateCanonicalIr(ir, {
    registry,
    plannedUnit: { plannedId, category: category(original), scenarioType: scenarioType(original), objective, rationale: objective },
    story: session.story || '',
    hasCredentials: Boolean(session.credentials?.username && session.credentials?.password),
    actorCatalog: workflow.actorCatalog,
    actorCredentialRefs: workflow.actorCredentialRefs,
  });
  if (!checked.ok) {
    const error = new Error(checked.reason || (checked.errors || []).join('; ') || 'The manual Automation Script did not pass canonical validation.');
    error.code = 'MANUAL_AUTOMATION_SCRIPT_INVALID';
    error.validationErrors = checked.errors || [];
    throw error;
  }
  const candidate = {
    ...original,
    id: original.id,
    source: 'human-automation-script',
    createdBy: 'human-repair-request',
    steps: checked.display.steps,
    expectedResults: checked.display.expectedResults,
    canonicalIr: ir,
    behavioralGrounding: ir.behavioralGrounding,
    canonicalValidation: {
      status: 'VALID',
      plannedId,
      registryHash: registry.registryHash,
      actorRefs: checked.plan.actorRefs || [],
      behavioralGrounding: ir.behavioralGrounding,
    },
    cypressPreview: generateCypressPreviewFromPlan(checked.plan, { id: original.id, title: original.title }),
    _canonicalAutomationPlan: checked.plan,
    generationStory: session.story || '',
    automationReadiness: null,
  };
  const context = { ...assessmentContext(session), canonicalElementRegistry: registry };
  const assessed = assessTestCases([candidate], context)[0];
  const strict = attachStrictContract(assessed, context);
  if (strict.automationReadiness?.status !== 'READY') {
    const error = new Error(strict.automationReadiness?.reason || 'The manual script is not Automation Ready. Keep editing the original case.');
    error.code = strict.automationReadiness?.reasonCode || 'MANUAL_AUTOMATION_SCRIPT_NOT_READY';
    error.validationErrors = strict.automationReadiness?.reasons || [];
    throw error;
  }
  strict.repairHistory = repairHistory(
    original, 'MANUAL_AUTOMATION_SCRIPT', original.automationReadiness, strict.automationReadiness,
    'Human-authored supported automation commands and assertions.'
  );
  return strict;
}

router.post('/api/test-cases/repair-workbench', async (req, res) => {
  const { sessionId = 'default', testCase: rawTestCase = null, action = '', instruction = '', script = '', credentials = null } = req.body || {};
  const session = getSession(sessionId);

  try {
    if (session.state === 'IDLE' || !session.story) throw new Error('Generate the initial test suite before repairing a test case.');
    updateCredentials(session, credentials);
    const original = findCase(session, rawTestCase);
    if (!original?.id) throw new Error('A valid test case is required for repair.');

    const mode = clean(action, 40).toLowerCase();
    if (!['regenerate', 'rewrite-ai', 'manual-script'].includes(mode)) throw new Error('Repair action must be regenerate, rewrite-ai, or manual-script.');
    if (mode === 'rewrite-ai' && !clean(instruction, 1200)) throw new Error('Describe how the test should be rewritten.');

    const candidate = mode === 'manual-script'
      ? manualScriptCandidate(session, original, script)
      : await regenerateCanonical(session, original, mode, instruction);
    if (res.destroyed || res.writableEnded) return;
    clearApprovalSeal(session, original.id);
    upsert(session, candidate);

    return res.json({
      ok: true,
      action: mode,
      testCase: candidate,
      automationReadiness: candidate.automationReadiness,
      automationReady: String(candidate.automationReadiness?.status || '').toUpperCase() === 'READY',
      requiresHumanReview: true,
      approvalReset: true,
      message: String(candidate.automationReadiness?.status || '').toUpperCase() === 'READY'
        ? `${candidate.id} has a validated new automation contract. Human review is required before execution.`
        : `${candidate.id} remains blocked: ${candidate.automationReadiness?.reason || candidate.automationReadiness?.reasonCode || 'review required'}`,
    });
  } catch (err) {
    return res.status(422).json({
      ok: false,
      reply: err.message,
      code: err.code || 'TEST_CASE_REPAIR_WORKBENCH_FAILED',
      validationErrors: Array.isArray(err.validationErrors) ? err.validationErrors : [],
      plannedId: err.plannedId || null,
      requiresHumanReview: true,
      retryable: ['CANONICAL_IR_VALIDATION_FAILED', 'CANONICAL_BEHAVIOR_UNGROUNDED', 'AI_CANONICAL_REQUEST_TIMEOUT'].includes(err.code),
    });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();

const { getSession } = require('../data/sessionStore');
const { generateCanonicalBatch } = require('../services/canonicalTestGenerationServiceV3');
const { assessTestCases, readinessSummary } = require('../services/testCaseFeasibility');
const { resolveRuntimeWorkflowContext } = require('../services/workflowRuntimeContext');
const { parseCypressScript } = require('../services/cypressManualScript');
const { validateCanonicalIr } = require('../services/canonicalTestIrV3');
const { generateCypressPreviewFromPlan } = require('../services/deterministicAutomationGeneratorV6');
const { attachStrictContract } = require('../services/strictCypressIntegration');
const { stableHash, executionPlanShape, displayExpectationShape } = require('../services/startupIntegrityGuards');
const persistence = require('../services/persistenceService');

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
  return (session.testCases || []).find((item) => String(item?.id || '').toUpperCase() === id) || null;
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
    session.approvedContractSeals = { ...session.approvedContractSeals };
    delete session.approvedContractSeals[id];
  }
  session.approvedIds = (session.approvedIds || []).filter((item) => String(item).toUpperCase() !== String(id).toUpperCase());
  session.generatedScript = null;
}

function upsert(session, candidate) {
  const id = String(candidate?.id || '').toUpperCase();
  const index = (session.testCases || []).findIndex((item) => String(item?.id || '').toUpperCase() === id);
  if (index >= 0) session.testCases = session.testCases.map((item, i) => i === index ? candidate : item);
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
  const { actions, assertions } = parseCypressScript(script, registry);
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
    manualCypressScript: script,
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

function contractReviewHash(testCase) {
  // The human confirms both authored intent and the exact compiled assertions.
  return stableHash({
    ir: testCase.canonicalIr,
    compiled: executionPlanShape(testCase.automationReadiness?.automationPlan || {}),
    display: displayExpectationShape(testCase),
    executableHash: testCase.automationReadiness?.cypressContract?.scriptHash || null,
  });
}

function markPendingReview(original, candidate) {
  return {
    ...candidate,
    review: {
      status: 'PENDING_REVIEW',
      revision: (Number(original?.review?.revision) || 0) + 1,
      contractHash: contractReviewHash(candidate),
      confirmedAt: null,
    },
  };
}

function confirmReview(session, original, revision, expectedHash) {
  const review = original?.review;
  if (review?.status !== 'PENDING_REVIEW') {
    const error = new Error('This case has no pending edited contract to confirm. Save and validate an edit first.');
    error.code = 'REVIEW_NOT_PENDING'; throw error;
  }
  if (Number(revision) !== review.revision || !expectedHash || expectedHash !== review.contractHash) {
    const error = new Error('This case changed after you opened it. Refresh its review and confirm the current version.');
    error.code = 'REVIEW_VERSION_CONFLICT'; throw error;
  }
  const context = { ...assessmentContext(session), canonicalElementRegistry: session.canonicalElementRegistry };
  const assessed = attachStrictContract(assessTestCases([original], context)[0], context);
  const freshHash = contractReviewHash(assessed);
  if (assessed.automationReadiness?.status !== 'READY'
      || freshHash !== review.contractHash) {
    const error = new Error('The current automation contract no longer matches the validated draft. Edit and revalidate before confirmation.');
    error.code = 'REVIEW_CONTRACT_CHANGED'; throw error;
  }
  return {
    ...assessed,
    review: { ...review, status: 'CONFIRMED', confirmedAt: new Date().toISOString(), contractHash: freshHash },
  };
}

router.post('/api/test-cases/repair-workbench', async (req, res) => {
  const { sessionId = 'default', testCase: rawTestCase = null, action = '', instruction = '', script = '', credentials = null, expectedRevision = 0, reviewHash = '' } = req.body || {};
  const session = getSession(sessionId);

  try {
    if (session.state === 'IDLE' || !session.story) throw new Error('Generate the initial test suite before repairing a test case.');
    updateCredentials(session, credentials);
    const original = findCase(session, rawTestCase);
    if (!original?.id) {
      const error = new Error('The test case does not exist in this session. Refresh your cases before editing.');
      error.code = 'TEST_CASE_NOT_IN_SESSION'; throw error;
    }

    const mode = clean(action, 40).toLowerCase();
    if (!['regenerate', 'rewrite-ai', 'manual-script', 'confirm'].includes(mode)) {
      throw new Error('Repair action must be regenerate, rewrite-ai, manual-script, or confirm.');
    }
    if (mode === 'rewrite-ai' && !clean(instruction, 1200)) throw new Error('Describe how the test should be rewritten.');
    if (Number(expectedRevision) !== (Number(original.review?.revision) || 0)) {
      const error = new Error('Another edit changed this case. Refresh it before saving.');
      error.code = 'REVIEW_VERSION_CONFLICT'; throw error;
    }
    if (req.user?.sub && session.createdBy && String(session.createdBy) !== String(req.user.sub)
        && String(req.user.role || '').toUpperCase() !== 'MANAGER') {
      const error = new Error('The current user does not own this test session.');
      error.code = 'SESSION_ACCESS_DENIED'; throw error;
    }
    const candidate = mode === 'confirm'
      ? confirmReview(session, original, expectedRevision, reviewHash)
      : markPendingReview(
        original,
        mode === 'manual-script'
          ? manualScriptCandidate(session, original, script)
          : await regenerateCanonical(session, original, mode, instruction)
      );
    if (res.destroyed || res.writableEnded) return;
    // Prevent delayed AI repairs from overwriting a newer manual edit.
    if (findCase(session, rawTestCase) !== original) {
      const error = new Error('The case changed while AI was preparing the rewrite. Refresh and retry.');
      error.code = 'REVIEW_VERSION_CONFLICT'; throw error;
    }
    const prior = {
      testCases: session.testCases,
      approvedIds: session.approvedIds,
      approvedContractSeals: session.approvedContractSeals,
      generatedScript: session.generatedScript,
      automationReadiness: session.automationReadiness,
      readinessValidated: session.readinessValidated,
    };
    if (mode !== 'confirm') clearApprovalSeal(session, original.id);
    upsert(session, candidate);
    let persisted = false;
    try {
      persisted = await persistence.persistReviewedCase(sessionId, session, candidate);
    } catch (error) {
      if (require('../db').isRequired()) {
        Object.assign(session, prior);
        const persistenceError = new Error('The review was not saved in PostgreSQL; the previous case remains unchanged. ' + error.message);
        persistenceError.code = 'REVIEW_PERSISTENCE_FAILED';
        throw persistenceError;
      }
      console.warn('[repair-workbench] optional PostgreSQL edit persistence failed:', error.message);
    }
    return res.json({
      ok: true,
      action: mode,
      testCase: candidate,
      persisted,
      review: candidate.review,
      automationReadiness: candidate.automationReadiness,
      automationReady: String(candidate.automationReadiness?.status || '').toUpperCase() === 'READY',
      requiresHumanReview: mode !== 'confirm',
      approvalReset: mode !== 'confirm',
      message: mode === 'confirm'
        ? `${candidate.id} review confirmed. You may now explicitly approve its exact executable artifact for execution.`
        : String(candidate.automationReadiness?.status || '').toUpperCase() === 'READY'
          ? `${candidate.id} was validated and saved as a draft. Confirm the reviewed contract before execution.`
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

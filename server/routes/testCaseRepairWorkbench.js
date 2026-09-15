const express = require('express');
const router = express.Router();

const { getSession } = require('../data/sessionStore');
const { generateCanonicalBatch } = require('../services/canonicalTestGenerationServiceV3');
const { assessTestCases, readinessSummary } = require('../services/testCaseFeasibility');
const { resolveRuntimeWorkflowContext } = require('../services/workflowRuntimeContext');

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
        ? 'Regenerated the case from the same business intent using the current rendered discovery and strict Cypress contract.'
        : 'Rewrote the case from the human repair instruction using the current rendered discovery and strict Cypress contract.',
      result: resultReadiness?.status || null,
    },
  ].slice(-20);
}

function clearApprovalSeal(session, id) {
  if (session.approvedContractSeals && typeof session.approvedContractSeals === 'object') {
    delete session.approvedContractSeals[id];
  }
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
    ? `${originalObjective}\nHuman repair instruction: ${clean(instruction, 1200)}\nPreserve the business intent, but use only currently discovered evidence and supported Cypress-compatible browser operations/assertions.`
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

router.post('/api/test-cases/repair-workbench', async (req, res) => {
  const { sessionId = 'default', testCase: rawTestCase = null, action = '', instruction = '', credentials = null } = req.body || {};
  const session = getSession(sessionId);

  try {
    if (session.state === 'IDLE' || !session.story) throw new Error('Generate the initial test suite before repairing a test case.');
    updateCredentials(session, credentials);
    const original = findCase(session, rawTestCase);
    if (!original?.id) throw new Error('A valid test case is required for repair.');

    const mode = clean(action, 40).toLowerCase();
    if (!['regenerate', 'rewrite-ai'].includes(mode)) throw new Error('Repair action must be regenerate or rewrite-ai.');
    if (mode === 'rewrite-ai' && !clean(instruction, 1200)) throw new Error('Describe how the test should be rewritten.');

    const candidate = await regenerateCanonical(session, original, mode, instruction);
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
        ? `${candidate.id} was regenerated and validated. Human review is required before execution.`
        : `${candidate.id} was regenerated, but remains blocked: ${candidate.automationReadiness?.reason || candidate.automationReadiness?.reasonCode || 'review required'}`,
    });
  } catch (err) {
    return res.status(422).json({
      ok: false,
      reply: err.message,
      code: err.code || 'TEST_CASE_REPAIR_WORKBENCH_FAILED',
      requiresHumanReview: true,
    });
  }
});

module.exports = router;

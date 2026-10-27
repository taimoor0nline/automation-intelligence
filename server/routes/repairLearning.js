'use strict';
const express = require('express');
const db = require('../db');
const { getSession } = require('../data/sessionStore');
const persistence = require('../services/persistenceService');
const { persistCaseIr } = require('../services/canonicalArtifactStore');
const learning = require('../services/repairLearning');
const repairMemory = require('../services/repairLearningMemory');
const { executeIsolatedRegression } = require('../services/isolatedRegressionRunner');

const router = express.Router();
const active = new Set();
const caseId = (value) => String(value || '').trim().toUpperCase();
const sessionIdOf = (value) => String(value || 'default').slice(0, 180);
function owned(req, session) {
  if (!req.user?.sub || !session.createdBy || String(req.user.sub) === String(session.createdBy)) return true;
  return String(req.user.role || '').toUpperCase() === 'MANAGER';
}
function problem(res, error) {
  return res.status(error.code === 'REPAIR_CONCURRENT_CHANGE' ? 409 : 422).json({
    ok: false, code: error.code || 'REPAIR_LEARNING_FAILED', reply: error.message,
  });
}
async function eventQuery(client, sessionId, session, attempt, outcome) {
  await client.query(
    `insert into repair_learning_events(
      session_id,project_id,attempt_id,external_case_id,target_origin,failure_signature,
      original_hash,candidate_hash,outcome,evidence_json
    ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
    on conflict(attempt_id) do update set candidate_hash=excluded.candidate_hash,
      outcome=excluded.outcome,evidence_json=excluded.evidence_json,updated_at=now()    `,
    [
      sessionId, session.projectId || null, attempt.attemptId, attempt.caseId, attempt.targetOrigin,
      attempt.failureSignature, attempt.originalHash, attempt.candidateHash, outcome,
      JSON.stringify({
        verifiedAt: attempt.verifiedAt,
        impactedIds: attempt.impactedIds,
        changedDependencies: attempt.changedDependencies || null,
        rollbackMode: attempt.rollbackMode || null,
        rollbackReason: attempt.rollbackReason || null,
        rejectedCandidateHash: attempt.rejectedCandidateHash || null,
        repairPattern: attempt.repairPattern || null,
        intent: attempt.intent || '',
        testCategory: attempt.testCategory || '',
        scenarioType: attempt.scenarioType || '',
        validation: attempt.verification ? {
          baselineRunNumber: attempt.verification.baselineRunNumber,
          results: attempt.verification.results,
          reason: attempt.verification.reason,
          validatedAt: attempt.verification.validatedAt,
        } : null,
      }),
    ]
  );
}
async function saveLearning(sessionId, session, attempt, outcome, currentCase = null) {
  if (!db.isEnabled()) return false;
  if (!persistence.enabled()) throw Object.assign(new Error('DATABASE_ENABLED requires a configured PostgreSQL database.'), { code: 'PERSISTENT_MODE_NOT_CONFIGURED' });
  await db.withTransaction(async (client) => {
    await persistence.persistSession(sessionId, session, { client });
    if (currentCase) {
      await persistence.persistTestCases(sessionId, [currentCase], client);
      await persistCaseIr(sessionId, currentCase, client);
    }
    await eventQuery(client, sessionId, session, attempt, outcome);
  });
  return true;
}

router.get('/api/test-cases/repair-learning/memory/:sessionId', async (req, res) => {
  const sessionId = sessionIdOf(req.params.sessionId);
  const session = getSession(sessionId);
  if (!owned(req, session)) return res.status(403).json({ ok: false, code: 'SESSION_ACCESS_DENIED' });
  try {
    const currentOrigin = learning.originFor(session);
    const items = await repairMemory.retrieveVerifiedMemory(session, { sessionId });

    return res.json({ ok: true, applicationOrigin: currentOrigin, validatedOnly: true, suggestionsRequireFreshDiscovery: true, items });
  } catch (error) { return problem(res, error); }
});

router.get('/api/test-cases/repair-learning/:sessionId/:caseId', (req, res) => {
  const session = getSession(sessionIdOf(req.params.sessionId));
  if (!owned(req, session)) return res.status(403).json({ ok: false, code: 'SESSION_ACCESS_DENIED' });
  const key = caseId(req.params.caseId);
  const attempt = learning.getAttempt(session, key);
  const { graph, impactedIds, changedDependencies, reasonsByCase } = learning.impactedCases(session, key, attempt?.originalSnapshot);
  const safeAttempt = attempt ? {
    attemptId: attempt.attemptId, status: attempt.status, caseId: key,
    originalHash: attempt.originalHash, candidateHash: attempt.candidateHash,
    failureSignature: attempt.failureSignature, createdAt: attempt.createdAt,
    verifiedAt: attempt.verifiedAt, verification: attempt.verification,
  } : null;
  return res.json({ ok: true, attempt: safeAttempt, graph, impactedIds, changedDependencies, reasonsByCase, approvalGate: learning.gateCheck(session, (session.testCases || []).find((tc) => caseId(tc.id) === key) || { id: key }) });
});

router.post('/api/test-cases/repair-learning/validate', async (req, res) => {
  const sessionId = sessionIdOf(req.body?.sessionId);
  const key = caseId(req.body?.testCaseId);
  const session = getSession(sessionId);
  if (!owned(req, session)) return res.status(403).json({ ok: false, code: 'SESSION_ACCESS_DENIED' });
  if (req.body?.confirmTargetSideEffects !== true)
    return res.status(422).json({ ok: false, code: 'REGRESSION_EXECUTION_CONFIRMATION_REQUIRED', reply: 'Confirm that regression tests may modify the configured Test environment.' });
  if (active.has(sessionId)) return res.status(409).json({ ok: false, code: 'REGRESSION_ALREADY_RUNNING' });
  active.add(sessionId);
  try {
    const scope = learning.suiteToValidate(session, key);
    const run = await executeIsolatedRegression(session, scope.cases);
    const outcome = learning.verifyExecution(scope.expectedIds, run);
    const caseNow = (session.testCases || []).find((tc) => caseId(tc.id) === key);
    if (scope.candidate !== caseNow || scope.baselineRunNumber !== (session.lastResults?.runNumber || null) ||
        Object.entries(scope.identities).some(([id, hash]) => {
          const tc = (session.testCases || []).find((item) => caseId(item.id) === id);
          return !tc || learning.contractIdentity(tc) !== hash;
        })) {
      throw Object.assign(new Error('The suite or baseline changed during validation. Re-run on the current version.'), { code: 'REPAIR_CONCURRENT_CHANGE' });
    }
    const previous = {
      testCases: session.testCases, approvedIds: session.approvedIds,
      approvedContractSeals: session.approvedContractSeals ? { ...session.approvedContractSeals } : null,
      generatedScript: session.generatedScript,
      automationReadiness: session.automationReadiness,
      repairLearning: JSON.parse(JSON.stringify(session.repairLearning || {})),
      validatedRepairMemory: [...(session.validatedRepairMemory || [])],
    };
    let restoredCase = null;
    const attempt = learning.recordEvaluation(session, key, scope, outcome);
    // A regression failure is harmful until proven otherwise. Never leave a
    // rejected candidate active: restore the known pre-edit contract automatically.
    if (!outcome.ok) {
      restoredCase = learning.rollback(session, key, {
        automatic: true, reason: outcome.reason || run?.error || 'Browser regression did not pass',
      });
    }
    try {
      await saveLearning(sessionId, session, attempt, attempt.status, restoredCase);
    } catch (error) {
      Object.assign(session, previous);
      throw error;
    }
    return res.status(outcome.ok ? 200 : 422).json({
      ok: outcome.ok,
      code: outcome.ok ? 'REPAIR_REGRESSION_VERIFIED' : 'REPAIR_AUTO_ROLLED_BACK',
      status: attempt.status, reason: outcome.reason || null, results: outcome.results,
      testedIds: scope.expectedIds, impactedIds: attempt.impactedIds,
      changedDependencies: scope.impact?.changedDependencies || null,
      verifiedAt: attempt.verifiedAt, autoRolledBack: !outcome.ok,
      testCase: restoredCase,
      requiresHumanReview: !outcome.ok,
      note: outcome.ok
        ? 'Only browser-verified repairs enter reusable learning memory.'
        : 'Cypress regression failed. The previous version was automatically restored as an unapproved draft.',
    });
  } catch (error) { return problem(res, error); }
  finally { active.delete(sessionId); }
});

router.post('/api/test-cases/repair-learning/rollback', async (req, res) => {
  const sessionId = sessionIdOf(req.body?.sessionId);
  const key = caseId(req.body?.testCaseId);
  const session = getSession(sessionId);
  if (!owned(req, session)) return res.status(403).json({ ok: false, code: 'SESSION_ACCESS_DENIED' });
  if (active.has(sessionId) || session.state === 'RUNNING')
    return res.status(409).json({ ok: false, code: 'REPAIR_CONCURRENT_CHANGE', reply: 'Execution is in progress.' });
  const saved = {
    testCases: session.testCases, approvedIds: session.approvedIds,
    approvedContractSeals: session.approvedContractSeals ? { ...session.approvedContractSeals } : null,
    generatedScript: session.generatedScript,
    automationReadiness: session.automationReadiness,
    validatedRepairMemory: [...(session.validatedRepairMemory || [])],
    repairLearning: JSON.parse(JSON.stringify(session.repairLearning || {})),
  };
  try {
    const restored = learning.rollback(session, key);
    await saveLearning(sessionId, session, learning.getAttempt(session, key), 'ROLLED_BACK', restored);
    return res.json({ ok: true, status: 'ROLLED_BACK', testCase: restored, requiresHumanReview: true, requiresFreshRegression: true });
  } catch (error) {
    Object.assign(session, saved);
    return problem(res, error);
  }
});
module.exports = router;

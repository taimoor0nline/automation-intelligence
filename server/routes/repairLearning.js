'use strict';
const express = require('express');
const db = require('../db');
const { getSession } = require('../data/sessionStore');
const persistence = require('../services/persistenceService');
const { persistCaseIr } = require('../services/canonicalArtifactStore');
const learning = require('../services/repairLearning');
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
    let items = (session.validatedRepairMemory || []).filter((item) => item.targetOrigin === currentOrigin);
    if (db.isEnabled()) {
      if (!persistence.enabled()) throw new Error('PostgreSQL is not configured.');
      const result = await db.query(
        `select attempt_id,external_case_id,target_origin,failure_signature,original_hash,candidate_hash,
          evidence_json,updated_at from repair_learning_events
          where outcome='VALIDATED' and target_origin=$1
          and (($2::uuid is not null and project_id=$2::uuid) or ($2::uuid is null and session_id=$3))
          order by updated_at desc limit 100`,
        [currentOrigin, session.projectId || null, sessionId]
      );
      items = result.rows.map((row) => ({
        attemptId: row.attempt_id, caseId: row.external_case_id, targetOrigin: row.target_origin,
        failureSignature: row.failure_signature, originalHash: row.original_hash,
        candidateHash: row.candidate_hash, verification: row.evidence_json,
        verifiedAt: row.updated_at,
      }));
    }
    return res.json({ ok: true, applicationOrigin: currentOrigin, validatedOnly: true, suggestionsRequireFreshDiscovery: true, items });
  } catch (error) { return problem(res, error); }
});

router.get('/api/test-cases/repair-learning/:sessionId/:caseId', (req, res) => {
  const session = getSession(sessionIdOf(req.params.sessionId));
  if (!owned(req, session)) return res.status(403).json({ ok: false, code: 'SESSION_ACCESS_DENIED' });
  const key = caseId(req.params.caseId);
  const attempt = learning.getAttempt(session, key);
  const { graph, impactedIds } = learning.impactedCases(session, key, attempt?.originalSnapshot);
  const safeAttempt = attempt ? {
    attemptId: attempt.attemptId, status: attempt.status, caseId: key,
    originalHash: attempt.originalHash, candidateHash: attempt.candidateHash,
    failureSignature: attempt.failureSignature, createdAt: attempt.createdAt,
    verifiedAt: attempt.verifiedAt, verification: attempt.verification,
  } : null;
  return res.json({ ok: true, attempt: safeAttempt, graph, impactedIds, approvalGate: learning.gateCheck(session, (session.testCases || []).find((tc) => caseId(tc.id) === key) || { id: key }) });
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
    const previousAttempt = JSON.parse(JSON.stringify(learning.getAttempt(session, key)));
    const previousMemory = [...(session.validatedRepairMemory || [])];
    const attempt = learning.recordEvaluation(session, key, scope, outcome);
    try {
      await saveLearning(sessionId, session, attempt, attempt.status);
    } catch (error) {
      session.repairLearning[key] = previousAttempt;
      session.validatedRepairMemory = previousMemory;
      throw error;
    }
    return res.status(outcome.ok ? 200 : 422).json({
      ok: outcome.ok, code: outcome.ok ? 'REPAIR_REGRESSION_VERIFIED' : 'REPAIR_REGRESSION_REJECTED',
      status: attempt.status, reason: outcome.reason || null, results: outcome.results,
      testedIds: scope.expectedIds, impactedIds: attempt.impactedIds, verifiedAt: attempt.verifiedAt,
      note: 'Only a passing real Cypress regression run can enter validated learning memory.',
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

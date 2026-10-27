'use strict';
process.env.DATABASE_ENABLED = 'false';
const assert = require('node:assert/strict');
const { contractReviewHash } = require('../server/services/reviewContract');
const learning = require('../server/services/repairLearning');
const memory = require('../server/services/repairLearningMemory');
const { getSession, resetSession } = require('../server/data/sessionStore');

function tc(caseId, ref, objective, extraRefs = []) {
  const input = {
    id: caseId, type: 'negative', testCategory: 'FUNCTIONAL', title: objective,
    expectedResults: ['Invalid email must be rejected.'],
    canonicalIr: {
      version: 1, plannedId: 'P001', objective,
      actions: [{ operation: 'TYPE', elementRef: ref, value: 'bad' }, ...extraRefs.map((elementRef) => ({ operation: 'CLICK', elementRef }))],
      assertions: [{ operation: 'ASSERT_INVALID', elementRef: ref }],
    },
    automationReadiness: {
      status: 'READY',
      automationPlan: { actions: [{ operation: 'TYPE', selector: '#email' }], assertions: [{ operation: 'ASSERT_INVALID', selector: '#email' }] },
      cypressContract: { ok: true, scriptHash: 'test:' + ref },
    },
  };
  input.review = { status: 'CONFIRMED', revision: 1, confirmedAt: '2026-10-27T00:00:00Z', contractHash: contractReviewHash(input) };
  return input;
}
function session(cases) {
  return {
    projectId: 'project-one',
    targetUrl: 'https://example.test/login',
    state: 'DONE',
    testCases: cases,
    canonicalElementRegistry: { elements: [
      { elementRef: 'old-ref', pageRef: 'login-page', formId: 'login-form', selector: '#old' },
      { elementRef: 'new-ref', pageRef: 'next-page', formId: 'next-form', selector: '#new' },
      { elementRef: 'connector-ref', pageRef: 'intermediate-page', formId: 'intermediate-form', selector: '#connector' },
      { elementRef: 'third-ref', pageRef: 'intermediate-page', formId: 'intermediate-form', selector: '#third' },
    ] },
    lastResults: { runNumber: 1, summary: { tests: cases.map((t) => ({
      testCaseId: t.id, pass: t.id !== 'TC001', err: t.id === 'TC001' ? { message: 'selector timed out' } : null,
    })) } },
    approvedIds: cases.map((t) => t.id), approvedContractSeals: {},
    generatedScript: 'frozen-before-edit', repairLearning: {}, validatedRepairMemory: [],
  };
}

(async () => {
  const objective = 'Reject malformed email during login and show invalid email validation';
  const original = tc('TC001', 'old-ref', objective);
  const candidate = tc('TC001', 'new-ref', objective);
  const second = tc('TC002', 'old-ref', 'Check login invalid email', ['connector-ref']);
  const third = tc('TC003', 'third-ref', 'Check login invalid email');
  const s = session([candidate, second, third]);
  const impact = learning.impactedCases(s, 'TC001', original);
  assert.deepEqual(impact.impactedIds, ['TC001', 'TC002', 'TC003'],
    'Transitive impact must include tests only connected through a second test.');
  assert(impact.changedDependencies.removed.includes('element:old-ref'), 'Old selector must be retained for impact analysis.');
  assert(impact.changedDependencies.added.includes('element:new-ref'));

  const attempt = learning.createAttempt(s, original, candidate);
  assert.deepEqual(attempt.impactedIds, ['TC001', 'TC002', 'TC003']);
  const scope = learning.suiteToValidate(s, 'TC001');
  assert.deepEqual(scope.expectedIds, ['TC001', 'TC002', 'TC003']);
  const broken = learning.verifyExecution(scope.expectedIds, {
    ok: true, summary: { tests: [
      { testCaseId: 'TC001', pass: true },
      { testCaseId: 'TC002', pass: true },
      { testCaseId: 'TC003', pass: false },
    ] },
  });
  assert.equal(broken.ok, false);
  assert.equal(learning.shouldAutoRollback(scope, {
    ok: true, summary: { tests: [
      { testCaseId: 'TC001', pass: true, state: 'passed' },
      { testCaseId: 'TC002', pass: true, state: 'passed' },
      { testCaseId: 'TC003', pass: false, state: 'failed' },
    ] },
  }, broken), true, 'A complete observed browser regression triggers automatic rollback.');
  assert.equal(learning.shouldAutoRollback(scope, { ok: false, error: 'Browser crashed' }, broken), false,
    'Infrastructure failures cannot be mislabelled as harmful fixes.');
  assert.equal(learning.shouldAutoRollback(scope, { ok: true, summary: { tests: [
    { testCaseId: 'TC001', pass: true, state: 'passed' },
  ] } }, broken), false, 'Incomplete evidence must never trigger automatic rollback.');
  learning.recordEvaluation(s, 'TC001', scope, broken);
  const reverted = learning.rollback(s, 'TC001', { automatic: true, reason: broken.reason });
  assert.equal(reverted.canonicalIr.actions[0].elementRef, 'old-ref', 'Automatic rollback must restore previous selector.');
  assert.equal(reverted.review.status, 'PENDING_REVIEW', 'Rollback must never restore execution approval.');
  assert.equal(s.approvedIds.includes('TC001'), false);
  assert.equal(s.repairLearning.TC001.rollbackMode, 'AUTOMATIC_REGRESSION_FAILURE');
  assert.equal(s.repairLearning.TC001.status, 'ROLLED_BACK');
  assert.equal(s.repairLearning.TC001.verification.results[2].pass, false, 'Failure evidence must remain available.');
  assert.equal(learning.gateCheck(s, reverted).ok, false);
  assert.equal(s.validatedRepairMemory.length, 0);

  // A fresh confirmed candidate is allowed after a rollback; it must pass all tests.
  s.testCases[0] = candidate;
  s.approvedIds = ['TC002', 'TC003'];
  learning.createAttempt(s, original, candidate);
  const fresh = learning.suiteToValidate(s, 'TC001');
  const passed = learning.verifyExecution(fresh.expectedIds, { ok: true, summary: {
    tests: fresh.expectedIds.map((testCaseId) => ({ testCaseId, pass: true, state: 'passed' })),
  } });
  learning.recordEvaluation(s, 'TC001', fresh, passed);
  const records = memory.sessionMemories(s);
  assert.equal(records.length, 1);
  assert.equal(records[0].approval, 'HUMAN_CONFIRMED_AND_BROWSER_VERIFIED');
  assert.equal(records[0].projectId, 'project-one');

  // Same behavior, different TC number: previous implementation could not reuse it.
  const nextTest = tc('TC087', 'new-ref', 'Verify malformed email during login is rejected');
  const hints = memory.findMatchingHints({ records, session: s, testCase: nextTest });
  assert.equal(hints.length, 1, 'A new test case can reuse a similar verified pattern.');
  assert.deepEqual(hints[0].after.map((step) => step.elementRef), ['new-ref','new-ref']);
  assert(memory.describeHints(hints).includes('browser-verified'));
  assert.equal(memory.findMatchingHints({
    records, session: { ...s, projectId: 'project-other' }, testCase: nextTest,
  }).length, 0, 'Project boundary is strict.');
  assert.equal(memory.findMatchingHints({
    records, session: { ...s, targetUrl: 'https://other.test' }, testCase: nextTest,
  }).length, 0, 'Application-origin boundary is strict.');
  assert.equal(memory.findMatchingHints({
    records, session: { ...s, canonicalElementRegistry: { elements: [{ elementRef: 'old-ref' }] } }, testCase: nextTest,
  }).length, 0, 'A stale replacement selector must not be reused.');
  assert.equal(memory.findMatchingHints({
    records, session: { ...s, canonicalElementRegistry: { elements: [{ elementRef: 'new-ref' }] } }, testCase: nextTest,
  }).length, 1, 'An old selector may disappear, while the verified replacement remains grounded.');
  assert.equal(memory.findMatchingHints({
    records: records.map((record) => ({ ...record, approval: 'AI_ONLY' })), session: s, testCase: nextTest,
  }).length, 0, 'Unverified suggestions cannot be retrieved.');
  assert.equal(memory.findMatchingHints({
    records, session: s, testCase: tc('TC088','new-ref','Calculate tax invoice totals'),
  }).length, 0, 'Different business intent cannot reuse an unrelated repair.');

  const again = resetSession('repair-learning-memory-reset-test');
  again.projectId = s.projectId;
  again.validatedRepairMemory = records;
  const refreshed = resetSession('repair-learning-memory-reset-test');
  assert.equal(refreshed.projectId, 'project-one', 'New test generation must retain project context.');
  assert.equal(refreshed.validatedRepairMemory.length, 1, 'Verified memories survive reset, not failed attempts.');

  // Roll back a previously validated attempt: the source memory must be revoked.
  const rolledBack = learning.rollback(s, 'TC001', { automatic: false });
  assert.equal(rolledBack.review.status, 'PENDING_REVIEW');
  assert.equal(memory.sessionMemories(s).length, 0, 'Reverted repairs cannot be used for future recommendations.');
  assert.equal(learning.gateCheck(s, rolledBack).ok, false);

  const noBaseline = session([candidate, second, third]);
  noBaseline.lastResults.summary.tests = [{ testCaseId: 'TC001', pass: false }];
  learning.createAttempt(noBaseline, original, candidate);
  assert.throws(() => learning.suiteToValidate(noBaseline, 'TC001'),
    (error) => error.code === 'REGRESSION_IMPACT_BASELINE_MISSING');
  console.log('repair-learning-memory-smoke: PASS (transitive impact, safe auto rollback, cross-case reuse, memory revocation, scoping)');
})().catch((error) => { console.error(error); process.exitCode = 1; });

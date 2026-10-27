'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const learning = require('../server/services/repairLearning');
const { contractReviewHash } = require('../server/services/reviewContract');

function makeCase(testId, ref = 'ref:email', operation = 'ASSERT_INVALID') {
  const result = {
    id: testId,
    title: 'A grounded expected behavior',
    type: 'negative',
    steps: ['Visit the page', 'Fill input', 'Submit'],
    expectedResults: ['The input remains invalid'],
    canonicalIr: {
      version: 1,
      plannedId: 'P001',
      actions: [{ operation: 'TYPE', elementRef: ref, value: 'bad' }],
      assertions: [{ operation, elementRef: ref }],
    },
    automationReadiness: {
      status: 'READY',
      automationPlan: {
        plannedId: 'P001',
        actions: [{ operation: 'TYPE', selector: '#email' }],
        assertions: [{ operation, selector: '#email' }],
      },
      cypressContract: { ok: true, scriptHash: 'test-only-' + ref },
    },
  };
  result.review = {
    status: 'CONFIRMED',
    revision: 1,
    confirmedAt: '2026-10-27T00:00:00Z',
    contractHash: contractReviewHash(result),
  };
  return result;
}
function sessionFor(candidate, sibling = null) {
  const tests = [{ testCaseId: 'TC001', pass: false, err: { message: 'Expected validation response after 4000 ms' } }];
  if (sibling) tests.push({ testCaseId: 'TC002', pass: true });
  return {
    story: 'Rejected invalid email must remain invalid.',
    targetUrl: 'https://example.test/login',
    state: 'DONE',
    canonicalElementRegistry: {
      elements: [
        { elementRef: 'ref:email', pageRef: 'page:login', formId: 'form:login' },
        { elementRef: 'ref:email-new', pageRef: 'page:login', formId: 'form:login' },
        { elementRef: 'ref:password', pageRef: 'page:login', formId: 'form:login' },
      ],
    },
    testCases: [candidate, ...(sibling ? [sibling] : [])],
    lastResults: { runNumber: 3, summary: { tests } },
    approvedIds: ['TC001', ...(sibling ? ['TC002'] : [])],
    repairLearning: {},
    validatedRepairMemory: [],
  };
}
function runFixture(caseIds, failed = []) {
  return {
    ok: true,
    summary: {
      tests: caseIds.map((testCaseId) => ({
        testCaseId, state: failed.includes(testCaseId) ? 'failed' : 'passed', pass: !failed.includes(testCaseId),
      })),
    },
  };
}

const original = makeCase('TC001', 'ref:email');
const candidate = makeCase('TC001', 'ref:email-new');
const sibling = makeCase('TC002', 'ref:password');
const session = sessionFor(candidate, sibling);
const attempt = learning.createAttempt(session, original, candidate);
assert.equal(attempt.status, 'PENDING_VALIDATION');
assert.equal(learning.gateCheck(session, candidate).ok, false, 'Unverified repairs must never receive executable approval.');
const impact = learning.impactedCases(session, 'TC001', original);
assert(impact.impactedIds.includes('TC002'), 'Shared page/form dependencies must link test cases.');
const scope = learning.suiteToValidate(session, 'TC001');
assert.deepEqual(scope.expectedIds, ['TC001', 'TC002'], 'Full previous run scope must be checked, not only the repaired test.');
assert.equal(learning.verifyExecution(scope.expectedIds, runFixture(['TC001'])).ok, false, 'Missing sibling result must fail closed.');
assert.equal(learning.verifyExecution(scope.expectedIds, runFixture(['TC001', 'TC002'], ['TC002'])).ok, false, 'Broken previously passing tests must block promotion.');
assert.equal(learning.verifyExecution(scope.expectedIds, { ok: false, error: 'Cypress unavailable' }).ok, false, 'Engine failure must block.');
const successful = learning.verifyExecution(scope.expectedIds, runFixture(scope.expectedIds));
assert.equal(successful.ok, true);
learning.recordEvaluation(session, 'TC001', scope, successful);
assert.equal(learning.gateCheck(session, candidate).ok, true, 'Only verified candidate is executable.');
assert.equal(session.validatedRepairMemory.length, 1);
assert.equal(session.validatedRepairMemory[0].approval, 'HUMAN_CONFIRMED_AND_BROWSER_VERIFIED');
assert(session.validatedRepairMemory[0].repairPattern.after.length > 0);

// Later full passing executions reinforce the same candidate version, rather than
// requiring the user to run the repair gate before every ordinary re-run.
session.lastResults = { runNumber: 4, summary: { tests: runFixture(scope.expectedIds).summary.tests } };
assert.equal(learning.gateCheck(session, candidate).ok, true);
session.lastResults.summary.tests = runFixture(['TC001']).summary.tests;
assert.equal(learning.gateCheck(session, candidate).ok, false, 'An incomplete later run cannot silently replace verified scope.');
session.lastResults = { runNumber: 3, summary: { tests: sessionFor(candidate, sibling).lastResults.summary.tests } };

// Modifying another tested contract invalidates the verification, even if TC001 is unchanged.
sibling.expectedResults = ['This expected behavior changed'];
sibling.review.contractHash = contractReviewHash(sibling);
assert.equal(learning.gateCheck(session, candidate).ok, false);
sibling.expectedResults = ['The input remains invalid'];
sibling.review.contractHash = contractReviewHash(sibling);

// Rollback must restore exact earlier assertions while clearing approval.
const restored = learning.rollback(session, 'TC001');
assert.equal(restored.canonicalIr.actions[0].elementRef, 'ref:email');
assert.equal(restored.review.status, 'PENDING_REVIEW');
assert(!session.approvedIds.includes('TC001'));
assert.equal(learning.gateCheck(session, restored).ok, false);

// A weakened business assertion is never an eligible automation repair.
const weakened = makeCase('TC001', 'ref:email-new', 'ASSERT_VISIBLE');
const unsafe = sessionFor(weakened);
learning.createAttempt(unsafe, original, weakened);
assert.throws(() => learning.suiteToValidate(unsafe, 'TC001'), (error) => error.code === 'BUSINESS_ASSERTION_CHANGED');
assert.equal(learning.unchangedRequirements(original, candidate), true);
// Baseline coverage must fail closed rather than silently excluding unlabelled tests.
const unlabelled = sessionFor(makeCase('TC001', 'ref:email-new'), makeCase('TC002', 'ref:password'));
unlabelled.lastResults.summary.tests[1].testCaseId = null;
learning.createAttempt(unlabelled, original, unlabelled.testCases[0]);
assert.throws(() => learning.suiteToValidate(unlabelled, 'TC001'), (error) => error.code === 'REGRESSION_BASELINE_UNIDENTIFIED');
assert.equal(learning.unchangedRequirements(original, weakened), false);

// When there is only one case, its first browser run can establish validation
// evidence without needing a previous full-suite baseline.
const firstCase = sessionFor(makeCase('TC001', 'ref:email-new'));
firstCase.lastResults = null;
learning.createAttempt(firstCase, original, firstCase.testCases[0]);
assert.deepEqual(learning.suiteToValidate(firstCase, 'TC001').expectedIds, ['TC001']);
const noBaseline = sessionFor(makeCase('TC001', 'ref:email-new'), makeCase('TC002', 'ref:password'));
noBaseline.lastResults = null;
learning.createAttempt(noBaseline, original, noBaseline.testCases[0]);
assert.throws(() => learning.suiteToValidate(noBaseline, 'TC001'), (error) => error.code === 'REGRESSION_BASELINE_MISSING');
const failedSibling = sessionFor(makeCase('TC001', 'ref:email-new'), makeCase('TC002', 'ref:password'));
failedSibling.lastResults.summary.tests[1].pass = false;
learning.createAttempt(failedSibling, original, failedSibling.testCases[0]);
assert.throws(() => learning.suiteToValidate(failedSibling, 'TC001'), (error) => error.code === 'REGRESSION_BASELINE_FAILED');

// Route wiring and migrations are deliberate contracts, not documentation-only.
const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server', 'index.js'), 'utf8');
assert(server.includes('app.use(repairLearningRoutes);'));
assert(server.includes('app.use(approvalContractGuardRoutes);'));
assert(server.indexOf('app.use(approvalContractGuardRoutes);') < server.indexOf('app.use(runRoutes);'));
const guard = fs.readFileSync(path.join(root, 'server', 'routes', 'approvalContractGuard.js'), 'utf8');
assert(guard.includes('REPAIR_REGRESSION') || guard.includes('gateCheck(session, testCase)'));
const migration = fs.readFileSync(path.join(root, 'server', 'db', '090_repair_learning.sql'), 'utf8');
assert(migration.includes('repair_learning_events') && migration.includes('outcome') && migration.includes('project_id'));
console.log('repair-learning-smoke: PASS (version history, dependency graph, baseline, rejection, memory, rollback, immutable gate)');

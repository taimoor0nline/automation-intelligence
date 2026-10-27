'use strict';
// HTTP-level contract smoke test: mocks only the Cypress execution boundary.
// The real Express route, ownership, revision, rollback and memory paths execute.
process.env.DATABASE_ENABLED = 'false';
process.env.AUTH_REQUIRED = 'false';
const assert = require('node:assert/strict');
const express = require('express');
const { getSession } = require('../server/data/sessionStore');
const { contractReviewHash } = require('../server/services/reviewContract');
const learning = require('../server/services/repairLearning');

const runner = require('../server/services/isolatedRegressionRunner');
const priorRunner = runner.executeIsolatedRegression;
let simulation = 'FAIL';
runner.executeIsolatedRegression = async (_session, cases) => ({
  ok: true,
  summary: {
    total: cases.length,
    tests: cases.map((tc) => ({
      testCaseId: tc.id, pass: simulation === 'PASS' || tc.id === 'TC001',
      state: simulation === 'PASS' || tc.id === 'TC001' ? 'passed' : 'failed',
    })),
  },
});
const router = require('../server/routes/repairLearning');

function tc(ref, id, objective = 'Reject malformed email during login') {
  const item = {
    id, title: objective, testCategory: 'FUNCTIONAL', type: 'negative',
    expectedResults: ['Invalid email must be rejected'],
    canonicalIr: { objective, plannedId: 'P001', version: 1,
      actions: [{ operation: 'TYPE', elementRef: ref, value: 'bad' }],
      assertions: [{ operation: 'ASSERT_INVALID', elementRef: ref }],
    },
    automationReadiness: { status: 'READY',
      automationPlan: { actions: [{ operation: 'TYPE', selector: '#email' }], assertions: [{ operation: 'ASSERT_INVALID', selector: '#email' }] },
      cypressContract: { ok: true, scriptHash: ref },
    },
  };
  item.review = { status: 'CONFIRMED', revision: 2, confirmedAt: new Date().toISOString(), contractHash: contractReviewHash(item) };
  return item;
}
const sessionId = 'auto-rollback-http-smoke';
const s = getSession(sessionId);
const objective = 'Reject malformed email during login';
const original = tc('old-ref', 'TC001', objective);
const candidate = tc('new-ref', 'TC001', objective);
const neighbor = tc('old-ref', 'TC002', objective);
s.story = objective;
s.state = 'DONE';
s.targetUrl = 'https://example.test/login';
s.canonicalElementRegistry = { elements: [
  { elementRef: 'old-ref', pageRef: 'login-page', formId: 'login-form', selector: '#old' },
  { elementRef: 'new-ref', pageRef: 'login-page', formId: 'login-form', selector: '#new' },
] };
s.testCases = [candidate, neighbor];
s.lastResults = { runNumber: 1, summary: { tests: [
  { testCaseId: 'TC001', pass: false, err: { message: 'stale selector' } },
  { testCaseId: 'TC002', pass: true },
] } };
s.approvedIds = ['TC001', 'TC002'];
learning.createAttempt(s, original, candidate);

const app = express();
app.use(express.json());
app.use(router);
const server = app.listen(0, '127.0.0.1');

async function post(endpoint, body) {
  const res = await fetch('http://127.0.0.1:' + server.address().port + endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}
async function get(endpoint) {
  const res = await fetch('http://127.0.0.1:' + server.address().port + endpoint);
  return { status: res.status, json: await res.json() };
}

(async () => {
  try {
    await new Promise((resolve) => server.listening ? resolve() : server.once('listening', resolve));
    const route = '/api/test-cases/repair-learning/validate';
    const payload = { sessionId, testCaseId: 'TC001', confirmTargetSideEffects: true };
    const denied = await post(route, { ...payload, confirmTargetSideEffects: false });
    assert.equal(denied.status, 422);
    assert.equal(denied.json.code, 'REGRESSION_EXECUTION_CONFIRMATION_REQUIRED');

    const impact = await get('/api/test-cases/repair-learning/' + sessionId + '/TC001');
    assert.equal(impact.status, 200);
    assert.deepEqual(impact.json.impactedIds, ['TC001','TC002']);

    const failing = await post(route, payload);
    assert.equal(failing.status, 422);
    assert.equal(failing.json.code, 'REPAIR_AUTO_ROLLED_BACK');
    assert.equal(failing.json.autoRolledBack, true);
    assert.equal(failing.json.testCase.canonicalIr.actions[0].elementRef, 'old-ref');
    assert.equal(failing.json.testCase.review.status, 'PENDING_REVIEW');
    assert.equal(s.testCases[0].canonicalIr.actions[0].elementRef, 'old-ref');
    assert.equal(s.repairLearning.TC001.status, 'ROLLED_BACK');
    assert.equal(s.approvedIds.includes('TC001'), false);
    assert.equal(s.validatedRepairMemory.length, 0);

    // Retrying needs a newly confirmed candidate; browser success is the sole
    // operation that can promote the version into reusable memory.
    s.testCases[0] = candidate;
    learning.createAttempt(s, original, candidate);
    simulation = 'PASS';
    const passing = await post(route, payload);
    assert.equal(passing.status, 200, JSON.stringify(passing.json));
    assert.equal(passing.json.code, 'REPAIR_REGRESSION_VERIFIED');
    assert.equal(s.repairLearning.TC001.status, 'VALIDATED');
    assert.equal(s.validatedRepairMemory.length, 1);
    const remembered = await get('/api/test-cases/repair-learning/memory/' + sessionId);
    assert.equal(remembered.status, 200);
    assert.equal(remembered.json.items.length, 1);
    assert.equal(remembered.json.items[0].approval, 'HUMAN_CONFIRMED_AND_BROWSER_VERIFIED');

    const manual = await post('/api/test-cases/repair-learning/rollback', { sessionId, testCaseId: 'TC001' });
    assert.equal(manual.status, 200);
    assert.equal(manual.json.testCase.review.status, 'PENDING_REVIEW');
    const afterRollback = await get('/api/test-cases/repair-learning/memory/' + sessionId);
    assert.equal(afterRollback.json.items.length, 0, 'Rolled-back learning is revoked immediately.');
    console.log('repair-learning-route-smoke: PASS (API validation, automatic restore, verified memory and revocation)');
  } finally {
    runner.executeIsolatedRegression = priorRunner;
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; server.close(); });

const assert = require('assert');
const express = require('express');
const db = require('../server/db');
const { getSession } = require('../server/data/sessionStore');
const { buildCanonicalElementRegistry } = require('../server/services/canonicalElementRegistry');
const { validateCanonicalIr } = require('../server/services/canonicalTestIrV3');
require('../server/services/startupIntegrityGuards').install();
require('../server/services/runtimeHardeningPatches').install();
require('../server/services/strictCypressIntegration').install();
const repair = require('../server/routes/testCaseRepairWorkbench');
const approval = require('../server/routes/approvalContractGuard');

const page = {
  url: 'https://example.test/login', finalUrl: 'https://example.test/login',
  pageTitle: 'Login',
  elements: [
    { tag: 'input', type: 'email', id: 'email', selector: '#email', label: 'Email', required: true, formId: 'login' },
    { tag: 'input', type: 'password', id: 'password', selector: '#password', label: 'Password', required: true, formId: 'login' },
    { tag: 'button', type: 'submit', id: 'sign-in', selector: '#sign-in', label: 'Sign in', text: 'Sign in', formId: 'login' },
  ],
};
const registry = buildCanonicalElementRegistry([page]);
const byId = new Map(registry.elements.map(element => [element.id, element]));
const script = [
  'cy.visit("/login");',
  'cy.get("#email").type("bad-email");',
  'cy.get("#password").type("valid-test-password");',
  'cy.get("#sign-in").click();',
  'cy.get("#email").should("match", ":invalid");',
].join('\n');
const story = 'As a user, test negative login validation with invalid email.';
const objective = 'Login rejects malformed email using native validation';
const ir = {
  version: 1, plannedId: 'P001', objective,
  actions: [
    { operation: 'NAVIGATE', path: '/login' },
    { operation: 'TYPE', elementRef: byId.get('email').elementRef, value: 'bad-email' },
    { operation: 'TYPE', elementRef: byId.get('password').elementRef, value: 'valid-test-password' },
    { operation: 'CLICK', elementRef: byId.get('sign-in').elementRef },
  ],
  assertions: [{ operation: 'ASSERT_INVALID', elementRef: byId.get('email').elementRef }],
};
const checked = validateCanonicalIr(ir, {
  registry,
  plannedUnit: { plannedId: 'P001', category: 'FUNCTIONAL', scenarioType: 'negative', objective },
  story,
  hasCredentials: false,
});
assert(checked.ok, checked.reason || JSON.stringify(checked.errors || []));

const app = express();
app.use(express.json());
app.use(approval);
app.use(repair);
app.post('/api/test-runs/start', (_req, res) => res.json({ ok: true, reachedExecutionEndpoint: true }));
const server = app.listen(0, '127.0.0.1');

function seed(sessionId) {
  const session = getSession(sessionId);
  session.state = 'GENERATED';
  session.story = story;
  session.targetUrl = 'https://example.test/login';
  session.pageDiscoveries = [page];
  session.canonicalElementRegistry = registry;
  session.testCases = [{
    id: 'TC001', title: objective, type: 'negative', testCategory: 'FUNCTIONAL',
    priority: 'medium', source: 'ai-canonical',
    steps: checked.display.steps, expectedResults: checked.display.expectedResults,
    preconditions: [], testData: {}, canonicalIr: ir,
  }];
  session.approvedIds = [];
  session.automationReadiness = { ready: 0, total: 1 };
  return session;
}
async function post(path, body) {
  const address = server.address();
  const response = await fetch('http://127.0.0.1:' + address.port + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
async function testMode(mode, number) {
  const id = 'repair-flow-' + mode + '-' + number;
  const session = seed(id);
  const save = await post('/api/test-cases/repair-workbench', {
    sessionId: id, action: 'manual-script', testCase: { id: 'TC001' }, script, expectedRevision: 0,
  });
  assert.equal(save.status, 200, JSON.stringify(save.body));
  assert.equal(save.body.testCase.review.status, 'PENDING_REVIEW');
  assert.equal(save.body.automationReady, true);
  assert.equal(save.body.persisted, mode === 'database');
  const latest = session.testCases[0];
  assert.equal(latest.manualCypressScript, script);
  const blocked = await post('/api/test-runs/start', {
    sessionId: id, approvedIds: ['TC001'], reviewedTestCases: [latest],
  });
  assert.equal(blocked.status, 422, JSON.stringify(blocked.body));
  assert.equal(blocked.body.code, 'HUMAN_REVIEW_CONFIRMATION_REQUIRED');

  const stale = await post('/api/test-cases/repair-workbench', {
    sessionId: id, action: 'confirm', testCase: { id: 'TC001' },
    expectedRevision: 0, reviewHash: latest.review.contractHash,
  });
  assert.equal(stale.status, 422);
  assert.equal(stale.body.code, 'REVIEW_VERSION_CONFLICT');

  const confirmed = await post('/api/test-cases/repair-workbench', {
    sessionId: id, action: 'confirm', testCase: { id: 'TC001' },
    expectedRevision: 1, reviewHash: latest.review.contractHash,
  });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  assert.equal(confirmed.body.testCase.review.status, 'CONFIRMED');
  assert.equal(confirmed.body.requiresHumanReview, false);

  const rejected = await post('/api/test-cases/repair-workbench', {
    sessionId: id, action: 'manual-script', testCase: { id: 'TC001' },
    expectedRevision: 1,
    script: 'cy.visit("/login");\ncy.get("#invented").click();\ncy.get("#email").should("be.visible");',
  });
  assert.equal(rejected.status, 422);
  assert.equal(session.testCases[0].review.status, 'CONFIRMED', 'Invalid edit must not corrupt the previously validated case.');
}

(async () => {
  await new Promise(resolve => server.listening ? resolve() : server.on('listening', resolve));
  const previous = { isConfigured: db.isConfigured, withTransaction: db.withTransaction };
  try {
    db.isConfigured = () => false;
    await testMode('session-only', 1);
    const writes = [];
    db.isConfigured = () => true;
    db.withTransaction = async fn => fn({ query: async (sql, params) => {
      writes.push({ sql, params }); return { rows: [], rowCount: 1 };
    } });
    await testMode('database', 2);
    assert(writes.some(entry => entry.sql.includes('insert into canonical_test_ir')));
    assert(writes.some(entry => entry.sql.includes('insert into test_sessions')));
  } finally {
    db.isConfigured = previous.isConfigured;
    db.withTransaction = previous.withTransaction;
    server.close();
  }
  console.log('repair-route-integration-smoke: PASS (manual script → validate → save → confirm; both modes)');
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });

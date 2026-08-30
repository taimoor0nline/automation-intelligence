const assert = require('assert');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  normalizeActorProfiles,
  publicActorCatalog,
  actorCredentialStatus,
} = require('../server/services/testActorProfiles');
const {
  normalizeWorkflowRequirements,
  inferWorkflowActorSequence,
  workflowContextForModel,
} = require('../server/services/workflowRequirements');
const { resolveRuntimeWorkflowContext } = require('../server/services/workflowRuntimeContext');
const requestContext = require('../server/services/requestContext');
const { actorValidationErrors } = require('../server/services/canonicalTestIrV3');
const {
  generateCypressPreviewFromPlan,
  generateDeterministicAutomation,
} = require('../server/services/deterministicAutomationGeneratorV6');
const { validateGroundedScript } = require('../server/services/scriptValidator');
const { buildSafeSessionPayload } = require('../server/services/persistenceService');
const { getSession, resetSession, hydrateSession } = require('../server/data/sessionStore');

function assertNoSecrets(value, secrets) {
  const serialized = JSON.stringify(value);
  for (const secret of secrets) {
    assert(!serialized.includes(secret), `Secret leaked into public artifact: ${secret}`);
  }
}

function runRequestContext(body, callback) {
  let called = false;
  requestContext.middleware({ body, params: {}, query: {}, user: null }, {}, () => {
    called = true;
    callback();
  });
  assert.strictEqual(called, true, 'Request context middleware must invoke next().');
}

function inspectDbMode(enabled, databaseUrl) {
  const root = path.resolve(__dirname, '..');
  const script = [
    "const db=require('./server/db');",
    "process.stdout.write(JSON.stringify({enabled:db.isEnabled(),configured:db.isConfigured(),required:db.isRequired()}));",
  ].join('');
  const output = execFileSync(process.execPath, ['-e', script], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      DATABASE_ENABLED: enabled ? 'true' : 'false',
      DATABASE_URL: databaseUrl || '',
      DATABASE_REQUIRED: 'false',
    },
  });
  return JSON.parse(output);
}

const rawActors = [
  { role: 'Requester', username: 'requester.qa', password: 'RequesterSecret!' },
  { role: 'Manager', username: 'manager.qa', password: 'ManagerSecret!' },
  { role: 'Approver', username: 'approver.qa', password: 'ApproverSecret!' },
];
const secrets = rawActors.flatMap((actor) => [actor.username, actor.password]);
const workflow = normalizeWorkflowRequirements(
  'Requester submits the request. Manager reviews it. Approver approves it. Requester verifies the final approved status.'
);

// Actor catalog normalization must split safe role metadata from runtime credentials.
const normalized = normalizeActorProfiles(rawActors);
assert.deepStrictEqual(normalized.catalog.map((actor) => actor.actorRef), [
  'actor_requester',
  'actor_manager',
  'actor_approver',
]);
assert.deepStrictEqual(normalized.catalog.map((actor) => actor.role), ['Requester', 'Manager', 'Approver']);
assert.strictEqual(Object.keys(normalized.credentials).length, 3);
assertNoSecrets(normalized.catalog, secrets);
assertNoSecrets(publicActorCatalog(rawActors), secrets);

const status = actorCredentialStatus(normalized.catalog, normalized.credentials);
assert(status.every((actor) => actor.credentialsConfigured === true));
assertNoSecrets(status, secrets);

// User-authored workflow requirements preserve role order, including a later return
// to Requester after Manager/Approver handoffs.
assert.deepStrictEqual(inferWorkflowActorSequence(workflow, normalized.catalog), [
  'actor_requester',
  'actor_manager',
  'actor_approver',
  'actor_requester',
]);
const workflowModelContext = workflowContextForModel(workflow, normalized.catalog);
assert.strictEqual(workflowModelContext.requirements, workflow);
assert.deepStrictEqual(workflowModelContext.actorSequence, [
  'actor_requester',
  'actor_manager',
  'actor_approver',
  'actor_requester',
]);
assertNoSecrets(workflowModelContext, secrets);

// Canonical role actions require configured actors and configured runtime credentials.
const actorIr = {
  version: 3,
  plannedId: 'P001',
  objective: 'Requester submits, Manager reviews, Approver approves',
  actions: [
    { operation: 'LOGIN_AS_ACTOR', actorRef: 'actor_requester' },
    { operation: 'LOGIN_AS_ACTOR', actorRef: 'actor_manager' },
    { operation: 'LOGIN_AS_ACTOR', actorRef: 'actor_approver' },
  ],
  assertions: [],
};

assert.deepStrictEqual(actorValidationErrors(actorIr, {
  actorCatalog: normalized.catalog,
  actorCredentialRefs: Object.keys(normalized.credentials),
}), []);

const missingManager = actorValidationErrors(actorIr, {
  actorCatalog: normalized.catalog,
  actorCredentialRefs: ['actor_requester', 'actor_approver'],
});
assert(missingManager.some((message) => message.includes('actor_manager')));
assert(missingManager.some((message) => /credentials/i.test(message)));

// Cypress projection must preserve the Requester -> Manager -> Approver ordering and
// contain actor refs only, never usernames/passwords or direct Cypress.env access.
const plan = {
  actions: [
    { operation: 'LOGIN_AS_ACTOR', actorRef: 'actor_requester', role: 'Requester', displayName: 'Requester' },
    { operation: 'LOGIN_AS_ACTOR', actorRef: 'actor_manager', role: 'Manager', displayName: 'Manager' },
    { operation: 'LOGIN_AS_ACTOR', actorRef: 'actor_approver', role: 'Approver', displayName: 'Approver' },
  ],
  assertions: [],
};

const preview = generateCypressPreviewFromPlan(plan, {
  id: 'P001',
  title: 'Requester to Manager to Approver workflow',
});
const requesterPreviewIndex = preview.indexOf('cy.loginAsTestActor("actor_requester")');
const managerPreviewIndex = preview.indexOf('cy.loginAsTestActor("actor_manager")');
const approverPreviewIndex = preview.indexOf('cy.loginAsTestActor("actor_approver")');
assert(requesterPreviewIndex >= 0 && managerPreviewIndex > requesterPreviewIndex && approverPreviewIndex > managerPreviewIndex);
assertNoSecrets(preview, secrets);
assert(!preview.includes('Cypress.env('));

const approvedTestCases = [{
  id: 'TC001',
  title: 'Requester to Manager to Approver workflow',
  automationReadiness: { status: 'READY', automationPlan: plan },
}];
const generated = generateDeterministicAutomation(approvedTestCases);
const requesterIndex = generated.script.indexOf('cy.loginAsTestActor("actor_requester")');
const managerIndex = generated.script.indexOf('cy.loginAsTestActor("actor_manager")');
const approverIndex = generated.script.indexOf('cy.loginAsTestActor("actor_approver")');
assert(requesterIndex >= 0 && managerIndex > requesterIndex && approverIndex > managerIndex);
assertNoSecrets(generated.script, secrets);
assert(!generated.script.includes('Cypress.env('));
assert(!generated.script.includes('TEST_ACTORS_JSON'));

const pageDiscoveries = [{
  url: 'http://localhost:4000/login',
  finalUrl: 'http://localhost:4000/login',
  elements: [
    { selector: '#username', id: 'username', name: 'username', type: 'text' },
    { selector: '#password', id: 'password', name: 'password', type: 'password' },
    { selector: '#login-button', id: 'login-button', type: 'button', text: 'Login' },
  ],
}];
const validation = validateGroundedScript(generated.script, {
  approvedTestCases,
  pageDiscoveries,
  hasCredentials: false,
  loginSelectors: {
    username: '#username',
    password: '#password',
    submit: '#login-button',
  },
  actorCredentialRefs: Object.keys(normalized.credentials),
  frameworkOwnedSelectors: ['body'],
});
assert.strictEqual(validation.valid, true, validation.errors.join(' | '));

// PostgreSQL persistence must serialize only public actor metadata + safe workflow
// requirements. Neither the default login nor role credentials may reach session_json.
const persistenceSource = {
  state: 'AWAITING_APPROVAL',
  targetType: 'WEB',
  story: 'Test the approval workflow.',
  workflowRequirements: workflow,
  targetUrl: 'http://localhost:4000/',
  environment: 'Test',
  aiModelTier: 'fast',
  credentials: { username: 'default.qa', password: 'DefaultSecret!' },
  testActors: normalized.catalog,
  actorCredentials: normalized.credentials,
  testCases: [],
  runHistory: [],
  failureAnalyses: [],
};
const safePersistence = buildSafeSessionPayload(persistenceSource);
assert.deepStrictEqual(safePersistence.testActors, normalized.catalog);
assert.strictEqual(safePersistence.workflowRequirements, workflow);
assert.strictEqual(Object.prototype.hasOwnProperty.call(safePersistence, 'actorCredentials'), false);
assert.strictEqual(Object.prototype.hasOwnProperty.call(safePersistence, 'credentials'), false);
assertNoSecrets(safePersistence, [...secrets, 'default.qa', 'DefaultSecret!']);

// DB-backed rehydration restores public actor/workflow metadata but deliberately drops
// every credential. The tester must re-bind role credentials before execution.
const sessionId = `actor-smoke-${Date.now()}`;
resetSession(sessionId);
const hydrated = hydrateSession(sessionId, safePersistence);
assert.deepStrictEqual(hydrated.testActors, normalized.catalog, 'Public actor catalog must survive PostgreSQL/session rehydration.');
assert.strictEqual(hydrated.workflowRequirements, workflow, 'Workflow requirements must survive PostgreSQL/session rehydration.');
assert.deepStrictEqual(hydrated.actorCredentials, {}, 'Role credentials must never be restored from persisted session state.');
assert.strictEqual(hydrated.credentials, null, 'Default credentials must never be restored from persisted session state.');

// Re-bind a DB-rehydrated session using the runtime-only request payload. This mirrors
// clicking Run Approved Tests after a restart: safe catalog comes from persistence,
// fresh credentials come from the UI and exist only in process memory.
runRequestContext({ sessionId, testActors: rawActors, workflowRequirements: workflow }, () => {
  const rebound = getSession(sessionId);
  assert.deepStrictEqual(rebound.testActors, normalized.catalog);
  assert.strictEqual(rebound.workflowRequirements, workflow);
  assert.deepStrictEqual(Object.keys(rebound.actorCredentials), [
    'actor_requester',
    'actor_manager',
    'actor_approver',
  ]);
  const runtime = resolveRuntimeWorkflowContext();
  assert.deepStrictEqual(runtime.actorCredentialRefs, [
    'actor_requester',
    'actor_manager',
    'actor_approver',
  ]);
  assert.deepStrictEqual(runtime.workflowContext.actorSequence, [
    'actor_requester',
    'actor_manager',
    'actor_approver',
    'actor_requester',
  ]);
});

// Generation/start resets the session after request middleware. AsyncLocalStorage must
// carry the runtime actor/workflow input through that reset so the planner/generator can
// repopulate the new session without exposing credentials to the model.
const generationSessionId = `${sessionId}-generation-reset`;
resetSession(generationSessionId);
runRequestContext({ sessionId: generationSessionId, testActors: rawActors, workflowRequirements: workflow }, () => {
  resetSession(generationSessionId); // mirrors progressiveGenerationCanonical /start
  const runtime = resolveRuntimeWorkflowContext();
  const regenerated = getSession(generationSessionId);
  assert.deepStrictEqual(runtime.actorCatalog, normalized.catalog);
  assert.deepStrictEqual(runtime.actorCredentialRefs, [
    'actor_requester',
    'actor_manager',
    'actor_approver',
  ]);
  assert.deepStrictEqual(regenerated.testActors, normalized.catalog);
  assert.strictEqual(regenerated.workflowRequirements, workflow);
  assert.strictEqual(Object.keys(regenerated.actorCredentials).length, 3);
  assertNoSecrets(runtime.workflowContext, secrets);
});

// Persistence mode is optional. DATABASE_ENABLED=false is a hard gate even when a
// DATABASE_URL exists; enabling persistence changes recoverability, not test semantics.
const dbOff = inspectDbMode(false, 'postgresql://should-not-be-used.invalid/test');
assert.deepStrictEqual(dbOff, { enabled: false, configured: false, required: false });
const dbOnConfigured = inspectDbMode(true, 'postgresql://configured.invalid/test');
assert.deepStrictEqual(dbOnConfigured, { enabled: true, configured: true, required: false });

console.log('multi-role actor/workflow persistence regression smoke: PASS');

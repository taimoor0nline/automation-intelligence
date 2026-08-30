const assert = require('assert');

const {
  normalizeActorProfiles,
  publicActorCatalog,
  actorCredentialStatus,
} = require('../server/services/testActorProfiles');
const { actorValidationErrors } = require('../server/services/canonicalTestIrV3');
const {
  generateCypressPreviewFromPlan,
  generateDeterministicAutomation,
} = require('../server/services/deterministicAutomationGeneratorV6');
const { validateGroundedScript } = require('../server/services/scriptValidator');
const { resetSession, hydrateSession } = require('../server/data/sessionStore');

function assertNoSecrets(value, secrets) {
  const serialized = JSON.stringify(value);
  for (const secret of secrets) {
    assert(!serialized.includes(secret), `Secret leaked into public artifact: ${secret}`);
  }
}

const rawActors = [
  { role: 'Requester', username: 'requester.qa', password: 'RequesterSecret!' },
  { role: 'Manager', username: 'manager.qa', password: 'ManagerSecret!' },
  { role: 'Approver', username: 'approver.qa', password: 'ApproverSecret!' },
];

const normalized = normalizeActorProfiles(rawActors);
assert.deepStrictEqual(normalized.catalog.map((actor) => actor.actorRef), [
  'actor_requester',
  'actor_manager',
  'actor_approver',
]);
assert.deepStrictEqual(normalized.catalog.map((actor) => actor.role), ['Requester', 'Manager', 'Approver']);
assert.strictEqual(Object.keys(normalized.credentials).length, 3);
assertNoSecrets(normalized.catalog, rawActors.flatMap((actor) => [actor.username, actor.password]));
assertNoSecrets(publicActorCatalog(rawActors), rawActors.flatMap((actor) => [actor.username, actor.password]));

const status = actorCredentialStatus(normalized.catalog, normalized.credentials);
assert(status.every((actor) => actor.credentialsConfigured === true));
assertNoSecrets(status, rawActors.flatMap((actor) => [actor.username, actor.password]));

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
assertNoSecrets(preview, rawActors.flatMap((actor) => [actor.username, actor.password]));
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
assertNoSecrets(generated.script, rawActors.flatMap((actor) => [actor.username, actor.password]));
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

const sessionId = `actor-smoke-${Date.now()}`;
resetSession(sessionId);
const hydrated = hydrateSession(sessionId, {
  state: 'AWAITING_APPROVAL',
  testActors: normalized.catalog,
  actorCredentials: normalized.credentials,
});
assert.deepStrictEqual(hydrated.testActors, normalized.catalog, 'Public actor catalog must survive PostgreSQL/session rehydration.');
assert.deepStrictEqual(hydrated.actorCredentials, {}, 'Role credentials must never be restored from persisted session state.');

console.log('multi-role actor regression smoke: PASS');

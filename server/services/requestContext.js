const { AsyncLocalStorage } = require('async_hooks');
const { getSession } = require('../data/sessionStore');
const { normalizeActorProfiles } = require('./testActorProfiles');
const { normalizeWorkflowRequirements } = require('./workflowRequirements');

const storage = new AsyncLocalStorage();

function middleware(req, _res, next) {
  const sessionId = String(req.body?.sessionId || req.params?.sessionId || req.query?.sessionId || '').trim() || null;
  const session = sessionId ? getSession(sessionId) : null;
  const hasTestActorsInput = Object.prototype.hasOwnProperty.call(req.body || {}, 'testActors');
  const hasWorkflowRequirementsInput = Object.prototype.hasOwnProperty.call(req.body || {}, 'workflowRequirements');
  const testActors = hasTestActorsInput && Array.isArray(req.body?.testActors)
    ? req.body.testActors.slice(0, 12).map((actor) => actor && typeof actor === 'object' ? { ...actor } : actor)
    : [];
  const workflowRequirements = hasWorkflowRequirementsInput
    ? normalizeWorkflowRequirements(req.body?.workflowRequirements)
    : null;

  // For normal requests, update the active session immediately. Generation/start
  // resets its session inside the route; the AsyncLocalStorage copy below survives
  // that reset and is re-applied during planning/canonical generation.
  if (session && hasTestActorsInput) {
    const normalized = normalizeActorProfiles(testActors);
    session.testActors = normalized.catalog;
    session.actorCredentials = normalized.credentials;
  }
  if (session && hasWorkflowRequirementsInput) session.workflowRequirements = workflowRequirements;

  storage.run({
    sessionId,
    user: req.user || null,
    projectId: session?.projectId || null,
    repositoryId: session?.repositoryId || null,
    // Runtime-only authoring input. It can include role credentials and therefore
    // must never be logged or persisted as request context metadata.
    hasTestActorsInput,
    testActors,
    hasWorkflowRequirementsInput,
    workflowRequirements,
  }, next);
}

function current() { return storage.getStore() || {}; }

module.exports = { middleware, current };

const { AsyncLocalStorage } = require('async_hooks');
const { getSession } = require('../data/sessionStore');
const { normalizeActorProfiles } = require('./testActorProfiles');
const actorRuntimeStore = require('./testActorRuntimeStore');
const { normalizeWorkflowRequirements } = require('./workflowRequirements');

const storage = new AsyncLocalStorage();

function middleware(req, _res, next) {
  const sessionId = String(req.body?.sessionId || req.params?.sessionId || req.query?.sessionId || '').trim() || null;
  const actorDirectorySessionId = String(req.body?.actorDirectorySessionId || req.headers?.['x-test-actor-directory-session'] || '').trim() || null;

  // The browser may prepare/import actors before the generation UI chooses its final
  // run session id. Copy that short-lived runtime state into the actual generation
  // session before any route reset occurs.
  if (sessionId && actorDirectorySessionId && actorDirectorySessionId !== sessionId) {
    actorRuntimeStore.copy(actorDirectorySessionId, sessionId);
  }

  const session = sessionId ? getSession(sessionId) : null;
  if (sessionId && session) actorRuntimeStore.applyToSession(sessionId, session);

  const hasTestActorsInput = Object.prototype.hasOwnProperty.call(req.body || {}, 'testActors');
  const hasWorkflowRequirementsInput = Object.prototype.hasOwnProperty.call(req.body || {}, 'workflowRequirements');
  let testActors = hasTestActorsInput && Array.isArray(req.body?.testActors)
    ? req.body.testActors.slice(0, 12).map((actor) => actor && typeof actor === 'object' ? { ...actor } : actor)
    : [];
  const workflowRequirements = hasWorkflowRequirementsInput
    ? normalizeWorkflowRequirements(req.body?.workflowRequirements)
    : null;

  // Imported XLSX/CSV credentials are kept in the runtime actor store rather than
  // posted repeatedly by the browser. Expose only the active actor profiles to the
  // AsyncLocalStorage generation context so a session reset cannot lose them.
  if (!hasTestActorsInput && sessionId) testActors = actorRuntimeStore.activeProfiles(sessionId);

  // For normal requests, update the active session immediately. Generation/start
  // resets its session inside the route; the AsyncLocalStorage copy below survives
  // that reset and is re-applied during planning/canonical generation.
  if (session && hasTestActorsInput) {
    const normalized = normalizeActorProfiles(testActors);
    session.testActors = normalized.catalog;
    session.actorCredentials = normalized.credentials;
    session.testActorActiveRefs = normalized.catalog.map((actor) => actor.actorRef);
    if (!session.testActorDirectory?.length) {
      session.testActorDirectory = normalized.catalog.map((actor) => ({ ...actor, enabled: true, source: 'MANUAL', sourceRow: null }));
      session.testActorDirectoryCredentials = { ...normalized.credentials };
    }
    actorRuntimeStore.setFromSession(sessionId, session);
  }
  if (session && hasWorkflowRequirementsInput) session.workflowRequirements = workflowRequirements;

  storage.run({
    sessionId,
    actorDirectorySessionId,
    user: req.user || null,
    projectId: session?.projectId || null,
    repositoryId: session?.repositoryId || null,
    // Runtime-only authoring input. It can include role credentials and therefore
    // must never be logged or persisted as request context metadata.
    hasTestActorsInput: hasTestActorsInput || testActors.length > 0,
    testActors,
    hasWorkflowRequirementsInput,
    workflowRequirements,
  }, next);
}

function current() { return storage.getStore() || {}; }

module.exports = { middleware, current };

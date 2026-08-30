const { AsyncLocalStorage } = require('async_hooks');
const { getSession } = require('../data/sessionStore');
const { normalizeActorProfiles } = require('./testActorProfiles');

const storage = new AsyncLocalStorage();

function middleware(req, _res, next) {
  const sessionId = String(req.body?.sessionId || req.params?.sessionId || req.query?.sessionId || '').trim() || null;
  const session = sessionId ? getSession(sessionId) : null;
  const testActors = Array.isArray(req.body?.testActors)
    ? req.body.testActors.slice(0, 12).map((actor) => actor && typeof actor === 'object' ? { ...actor } : actor)
    : null;

  // Normalize actor profiles into the active in-memory session before any long-running
  // async generation work is scheduled. The catalog is safe metadata; credentials stay
  // runtime-only in actorCredentials and are excluded by persistenceService.
  if (session && testActors) {
    const normalized = normalizeActorProfiles(testActors);
    session.testActors = normalized.catalog;
    session.actorCredentials = normalized.credentials;
  }

  storage.run({
    sessionId,
    user: req.user || null,
    projectId: session?.projectId || null,
    repositoryId: session?.repositoryId || null,
    // Runtime-only authoring input. It can include role credentials and therefore
    // must never be logged or persisted as request context metadata.
    testActors,
  }, next);
}

function current() { return storage.getStore() || {}; }

module.exports = { middleware, current };

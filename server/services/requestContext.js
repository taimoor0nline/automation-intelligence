const { AsyncLocalStorage } = require('async_hooks');
const { getSession } = require('../data/sessionStore');

const storage = new AsyncLocalStorage();

function middleware(req, _res, next) {
  const sessionId = String(req.body?.sessionId || req.params?.sessionId || req.query?.sessionId || '').trim() || null;
  const session = sessionId ? getSession(sessionId) : null;
  storage.run({
    sessionId,
    user: req.user || null,
    projectId: session?.projectId || null,
    repositoryId: session?.repositoryId || null,
  }, next);
}

function current() { return storage.getStore() || {}; }

module.exports = { middleware, current };

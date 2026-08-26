const persistence = require('../services/persistenceService');
const { getSession, hydrateSession, isHydrated, markHydrated } = require('../data/sessionStore');

function resolveSessionId(req) {
  return String(
    req.body?.sessionId ||
    req.params?.sessionId ||
    req.query?.sessionId ||
    ''
  ).trim();
}

async function sessionPersistence(req, res, next) {
  const sessionId = resolveSessionId(req);
  if (!sessionId || !persistence.enabled()) return next();

  try {
    if (!isHydrated(sessionId)) {
      const stored = await persistence.loadSession(sessionId);
      if (stored) hydrateSession(sessionId, stored);
      else markHydrated(sessionId);
    }
  } catch (err) {
    console.error('[session-persistence] rehydrate failed', err);
  }

  res.on('finish', () => {
    const session = getSession(sessionId);
    persistence.persistSession(sessionId, session, {
      projectId: session.projectId,
      repositoryId: session.repositoryId,
      userId: session.createdBy,
    }).then(() => persistence.persistTestCases(sessionId, session.testCases || []))
      .catch((err) => console.error('[session-persistence] save failed', err));
  });
  next();
}

module.exports = sessionPersistence;

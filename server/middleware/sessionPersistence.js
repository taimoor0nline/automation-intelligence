const persistence = require('../services/persistenceService');
const canonicalArtifacts = require('../services/canonicalArtifactStore');
const { getSession, hydrateSession, isHydrated, markHydrated } = require('../data/sessionStore');

function resolveSessionId(req) {
  return String(req.body?.sessionId || req.params?.sessionId || req.query?.sessionId || '').trim();
}

async function saveNormalizedRun(sessionId, session, userId) {
  const last = session.lastResults;
  if (!last?.summary || !last?.runNumber) return;
  const runId = await persistence.persistRun({
    sessionId,
    session,
    runNumber: last.runNumber,
    summary: last.summary,
    approvedIds: session.approvedIds || [],
    userId: userId || session.createdBy || null,
  });
  if (runId && Array.isArray(session.failureAnalyses) && session.failureAnalyses.length) {
    await persistence.persistAnalyses(runId, session.failureAnalyses);
  }
}

async function sessionPersistence(req, res, next) {
  const sessionId = resolveSessionId(req);
  if (!sessionId || !persistence.enabled()) return next();

  try {
    if (!isHydrated(sessionId)) {
      const stored = await persistence.loadSession(sessionId);
      const session = stored ? hydrateSession(sessionId, stored) : getSession(sessionId);
      if (!stored) markHydrated(sessionId);
      try {
        const artifacts = await canonicalArtifacts.load(sessionId);
        canonicalArtifacts.applyLoadedArtifacts(session, artifacts);
      } catch (err) {
        // Older DBs can continue to run before migration 011 is applied; canonical
        // artifacts are still available in memory for the active process.
        console.error('[session-persistence] canonical artifact rehydrate skipped', err.message);
      }
    }
  } catch (err) {
    console.error('[session-persistence] rehydrate failed', err);
  }

  const requestUserId = req.user?.sub || null;
  res.on('finish', () => {
    const session = getSession(sessionId);
    if (!session.createdBy && requestUserId) session.createdBy = requestUserId;
    persistence.persistSession(sessionId, session, {
      projectId: session.projectId,
      repositoryId: session.repositoryId,
      userId: session.createdBy || requestUserId,
    })
      .then(() => persistence.persistTestCases(sessionId, session.testCases || []))
      .then(async () => {
        try { await canonicalArtifacts.persistAll(sessionId, session); }
        catch (err) { console.error('[session-persistence] canonical artifact save skipped', err.message); }
      })
      .then(() => saveNormalizedRun(sessionId, session, requestUserId))
      .catch((err) => console.error('[session-persistence] save failed', err));
  });
  next();
}

module.exports = sessionPersistence;

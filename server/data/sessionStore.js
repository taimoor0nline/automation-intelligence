const sessions = new Map();
const hydrated = new Set();

function createSession() {
  return {
    state: "IDLE",
    story: null,
    targetUrl: null,
    environment: null,
    additionalPaths: [],
    aiModelTier: "strong",
    credentials: null,
    projectId: null,
    repositoryId: null,
    createdBy: null,
    pageDiscoveries: [],
    testCases: [],
    automationReadiness: null,
    readinessValidated: false,
    approvedIds: [],
    generatedScript: null,
    lastResults: null,
    runHistory: [],
    failureAnalyses: [],
    artifacts: null,
    reportHtml: null,
  };
}

function getSession(id) {
  if (!sessions.has(id)) sessions.set(id, createSession());
  return sessions.get(id);
}

function hydrateSession(id, persisted) {
  if (!persisted || typeof persisted !== 'object') {
    hydrated.add(id);
    return getSession(id);
  }
  const existing = getSession(id);
  Object.assign(existing, createSession(), persisted);
  // Credentials and local artifact paths are intentionally never restored from PostgreSQL.
  existing.credentials = null;
  existing.artifacts = null;
  existing.reportHtml = null;
  hydrated.add(id);
  return existing;
}

function isHydrated(id) { return hydrated.has(id); }
function markHydrated(id) { hydrated.add(id); }

function resetSession(id) {
  sessions.delete(id);
  hydrated.delete(id);
  return getSession(id);
}

module.exports = { getSession, resetSession, hydrateSession, isHydrated, markHydrated };

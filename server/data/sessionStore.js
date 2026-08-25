/**
 * In-memory demo session store.
 * Nothing is persisted to a database. Restarting the Node process clears runs.
 */
const sessions = new Map();

function createSession() {
  return {
    state: "IDLE",
    story: null,
    targetUrl: null,
    environment: null,
    additionalPaths: [],
    aiModelTier: "strong",
    credentials: null,
    pageDiscoveries: [],
    testCases: [],
    approvedIds: [],
    generatedScript: null,
    lastResults: null,
    failureAnalyses: [],
    artifacts: null,
    reportHtml: null,
  };
}

function getSession(id) {
  if (!sessions.has(id)) sessions.set(id, createSession());
  return sessions.get(id);
}

function resetSession(id) {
  sessions.delete(id);
  return getSession(id);
}

module.exports = { getSession, resetSession };

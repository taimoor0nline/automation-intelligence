/**
 * In-memory session store (PoC only — swap for Redis/DB in production).
 * Tracks the chat-driven pipeline state per session:
 * IDLE -> AWAITING_APPROVAL -> RUNNING -> DONE
 */
const sessions = new Map();

function getSession(id) {
  if (!sessions.has(id)) {
    sessions.set(id, {
      state: "IDLE",
      story: null,
      targetUrl: null,
      pageDiscovery: null,
      testCases: [],
      approvedIds: [],
      generatedScript: null,
      lastResults: null,
    });
  }
  return sessions.get(id);
}

function resetSession(id) {
  sessions.delete(id);
  return getSession(id);
}

module.exports = { getSession, resetSession };

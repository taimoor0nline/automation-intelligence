const sessions = new Map();
const hydrated = new Set();

function createSession() {
  return {
    state: "IDLE",
    targetType: "WEB",
    story: null,
    workflowRequirements: "",
    targetUrl: null,
    environment: null,
    additionalPaths: [],
    aiModelTier: "strong",
    credentials: null,
    // Active actors are the small scenario-specific subset exposed to Canonical IR.
    testActors: [],
    actorCredentials: {},
    // The actor directory can contain many imported accounts. Only public metadata
    // and active refs may be persisted; directory credentials are runtime-only.
    testActorDirectory: [],
    testActorActiveRefs: [],
    testActorDirectoryCredentials: {},
    apiAuth: null,
    apiTargetId: null,
    apiOperationIds: [],
    apiOperations: [],
    projectId: null,
    repositoryId: null,
    createdBy: null,
    pageDiscoveries: [],
    canonicalElementRegistry: null,
    canonicalGenerationPlan: null,
    canonicalArchitectureVersion: 1,
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
  // Browser credentials, actor/directory credentials, REST authentication secrets and
  // local artifact paths are intentionally never restored from PostgreSQL.
  existing.credentials = null;
  existing.actorCredentials = {};
  existing.testActorDirectoryCredentials = {};
  existing.apiAuth = null;
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
  const session = getSession(id);
  // Generation intentionally resets ordinary run state. Imported actor credentials are
  // held in a separate short-lived runtime store so that reset does not erase the actor
  // directory the user just prepared. The lazy require avoids a module-cycle at startup.
  try { require('../services/testActorRuntimeStore').applyToSession(id, session); } catch {}
  return session;
}

module.exports = { getSession, resetSession, hydrateSession, isHydrated, markHydrated };

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
    testActors: [],
    actorCredentials: {},
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
    // Reusable application/page/form/field/test behavior rules. In session-only mode
    // this is the authoritative in-memory registry; DB mode persists the same model.
    behaviorRules: [],
    behaviorRuleConflicts: [],
    behaviorRuleRegistryVersion: 1,
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
  const previous = sessions.get(id) || null;
  sessions.delete(id);
  hydrated.delete(id);
  const session = getSession(id);
  // Shared rules are application knowledge and must survive test-generation iterations.
  // They are copied into the new run session even when PostgreSQL is disabled.
  if (previous) {
    session.behaviorRules = Array.isArray(previous.behaviorRules) ? previous.behaviorRules.map((rule) => ({ ...rule })) : [];
    session.behaviorRuleConflicts = Array.isArray(previous.behaviorRuleConflicts) ? previous.behaviorRuleConflicts.map((item) => ({ ...item })) : [];
    session.behaviorRuleRegistryVersion = previous.behaviorRuleRegistryVersion || 1;
  }
  try { require('../services/testActorRuntimeStore').applyToSession(id, session); } catch {}
  return session;
}

module.exports = { getSession, resetSession, hydrateSession, isHydrated, markHydrated };

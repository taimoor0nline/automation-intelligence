const requestContext = require('./requestContext');
const { getSession } = require('../data/sessionStore');
const { normalizeActorProfiles, publicActorCatalog } = require('./testActorProfiles');
const { normalizeWorkflowRequirements, workflowContextForModel } = require('./workflowRequirements');

function configuredActorRefsFromMap(value = {}) {
  return Object.entries(value && typeof value === 'object' ? value : {})
    .filter(([, credentials]) => credentials?.username && credentials?.password)
    .map(([actorRef]) => String(actorRef));
}

function uniqueStrings(value = []) {
  return [...new Set((Array.isArray(value) ? value : []).map(String).map((item) => item.trim()).filter(Boolean))];
}

function resolveRuntimeWorkflowContext({
  sessionId = null,
  actorCatalog = [],
  actorCredentialRefs = [],
  workflowRequirements = null,
} = {}) {
  const current = requestContext.current();
  const resolvedSessionId = String(sessionId || current.sessionId || '').trim() || null;
  const session = resolvedSessionId ? getSession(resolvedSessionId) : null;

  let safeActors = publicActorCatalog(actorCatalog);
  let configuredActorRefs = uniqueStrings(actorCredentialRefs);
  let requirements = normalizeWorkflowRequirements(workflowRequirements);

  if (!safeActors.length && session?.testActors?.length) safeActors = publicActorCatalog(session.testActors);
  if (!configuredActorRefs.length && session?.actorCredentials) configuredActorRefs = configuredActorRefsFromMap(session.actorCredentials);
  if (!requirements && session?.workflowRequirements) requirements = normalizeWorkflowRequirements(session.workflowRequirements);

  // Request actor input intentionally remains runtime-only. It is useful both for
  // a new generation request (whose route resets the session after middleware) and
  // for re-binding credentials after a PostgreSQL rehydration.
  if (current.hasTestActorsInput) {
    const normalized = normalizeActorProfiles(current.testActors || []);
    safeActors = normalized.catalog;
    configuredActorRefs = configuredActorRefsFromMap(normalized.credentials);
    if (session) {
      session.testActors = normalized.catalog;
      session.actorCredentials = normalized.credentials;
    }
  }

  if (current.hasWorkflowRequirementsInput) {
    requirements = normalizeWorkflowRequirements(current.workflowRequirements);
    if (session) session.workflowRequirements = requirements;
  }

  if (session) {
    if (!Array.isArray(session.testActors)) session.testActors = safeActors;
    if (session.workflowRequirements == null) session.workflowRequirements = requirements;
  }

  const availableActors = safeActors.filter((actor) => configuredActorRefs.includes(actor.actorRef));
  return {
    sessionId: resolvedSessionId,
    session,
    actorCatalog: safeActors,
    availableActors,
    actorCredentialRefs: configuredActorRefs,
    workflowRequirements: requirements,
    workflowContext: workflowContextForModel(requirements, safeActors),
  };
}

module.exports = {
  configuredActorRefsFromMap,
  resolveRuntimeWorkflowContext,
};

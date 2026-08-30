const { publicActorCatalog } = require('./testActorProfiles');

const states = new Map();
const TTL_MS = 8 * 60 * 60 * 1000;

function cloneCredentials(value = {}) {
  const out = {};
  for (const [actorRef, credentials] of Object.entries(value || {})) {
    const username = String(credentials?.username || '');
    const password = String(credentials?.password || '');
    if (actorRef && (username || password)) out[String(actorRef)] = { username, password };
  }
  return out;
}

function publicDirectory(value = []) {
  return (Array.isArray(value) ? value : []).slice(0, 500).map((actor) => ({
    actorRef: String(actor?.actorRef || '').trim().slice(0, 80),
    role: String(actor?.role || '').trim().slice(0, 80),
    displayName: String(actor?.displayName || actor?.role || '').trim().slice(0, 100),
    description: String(actor?.description || '').trim().slice(0, 300) || null,
    enabled: actor?.enabled !== false,
    source: String(actor?.source || '').trim().slice(0, 40) || null,
    sourceRow: Number.isFinite(Number(actor?.sourceRow)) ? Number(actor.sourceRow) : null,
  })).filter((actor) => actor.actorRef && actor.role);
}

function trimExpired() {
  const now = Date.now();
  for (const [sessionId, state] of states.entries()) {
    if (now - state.updatedAt > TTL_MS) states.delete(sessionId);
  }
}

function set(sessionId, {
  directory = [],
  directoryCredentials = {},
  activeRefs = [],
  activeCatalog = [],
  activeCredentials = {},
} = {}) {
  const id = String(sessionId || '').trim();
  if (!id) return null;
  trimExpired();
  const normalizedDirectory = publicDirectory(directory);
  const directoryRefSet = new Set(normalizedDirectory.map((actor) => actor.actorRef));
  const refs = [...new Set((Array.isArray(activeRefs) ? activeRefs : []).map(String).filter((ref) => !directoryRefSet.size || directoryRefSet.has(ref)))].slice(0, 12);
  const state = {
    directory: normalizedDirectory,
    directoryCredentials: cloneCredentials(directoryCredentials),
    activeRefs: refs,
    activeCatalog: publicActorCatalog(activeCatalog || []).slice(0, 12),
    activeCredentials: cloneCredentials(activeCredentials),
    updatedAt: Date.now(),
  };
  states.set(id, state);
  return state;
}

function get(sessionId) {
  trimExpired();
  return states.get(String(sessionId || '').trim()) || null;
}

function setFromSession(sessionId, session = {}) {
  return set(sessionId, {
    directory: session.testActorDirectory || [],
    directoryCredentials: session.testActorDirectoryCredentials || {},
    activeRefs: session.testActorActiveRefs || [],
    activeCatalog: session.testActors || [],
    activeCredentials: session.actorCredentials || {},
  });
}

function applyToSession(sessionId, session) {
  const state = get(sessionId);
  if (!state || !session) return false;
  session.testActorDirectory = state.directory.map((actor) => ({ ...actor }));
  session.testActorDirectoryCredentials = cloneCredentials(state.directoryCredentials);
  session.testActorActiveRefs = [...state.activeRefs];
  session.testActors = state.activeCatalog.map((actor) => ({ ...actor }));
  session.actorCredentials = cloneCredentials(state.activeCredentials);
  return true;
}

function activeProfiles(sessionId) {
  const state = get(sessionId);
  if (!state) return [];
  return state.activeCatalog.map((actor) => ({
    ...actor,
    username: state.activeCredentials?.[actor.actorRef]?.username || '',
    password: state.activeCredentials?.[actor.actorRef]?.password || '',
  }));
}

function clear(sessionId) {
  states.delete(String(sessionId || '').trim());
}

module.exports = { set, get, setFromSession, applyToSession, activeProfiles, clear };

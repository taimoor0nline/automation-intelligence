const MAX_ACTORS = 12;

function clean(value, max = 160) {
  return String(value ?? '').trim().slice(0, max);
}

function slug(value, fallback = 'actor') {
  const normalized = clean(value, 100)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return normalized || fallback;
}

function normalizeActorProfiles(input = []) {
  const raw = Array.isArray(input) ? input.slice(0, MAX_ACTORS) : [];
  const catalog = [];
  const credentials = {};
  const used = new Set();

  for (let index = 0; index < raw.length; index += 1) {
    const item = raw[index] && typeof raw[index] === 'object' ? raw[index] : {};
    const role = clean(item.role || item.displayName || `Role ${index + 1}`, 80);
    if (!role) continue;

    let actorRef = slug(item.actorRef || role || `actor_${index + 1}`, `actor_${index + 1}`);
    if (!actorRef.startsWith('actor_')) actorRef = `actor_${actorRef}`;
    const base = actorRef;
    let suffix = 2;
    while (used.has(actorRef)) actorRef = `${base}_${suffix++}`;
    used.add(actorRef);

    const displayName = clean(item.displayName || role, 100) || role;
    const description = clean(item.description, 300) || null;
    catalog.push({ actorRef, role, displayName, description });

    const username = String(item.username || '');
    const password = String(item.password || '');
    if (username || password) credentials[actorRef] = { username, password };
  }

  return { catalog, credentials };
}

function publicActorCatalog(value) {
  const source = Array.isArray(value) ? value : [];
  return source.slice(0, MAX_ACTORS).map((item) => ({
    actorRef: clean(item?.actorRef, 80),
    role: clean(item?.role, 80),
    displayName: clean(item?.displayName || item?.role, 100),
    description: clean(item?.description, 300) || null,
  })).filter((item) => item.actorRef && item.role);
}

function actorCredentialStatus(catalog = [], credentialMap = {}) {
  return publicActorCatalog(catalog).map((actor) => {
    const credentials = credentialMap?.[actor.actorRef] || {};
    return {
      ...actor,
      credentialsConfigured: Boolean(credentials.username && credentials.password),
    };
  });
}

function hasActorCredentials(credentialMap = {}, actorRef) {
  const item = credentialMap?.[String(actorRef || '')] || {};
  return Boolean(item.username && item.password);
}

function actorRefs(catalog = []) {
  return new Set(publicActorCatalog(catalog).map((actor) => actor.actorRef));
}

module.exports = {
  MAX_ACTORS,
  normalizeActorProfiles,
  publicActorCatalog,
  actorCredentialStatus,
  hasActorCredentials,
  actorRefs,
};

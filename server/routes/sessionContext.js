const express = require('express');
const router = express.Router();
const db = require('../db');
const { getSession } = require('../data/sessionStore');
const { requireAuth, requireRole } = require('../services/authService');
const persistence = require('../services/persistenceService');
const { MAX_ACTORS, normalizeActorProfiles, publicActorCatalog, actorCredentialStatus } = require('../services/testActorProfiles');
const { parseImport, publicPreview, buildDirectoryState } = require('../services/testActorImportService');
const { assessTestCases, readinessSummary } = require('../services/testCaseFeasibility');

function allowQaManager(req, res, next) {
  // AUTH_REQUIRED=false is a supported demo/standalone mode. In authenticated mode
  // the global API middleware has already required a valid user before this router.
  if (!req.user) return next();
  const role = String(req.user.role || '').toUpperCase();
  if (!['QA','MANAGER'].includes(role)) return res.status(403).json({ reply: 'QA or MANAGER role is required for test actor management.' });
  next();
}

function configuredActorRefs(session) {
  return Object.entries(session.actorCredentials || {})
    .filter(([, credentials]) => credentials?.username && credentials?.password)
    .map(([actorRef]) => actorRef);
}

function directoryCredentialRefs(session) {
  return new Set(Object.entries(session.testActorDirectoryCredentials || {})
    .filter(([, credentials]) => credentials?.username && credentials?.password)
    .map(([actorRef]) => actorRef));
}

function directoryStatus(session) {
  const active = new Set(Array.isArray(session.testActorActiveRefs) ? session.testActorActiveRefs : []);
  const configured = directoryCredentialRefs(session);
  return (Array.isArray(session.testActorDirectory) ? session.testActorDirectory : []).map((actor) => ({
    actorRef: actor.actorRef,
    role: actor.role,
    displayName: actor.displayName || actor.role,
    description: actor.description || null,
    enabled: actor.enabled !== false,
    source: actor.source || null,
    sourceRow: actor.sourceRow || null,
    active: active.has(actor.actorRef),
    credentialsConfigured: configured.has(actor.actorRef),
  }));
}

function reassess(session) {
  if (!Array.isArray(session.testCases) || !session.testCases.length) return;
  session.testCases = assessTestCases(session.testCases, {
    pageDiscoveries: session.pageDiscoveries || [],
    hasCredentials: Boolean(session.credentials?.username && session.credentials?.password),
    actorCatalog: session.testActors || [],
    actorCredentialRefs: configuredActorRefs(session),
  });
  session.automationReadiness = readinessSummary(session.testCases);
  session.readinessValidated = session.testCases.every((tc) => Boolean(tc?.automationReadiness));
}

async function persistActorState(sessionId, session, userId = null) {
  await persistence.persistSession(sessionId, session, {
    projectId: session.projectId,
    repositoryId: session.repositoryId,
    userId: userId || session.createdBy || null,
  });
  await persistence.persistTestCases(sessionId, session.testCases || []);
}

function actorInputForUpdate(session, body = {}) {
  if (Array.isArray(body.testActors)) return body.testActors;
  const credentials = body.actorCredentials && typeof body.actorCredentials === 'object' && !Array.isArray(body.actorCredentials)
    ? body.actorCredentials
    : null;
  if (!credentials) return [];
  return publicActorCatalog(session.testActors || []).map((actor) => ({
    ...actor,
    username: credentials?.[actor.actorRef]?.username || '',
    password: credentials?.[actor.actorRef]?.password || '',
  }));
}

function activateDirectoryActors(session, requestedRefs = []) {
  const directory = Array.isArray(session.testActorDirectory) ? session.testActorDirectory : [];
  const byRef = new Map(directory.filter((actor) => actor?.actorRef && actor.enabled !== false).map((actor) => [actor.actorRef, actor]));
  const refs = [...new Set((Array.isArray(requestedRefs) ? requestedRefs : []).map(String).filter((ref) => byRef.has(ref)))];
  if (!refs.length && directory.length) throw new Error('Select at least one enabled actor from the directory.');
  if (refs.length > MAX_ACTORS) throw new Error(`A maximum of ${MAX_ACTORS} active actors can be exposed to one scenario.`);
  session.testActorActiveRefs = refs;
  session.testActors = refs.map((ref) => byRef.get(ref)).filter(Boolean).map(({ enabled, source, sourceRow, ...actor }) => actor);
  const directoryCredentials = session.testActorDirectoryCredentials || {};
  session.actorCredentials = Object.fromEntries(refs.filter((ref) => directoryCredentials[ref]).map((ref) => [ref, directoryCredentials[ref]]));
}

router.get('/api/sessions/:sessionId/context', requireAuth, (req, res) => {
  const session = getSession(req.params.sessionId);
  res.json({ ok: true, projectId: session.projectId || null, repositoryId: session.repositoryId || null, createdBy: session.createdBy || null });
});

router.post('/api/sessions/:sessionId/context', requireAuth, requireRole('QA','MANAGER'), async (req, res) => {
  try {
    const projectId = String(req.body?.projectId || '').trim();
    const repositoryId = String(req.body?.repositoryId || '').trim();
    if (!projectId) return res.status(400).json({ reply: 'projectId is required.' });

    const project = await db.query('select id from projects where id=$1', [projectId]);
    if (!project.rowCount) return res.status(404).json({ reply: 'Project not found.' });

    if (repositoryId) {
      const repository = await db.query('select id from source_repositories where id=$1 and project_id=$2 and source_enabled=true', [repositoryId, projectId]);
      if (!repository.rowCount) return res.status(400).json({ reply: 'Repository does not belong to this project or is disabled.' });
    }

    const session = getSession(req.params.sessionId);
    session.projectId = projectId;
    session.repositoryId = repositoryId || null;
    session.createdBy = req.user.sub;
    await persistence.persistSession(req.params.sessionId, session, { projectId, repositoryId: repositoryId || null, userId: req.user.sub });
    res.json({ ok: true, projectId, repositoryId: repositoryId || null });
  } catch (err) {
    res.status(500).json({ reply: err.message });
  }
});

router.get('/api/sessions/:sessionId/test-actors', allowQaManager, (req, res) => {
  const session = getSession(req.params.sessionId);
  return res.json({
    ok: true,
    actors: actorCredentialStatus(session.testActors || [], session.actorCredentials || {}),
    directoryCount: Array.isArray(session.testActorDirectory) ? session.testActorDirectory.length : 0,
    credentialsPersisted: false,
    credentialPolicy: 'Runtime actor credentials are never persisted. Re-enter credentials or re-import the credential file after rehydration before executing role-based cases.',
    automationReadiness: session.automationReadiness || null,
  });
});

router.post('/api/sessions/:sessionId/test-actors', allowQaManager, async (req, res) => {
  const sessionId = req.params.sessionId;
  const session = getSession(sessionId);
  try {
    const input = actorInputForUpdate(session, req.body || {});
    if (!input.length) {
      return res.status(400).json({
        reply: 'Provide testActors, or provide actorCredentials for the already configured active actor catalog.',
        actors: actorCredentialStatus(session.testActors || [], session.actorCredentials || {}),
      });
    }

    const normalized = normalizeActorProfiles(input);
    if (!normalized.catalog.length) return res.status(400).json({ reply: 'At least one valid role actor is required.' });

    session.testActors = normalized.catalog;
    session.actorCredentials = normalized.credentials;
    session.testActorActiveRefs = normalized.catalog.map((actor) => actor.actorRef);

    // Manual actor configuration also becomes a small directory. If a larger imported
    // directory already exists, merge fresh runtime credentials into it without deleting it.
    if (!Array.isArray(session.testActorDirectory) || !session.testActorDirectory.length) {
      session.testActorDirectory = normalized.catalog.map((actor) => ({ ...actor, enabled: true, source: 'MANUAL', sourceRow: null }));
      session.testActorDirectoryCredentials = { ...normalized.credentials };
    } else {
      session.testActorDirectoryCredentials = { ...(session.testActorDirectoryCredentials || {}), ...normalized.credentials };
    }

    reassess(session);
    await persistActorState(sessionId, session, req.user?.sub || null);

    return res.json({
      ok: true,
      actors: actorCredentialStatus(session.testActors, session.actorCredentials),
      credentialsPersisted: false,
      automationReadiness: session.automationReadiness || null,
      readinessValidated: Boolean(session.readinessValidated),
    });
  } catch (err) {
    return res.status(422).json({ reply: err.message });
  }
});

router.get('/api/sessions/:sessionId/test-actor-directory', allowQaManager, (req, res) => {
  const session = getSession(req.params.sessionId);
  return res.json({
    ok: true,
    directory: directoryStatus(session),
    activeActorRefs: Array.isArray(session.testActorActiveRefs) ? session.testActorActiveRefs : [],
    maxActiveActors: MAX_ACTORS,
    credentialsPersisted: false,
  });
});

router.post('/api/sessions/:sessionId/test-actor-directory/import/preview', allowQaManager, (req, res) => {
  try {
    const parsed = parseImport({ fileName: req.body?.fileName, contentBase64: req.body?.contentBase64 });
    return res.json({ ok: true, preview: publicPreview(parsed) });
  } catch (err) {
    return res.status(422).json({ reply: err.message });
  }
});

router.post('/api/sessions/:sessionId/test-actor-directory/import/apply', allowQaManager, async (req, res) => {
  const sessionId = req.params.sessionId;
  const session = getSession(sessionId);
  try {
    const parsed = parseImport({ fileName: req.body?.fileName, contentBase64: req.body?.contentBase64 });
    if (!parsed.summary.validRows) return res.status(422).json({ reply: 'The actor file does not contain any valid rows.', preview: publicPreview(parsed) });
    if (parsed.summary.invalidRows && req.body?.importValidOnly !== true) {
      return res.status(422).json({
        reply: `${parsed.summary.invalidRows} invalid row(s) must be corrected, or choose Import valid rows only.`,
        preview: publicPreview(parsed),
      });
    }

    const state = buildDirectoryState(parsed, req.body?.activeActorRefs);
    session.testActorDirectory = state.publicDirectory;
    session.testActorDirectoryCredentials = state.credentialMap;
    session.testActorActiveRefs = state.activeRefs;
    session.testActors = state.activeCatalog;
    session.actorCredentials = state.activeCredentials;
    reassess(session);
    await persistActorState(sessionId, session, req.user?.sub || null);

    return res.json({
      ok: true,
      imported: parsed.summary.validRows,
      invalidSkipped: parsed.summary.invalidRows,
      directory: directoryStatus(session),
      activeActorRefs: session.testActorActiveRefs,
      actors: actorCredentialStatus(session.testActors, session.actorCredentials),
      credentialsPersisted: false,
      automationReadiness: session.automationReadiness || null,
      readinessValidated: Boolean(session.readinessValidated),
    });
  } catch (err) {
    return res.status(422).json({ reply: err.message });
  }
});

router.post('/api/sessions/:sessionId/test-actor-directory/activate', allowQaManager, async (req, res) => {
  const sessionId = req.params.sessionId;
  const session = getSession(sessionId);
  try {
    activateDirectoryActors(session, req.body?.actorRefs || []);
    reassess(session);
    await persistActorState(sessionId, session, req.user?.sub || null);
    return res.json({
      ok: true,
      directory: directoryStatus(session),
      activeActorRefs: session.testActorActiveRefs,
      actors: actorCredentialStatus(session.testActors, session.actorCredentials),
      automationReadiness: session.automationReadiness || null,
      readinessValidated: Boolean(session.readinessValidated),
    });
  } catch (err) {
    return res.status(422).json({ reply: err.message });
  }
});

// Progressive generation is part of the platform route stack. Mount it here so
// /api/generation/start and its SSE endpoint are always registered by server/index.js.
router.use(require('./progressiveGeneration'));

// Historical reporting is mounted here because this router is already part of
// the authenticated platform route stack. The reporting module performs its own
// role-aware SQL scoping for MANAGER, QA and DEV viewers.
router.use(require('./reporting'));

module.exports = router;

const express = require('express');
const router = express.Router();
const db = require('../db');
const { getSession } = require('../data/sessionStore');
const { requireAuth, requireRole } = require('../services/authService');
const persistence = require('../services/persistenceService');
const { normalizeActorProfiles, publicActorCatalog, actorCredentialStatus } = require('../services/testActorProfiles');
const { assessTestCases, readinessSummary } = require('../services/testCaseFeasibility');

function configuredActorRefs(session) {
  return Object.entries(session.actorCredentials || {})
    .filter(([, credentials]) => credentials?.username && credentials?.password)
    .map(([actorRef]) => actorRef);
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

router.get('/api/sessions/:sessionId/test-actors', requireAuth, (req, res) => {
  const session = getSession(req.params.sessionId);
  return res.json({
    ok: true,
    actors: actorCredentialStatus(session.testActors || [], session.actorCredentials || {}),
    credentialsPersisted: false,
    credentialPolicy: 'Runtime actor credentials are never persisted. Re-enter credentials after server/session rehydration before executing role-based cases.',
    automationReadiness: session.automationReadiness || null,
  });
});

router.post('/api/sessions/:sessionId/test-actors', requireAuth, requireRole('QA','MANAGER'), async (req, res) => {
  const sessionId = req.params.sessionId;
  const session = getSession(sessionId);
  try {
    const input = actorInputForUpdate(session, req.body || {});
    if (!input.length) {
      return res.status(400).json({
        reply: 'Provide testActors, or provide actorCredentials for the already persisted actor catalog.',
        actors: actorCredentialStatus(session.testActors || [], session.actorCredentials || {}),
      });
    }

    const normalized = normalizeActorProfiles(input);
    if (!normalized.catalog.length) return res.status(400).json({ reply: 'At least one valid role actor is required.' });

    session.testActors = normalized.catalog;
    session.actorCredentials = normalized.credentials;
    const actorCredentialRefs = configuredActorRefs(session);

    if (Array.isArray(session.testCases) && session.testCases.length) {
      session.testCases = assessTestCases(session.testCases, {
        pageDiscoveries: session.pageDiscoveries || [],
        hasCredentials: Boolean(session.credentials?.username && session.credentials?.password),
        actorCatalog: session.testActors,
        actorCredentialRefs,
      });
      session.automationReadiness = readinessSummary(session.testCases);
      session.readinessValidated = session.testCases.every((tc) => Boolean(tc?.automationReadiness));
    }

    await persistence.persistSession(sessionId, session, {
      projectId: session.projectId,
      repositoryId: session.repositoryId,
      userId: req.user.sub || session.createdBy || null,
    });
    await persistence.persistTestCases(sessionId, session.testCases || []);

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

// Progressive generation is part of the platform route stack. Mount it here so
// /api/generation/start and its SSE endpoint are always registered by server/index.js.
router.use(require('./progressiveGeneration'));

// Historical reporting is mounted here because this router is already part of
// the authenticated platform route stack. The reporting module performs its own
// role-aware SQL scoping for MANAGER, QA and DEV viewers.
router.use(require('./reporting'));

module.exports = router;

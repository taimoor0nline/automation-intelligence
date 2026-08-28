const express = require('express');
const router = express.Router();
const db = require('../db');
const { getSession } = require('../data/sessionStore');
const { requireAuth, requireRole } = require('../services/authService');
const persistence = require('../services/persistenceService');

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

// Historical reporting is mounted here because this router is already part of
// the authenticated platform route stack. The reporting module performs its own
// role-aware SQL scoping for MANAGER, QA and DEV viewers.
router.use(require('./reporting'));

module.exports = router;

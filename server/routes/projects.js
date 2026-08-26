const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('../services/authService');

router.get('/api/projects', requireAuth, async (req, res) => {
  try {
    const role = String(req.user.role || '').toUpperCase();
    const result = ['QA','MANAGER'].includes(role)
      ? await db.query(`select p.*, u.display_name as created_by_name from projects p left join users u on u.id=p.created_by order by p.created_at desc`)
      : await db.query(`select distinct p.* from projects p left join project_members pm on pm.project_id=p.id left join test_runs tr on tr.project_id=p.id left join defect_analyses da on da.run_id=tr.id where pm.user_id=$1 or da.assigned_to=$1 order by p.created_at desc`, [req.user.sub]);
    res.json({ ok: true, projects: result.rows });
  } catch (err) { res.status(500).json({ reply: err.message }); }
});

router.post('/api/projects', requireAuth, requireRole('MANAGER'), async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ reply: 'Project name is required.' });
    const result = await db.query(`insert into projects(name,description,created_by) values($1,$2,$3) returning *`, [name, String(req.body?.description || '').trim() || null, req.user.sub]);
    await db.query(`insert into project_members(project_id,user_id,role) values($1,$2,'MANAGER') on conflict do nothing`, [result.rows[0].id, req.user.sub]);
    res.status(201).json({ ok: true, project: result.rows[0] });
  } catch (err) { res.status(500).json({ reply: err.message }); }
});

router.post('/api/projects/:projectId/members', requireAuth, requireRole('MANAGER'), async (req, res) => {
  try {
    const role = String(req.body?.role || '').toUpperCase();
    if (!['DEV','QA','MANAGER'].includes(role)) return res.status(400).json({ reply: 'Role must be DEV, QA, or MANAGER.' });
    await db.query(`insert into project_members(project_id,user_id,role) values($1,$2,$3) on conflict(project_id,user_id) do update set role=excluded.role`, [req.params.projectId, req.body?.userId, role]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ reply: err.message }); }
});

router.get('/api/developers', requireAuth, requireRole('QA','MANAGER'), async (_req, res) => {
  try {
    const result = await db.query(`select id,email,display_name as "displayName" from users where role='DEV' and is_active=true order by display_name,email`);
    res.json({ ok: true, developers: result.rows });
  } catch (err) { res.status(500).json({ reply: err.message }); }
});

router.get('/api/projects/:projectId/repositories', requireAuth, async (req, res) => {
  try {
    const result = await db.query(`select * from source_repositories where project_id=$1 order by created_at desc`, [req.params.projectId]);
    res.json({ ok: true, repositories: result.rows });
  } catch (err) { res.status(500).json({ reply: err.message }); }
});

router.post('/api/projects/:projectId/repositories', requireAuth, requireRole('QA','MANAGER'), async (req, res) => {
  try {
    const repo = String(req.body?.repoFullName || '').trim();
    if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) return res.status(400).json({ reply: 'Repository must use owner/name format.' });
    const branch = String(req.body?.defaultBranch || 'main').trim() || 'main';
    const repositoryUrl = String(req.body?.repositoryUrl || `https://github.com/${repo}`).trim();
    const result = await db.query(
      `insert into source_repositories(project_id,repo_full_name,default_branch,repository_url,created_by)
       values($1,$2,$3,$4,$5)
       on conflict(project_id,repo_full_name) do update set default_branch=excluded.default_branch,repository_url=excluded.repository_url,source_enabled=true,updated_at=now()
       returning *`,
      [req.params.projectId, repo, branch, repositoryUrl, req.user.sub]
    );
    res.status(201).json({ ok: true, repository: result.rows[0] });
  } catch (err) { res.status(500).json({ reply: err.message }); }
});

router.get('/api/projects/:projectId/defects', requireAuth, async (req, res) => {
  try {
    const params = [req.params.projectId];
    let where = 'tr.project_id=$1';
    if (String(req.user.role).toUpperCase() === 'DEV') {
      params.push(req.user.sub);
      where += ` and da.assigned_to=$2`;
    }
    const result = await db.query(
      `select da.*,tr.run_number,tr.completed_at,ts.target_url,u.display_name as assigned_to_name
         from defect_analyses da
         join test_runs tr on tr.id=da.run_id
         join test_sessions ts on ts.id=tr.session_id
         left join users u on u.id=da.assigned_to
        where ${where}
        order by da.created_at desc`, params
    );
    res.json({ ok: true, defects: result.rows });
  } catch (err) { res.status(500).json({ reply: err.message }); }
});

router.patch('/api/defects/:id/assign', requireAuth, requireRole('QA','MANAGER'), async (req, res) => {
  try {
    const userId = req.body?.userId || null;
    if (userId) {
      const developer = await db.query(`select id from users where id=$1 and role='DEV' and is_active=true`, [userId]);
      if (!developer.rowCount) return res.status(400).json({ reply: 'Defects may be assigned only to an active DEV user.' });
    }
    const result = await db.query(`update defect_analyses set assigned_to=$1 where id=$2 returning *`, [userId, req.params.id]);
    if (!result.rowCount) return res.status(404).json({ reply: 'Defect not found.' });
    res.json({ ok: true, defect: result.rows[0] });
  } catch (err) { res.status(500).json({ reply: err.message }); }
});

router.patch('/api/defects/:id/resolve', requireAuth, requireRole('DEV','QA','MANAGER'), async (req, res) => {
  try {
    const role=String(req.user.role||'').toUpperCase();
    if(role==='DEV'){
      const assigned=await db.query('select id from defect_analyses where id=$1 and assigned_to=$2',[req.params.id,req.user.sub]);
      if(!assigned.rowCount)return res.status(403).json({reply:'Developers may resolve only defects assigned to them.'});
    }
    const result = await db.query(`update defect_analyses set resolved_by=$1,resolved_at=now() where id=$2 returning *`, [req.user.sub, req.params.id]);
    if (!result.rowCount) return res.status(404).json({ reply: 'Defect not found.' });
    res.json({ ok: true, defect: result.rows[0], note: 'Resolution status is administrative; a successful test re-run remains the technical proof.' });
  } catch (err) { res.status(500).json({ reply: err.message }); }
});

module.exports = router;

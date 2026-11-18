const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('../services/authService');

router.get('/api/projects', requireAuth, async (req, res) => {
  try {
    const role = String(req.user.role || '').toUpperCase();
    // Only managers (admins) see every project; QA, developers and viewers see the projects they are members of.
    const result = role === 'MANAGER'
      ? await db.query(`select p.*, u.display_name as created_by_name from projects p left join users u on u.id=p.created_by order by p.created_at desc`)
      : await db.query(`select distinct p.* from projects p left join project_members pm on pm.project_id=p.id left join test_runs tr on tr.project_id=p.id left join defect_analyses da on da.run_id=tr.id where pm.user_id=$1 or da.assigned_to=$1 order by p.created_at desc`, [req.user.sub]);
    // List summary per project: manager, active environments, last run and recorded pass/fail totals.
    const ids = result.rows.map((p) => p.id);
    const summary = ids.length ? await db.query(`select p.id,
      (select u.display_name from project_members pm join users u on u.id=pm.user_id where pm.project_id=p.id and pm.project_role='PROJECT_MANAGER' order by u.display_name limit 1) as manager_name,
      (select count(*)::int from project_environments e where e.project_id=p.id and e.is_active) as environment_count,
      (select max(r.completed_at) from test_runs r where r.project_id=p.id) as last_run_at,
      (select coalesce(sum(r.passed),0)::int from test_runs r where r.project_id=p.id) as passed_total,
      (select coalesce(sum(r.failed),0)::int from test_runs r where r.project_id=p.id) as failed_total,
      (select u.display_name from users u where u.id=p.created_by) as created_by_name,
      (select u.display_name from users u where u.id=p.updated_by) as updated_by_name
      from projects p where p.id = any($1::uuid[])`, [ids]) : { rows: [] };
    const byId = new Map(summary.rows.map((row) => [row.id, row]));
    const projects = result.rows.map((p) => { const { id: _id, ...extra } = byId.get(p.id) || {}; return { ...p, ...extra }; });
    res.json({ ok: true, projects });
  } catch (err) { res.status(500).json({ reply: err.message }); }
});

router.post('/api/projects', requireAuth, requireRole('MANAGER'), async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ reply: 'Project name is required.' });
    const result = await db.query(`insert into projects(name,description,created_by) values($1,$2,$3) returning *`, [name, String(req.body?.description || '').trim() || null, req.user.sub]);
    await db.query(`insert into project_members(project_id,user_id,role,project_role,added_by) values($1,$2,'MANAGER','PROJECT_MANAGER',$2) on conflict(project_id,user_id) do update set role='MANAGER',project_role='PROJECT_MANAGER'`, [result.rows[0].id, req.user.sub]);
    res.status(201).json({ ok: true, project: result.rows[0] });
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
    // Never send the stored token to the browser: only whether one is saved.
    const result = await db.query(`select r.id,r.project_id,r.provider,r.api_base_url,r.repo_full_name,r.default_branch,r.repository_url,r.source_enabled,r.created_by,r.created_at,r.updated_at,
      (r.access_token_encrypted is not null) as has_token,r.token_updated_at,cu.display_name created_by_name,uu.display_name updated_by_name
      from source_repositories r left join users cu on cu.id=r.created_by left join users uu on uu.id=r.updated_by
      where r.project_id=$1 order by r.created_at desc`, [req.params.projectId]);
    res.json({ ok: true, repositories: result.rows });
  } catch (err) { res.status(500).json({ reply: err.message }); }
});

router.post('/api/projects/:projectId/repositories', requireAuth, requireRole('QA','MANAGER'), async (req, res) => {
  try {
    // GitHub: owner/repository. GitLab: group/project (subgroups allowed) on gitlab.com or the company's own GitLab address.
    const provider = String(req.body?.provider || 'github').toLowerCase() === 'gitlab' ? 'gitlab' : 'github';
    const repo = String(req.body?.repoFullName || '').trim().replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '');
    if (provider === 'github' && !/^[^/\s]+\/[^/\s]+$/.test(repo)) return res.status(400).json({ reply: 'GitHub repository must use owner/repository format.' });
    if (provider === 'gitlab' && !/^[^/\s]+(\/[^/\s]+)+$/.test(repo)) return res.status(400).json({ reply: 'GitLab repository must use group/project format.' });
    let apiBase = null;
    if (provider === 'gitlab') {
      apiBase = String(req.body?.apiBaseUrl || 'https://gitlab.com').trim().replace(/\/+$/, '') || 'https://gitlab.com';
      let u; try { u = new URL(apiBase); } catch { u = null; }
      if (!u || u.protocol !== 'https:' || u.pathname.replace(/\/+$/, '') !== '' || u.search || u.username) return res.status(400).json({ reply: 'GitLab address must be like https://gitlab.com or https://gitlab.yourcompany.com.' });
      apiBase = u.origin;
    }
    const branch = String(req.body?.defaultBranch || 'main').trim() || 'main';
    if (!/^[\w.\-\/]+$/.test(branch) || branch.includes('..')) return res.status(400).json({ reply: 'Default branch name is not valid.' });
    const repositoryUrl = provider === 'gitlab' ? apiBase + '/' + repo : `https://github.com/${repo}`;
    const result = await db.query(`insert into source_repositories(project_id,provider,api_base_url,repo_full_name,default_branch,repository_url,created_by) values($1,$2,$3,$4,$5,$6,$7) on conflict(project_id,repo_full_name) do update set provider=excluded.provider,api_base_url=excluded.api_base_url,default_branch=excluded.default_branch,repository_url=excluded.repository_url,source_enabled=true,updated_at=now() returning id,project_id,provider,api_base_url,repo_full_name,default_branch,repository_url,source_enabled,created_at,(access_token_encrypted is not null) as has_token`,[req.params.projectId, provider, apiBase, repo, branch, repositoryUrl, req.user.sub]);
    res.status(201).json({ ok: true, repository: result.rows[0] });
  } catch (err) { res.status(500).json({ reply: err.message }); }
});

router.get('/api/projects/:projectId/defects', requireAuth, async (req, res) => {
  try {
    const params = [req.params.projectId];
    let where = 'tr.project_id=$1';
    if (String(req.user.role).toUpperCase() === 'DEV') { params.push(req.user.sub); where += ` and da.assigned_to=$2`; }
    const result = await db.query(`select da.*,tr.run_number,tr.completed_at,ts.target_url,u.display_name as assigned_to_name from defect_analyses da join test_runs tr on tr.id=da.run_id join test_sessions ts on ts.id=tr.session_id left join users u on u.id=da.assigned_to where ${where} order by da.created_at desc`, params);
    res.json({ ok: true, defects: result.rows });
  } catch (err) { res.status(500).json({ reply: err.message }); }
});

router.patch('/api/defects/:id/assign', requireAuth, requireRole('QA','MANAGER'), async (req, res) => {
  try {
    const userId = req.body?.userId || null;
    if (userId) { const developer = await db.query(`select id from users where id=$1 and role='DEV' and is_active=true`, [userId]); if (!developer.rowCount) return res.status(400).json({ reply: 'Defects may be assigned only to an active DEV user.' }); }
    const result = await db.query(`update defect_analyses set assigned_to=$1 where id=$2 returning *`, [userId, req.params.id]);
    if (!result.rowCount) return res.status(404).json({ reply: 'Defect not found.' });
    res.json({ ok: true, defect: result.rows[0] });
  } catch (err) { res.status(500).json({ reply: err.message }); }
});

router.patch('/api/defects/:id/resolve', requireAuth, requireRole('DEV','QA','MANAGER'), async (req, res) => {
  try {
    const role=String(req.user.role||'').toUpperCase();
    if(role==='DEV'){const assigned=await db.query('select id from defect_analyses where id=$1 and assigned_to=$2',[req.params.id,req.user.sub]);if(!assigned.rowCount)return res.status(403).json({reply:'Developers may resolve only defects assigned to them.'});}
    const result = await db.query(`update defect_analyses set resolved_by=$1,resolved_at=now() where id=$2 returning *`, [req.user.sub, req.params.id]);
    if (!result.rowCount) return res.status(404).json({ reply: 'Defect not found.' });
    res.json({ ok: true, defect: result.rows[0], note: 'Resolution status is administrative; a successful test re-run remains the technical proof.' });
  } catch (err) { res.status(500).json({ reply: err.message }); }
});

router.use(require('./projectUserDirectory'));
router.use(require('./workManagement'));
router.use(require('./defectWorkflows'));
router.use(require('./progressiveGeneration'));
router.use(require('./readinessBatch'));
router.use(require('./isolatedExecution'));
router.use(require('./failureAnalysisStream'));
router.use(require('./restDemo'));
router.use(require('./restApi'));

module.exports = router;
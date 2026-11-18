'use strict';
// Code Intelligence API (spec §5): start a scan, list scans, open one scan with its scanners and findings.
// Project members only (CI-044); QA and project managers start scans.
const express = require('express');
const db = require('../db');
const { requireAuth } = require('../services/authService');
const scans = require('../services/codeIntelligence/scanService');

const router = express.Router();
const isId = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || ''));
const fail = (status, message) => Object.assign(new Error(message), { statusCode: status });
const respond = (res, e) => res.status(e.statusCode || 500).json({ reply: e.statusCode ? e.message : 'Unable to process the code scan request.' });

async function access(req, projectId) {
  if (!isId(projectId)) throw fail(400, 'Invalid project ID.');
  const p = await db.query('select id from projects where id=$1', [projectId]);
  if (!p.rowCount) throw fail(404, 'Project not found.');
  if (String(req.user.role).toUpperCase() === 'MANAGER') return 'PROJECT_MANAGER';
  const m = await db.query('select project_role from project_members where project_id=$1 and user_id=$2', [projectId, req.user.sub]);
  if (!m.rowCount) throw fail(403, 'Not a member of this project.');
  return m.rows[0].project_role || 'VIEWER';
}

router.get('/api/projects/:projectId/code-intelligence/status', requireAuth, async (req, res) => {
  try { await access(req, req.params.projectId); res.json({ ok: true, enabled: scans.ENABLED(), aiEnabled: require('../services/codeIntelligence/aiReview').ENABLED() }); } catch (e) { respond(res, e); }
});

// Start a scan. {repositoryId} = the repository's default branch with every available scanner.
// {storyId} = the story's "Scan by" (pull request, branch or commit) and its ticked code checks.
// {taskId}  = a code-problem task: the same target as the scan it came from (to check the fix).
router.post('/api/projects/:projectId/code-intelligence/scans', requireAuth, async (req, res) => {
  try {
    const role = await access(req, req.params.projectId);
    if (!['PROJECT_MANAGER', 'QA'].includes(role)) throw fail(403, 'Project QA or manager permission required to start a scan.');
    if (!scans.ENABLED()) throw fail(409, 'Code scanning is not enabled on this server (CODE_INTELLIGENCE_ENABLED).');
    const projectId = req.params.projectId;
    let repository, storyId = null, targetType = 'BRANCH', target, checks = null;
    if (isId(req.body?.scanId)) {
      // {scanId} = Code scans list → scan icon: the same scan again (same repository, branch / pull request / commit
      // and story) with every check that scan has run. It becomes that scan's next attempt (Times scanned +1).
      const prev = (await db.query('select scan_number,repository_id,target_type,target,story_id from ci_scan_runs where id=$1 and project_id=$2', [req.body.scanId, projectId])).rows[0];
      if (!prev) throw fail(404, 'Scan not found.');
      repository = prev.repository_id ? (await db.query('select * from source_repositories where id=$1 and project_id=$2 and source_enabled=true', [prev.repository_id, projectId])).rows[0] : null;
      if (!repository) throw fail(409, 'The repository of this scan is no longer linked. Link it again in the Source code tab.');
      targetType = prev.target_type; target = prev.target; storyId = prev.story_id || null;
      const ran = (await db.query('select distinct unnest(categories) c from ci_scan_runs where project_id=$1 and scan_number=$2', [projectId, prev.scan_number])).rows.map((r) => 'CODE_' + r.c);
      checks = ran.filter((c) => ['CODE_SAST', 'CODE_SECRETS', 'CODE_SCA'].includes(c));
      if (!checks.length) checks = null;
    } else if (isId(req.body?.taskId)) {
      // {taskId} = a code-problem task: scan again what its scan scanned (same repository, branch / pull request /
      // commit and story), with the check of that problem's type. A pull request is fetched again, so a fix pushed
      // to it is included. The fix check then closes the task (Ready for retest) or keeps it open.
      const t = (await db.query("select id,metadata from work_items where id=$1 and project_id=$2 and origin='CODE_FINDING' and deleted_at is null", [req.body.taskId, projectId])).rows[0];
      if (!t) throw fail(404, 'Code problem task not found.');
      const prev = isId(t.metadata?.scanRunId) ? (await db.query('select repository_id,target_type,target,story_id from ci_scan_runs where id=$1 and project_id=$2', [t.metadata.scanRunId, projectId])).rows[0] : null;
      const repoId = prev?.repository_id || t.metadata?.repositoryId || null;
      repository = repoId ? (await db.query('select * from source_repositories where id=$1 and project_id=$2 and source_enabled=true', [repoId, projectId])).rows[0] : null;
      if (!repository) throw fail(409, 'The repository of this task is no longer linked. Link it again in the Source code tab.');
      targetType = prev?.target_type || 'BRANCH';
      target = prev?.target || repository.default_branch || 'main';
      storyId = prev?.story_id || null;
      const CHECK_OF = { SAST: 'CODE_SAST', SECRETS: 'CODE_SECRETS', SCA: 'CODE_SCA', CONTAINER: 'CODE_SCA', IAC: 'CODE_SCA' };
      checks = CHECK_OF[t.metadata?.category] ? [CHECK_OF[t.metadata.category]] : null;
    } else if (isId(req.body?.storyId)) {
      const st = (await db.query('select id,story_types,code_target_type,code_target,code_branch,code_repository_id from project_stories where id=$1 and project_id=$2', [req.body.storyId, projectId])).rows[0];
      if (!st) throw fail(404, 'Story not found.');
      checks = (st.story_types || []).filter((t) => String(t).startsWith('CODE_'));
      if (!checks.length) throw fail(400, 'This story has no Code Intelligence checks. Edit the story and choose Code Intelligence.');
      // The story's own repository; older stories without one use the newest repository.
      repository = (await db.query('select * from source_repositories where project_id=$1 and source_enabled=true and ($2::uuid is null or id=$2) order by created_at desc limit 1', [projectId, st.code_repository_id || null])).rows[0];
      storyId = st.id;
      targetType = st.code_target_type || 'BRANCH';
      target = st.code_target || st.code_branch || null;
      if (!target) { targetType = 'BRANCH'; target = repository?.default_branch || 'main'; }
    } else {
      if (!isId(req.body?.repositoryId)) throw fail(400, 'Choose a repository or a story to scan.');
      repository = (await db.query('select * from source_repositories where id=$1 and project_id=$2', [req.body.repositoryId, projectId])).rows[0];
      target = repository?.default_branch || 'main';
      // Code scans tab → New scan: a chosen branch, pull request or commit, and chosen checks.
      if (req.body?.targetType || req.body?.target) {
        targetType = String(req.body.targetType || 'BRANCH').toUpperCase();
        if (!['BRANCH', 'PULL_REQUEST', 'COMMIT'].includes(targetType)) throw fail(400, 'Choose branch, pull request or commit.');
        const v = String(req.body.target || '').trim();
        if (v) {
          const ok = targetType === 'BRANCH' ? /^[\w.\-\/]+$/.test(v) && !v.includes('..') : targetType === 'PULL_REQUEST' ? /^\d{1,9}$/.test(v) : /^[0-9a-f]{7,40}$/i.test(v);
          if (!ok) throw fail(400, 'Choose a ' + (targetType === 'PULL_REQUEST' ? 'pull request' : targetType === 'COMMIT' ? 'commit' : 'branch') + ' from the list.');
          target = v;
        } else if (targetType !== 'BRANCH') throw fail(400, 'Choose a ' + (targetType === 'PULL_REQUEST' ? 'pull request' : 'commit') + ' from the list.');
      }
      if (Array.isArray(req.body?.checks)) {
        checks = [...new Set(req.body.checks.map((c) => String(c).toUpperCase()).filter((c) => ['CODE_SAST', 'CODE_SECRETS', 'CODE_SCA'].includes(c)))];
        if (!checks.length) throw fail(400, 'Tick at least one check.');
      }
    }
    if (!repository) throw fail(400, 'Add a repository in the Source code tab first.');
    const run = await scans.createRun({ projectId, repository, storyId, targetType, target, checks, userId: req.user.sub });
    res.status(202).json({ ok: true, scan: { id: run.id, scanNumber: run.scan_number, attempt: run.attempt, status: run.status } });
  } catch (e) { respond(res, e); }
});

router.get('/api/projects/:projectId/code-intelligence/scans', requireAuth, async (req, res) => {
  try {
    await access(req, req.params.projectId);
    await scans.recoverInterrupted();
    const storyId = isId(req.query.storyId) ? req.query.storyId : null;
    // One row per scan (its latest attempt), like a test run: Times scanned = attempts; Created = the first attempt.
    const r = await db.query(`select * from (select distinct on (s.scan_number) s.id,s.scan_number,s.attempt,s.repository_id,s.repo_full_name,s.story_id,ps.reference_no story_ref,ps.title story_title,s.target_type,s.target,s.commit_sha,
        s.categories,s.status,s.error,s.summary,s.created_at,s.started_at,s.completed_at,u.display_name created_by_name,coalesce(sr.provider,'github') provider,
        count(*) over (partition by s.scan_number) times_scanned,first_value(s.created_at) over w first_created_at,first_value(u.display_name) over w first_created_by_name
      from ci_scan_runs s left join users u on u.id=s.created_by left join project_stories ps on ps.id=s.story_id left join source_repositories sr on sr.id=s.repository_id
      where s.project_id=$1 and ($2::uuid is null or s.story_id=$2)
      window w as (partition by s.scan_number order by s.attempt)
      order by s.scan_number,s.attempt desc) x order by x.created_at desc limit 100`, [req.params.projectId, storyId]);
    res.json({ ok: true, scans: r.rows });
  } catch (e) { respond(res, e); }
});

router.get('/api/projects/:projectId/code-intelligence/scans/:scanId', requireAuth, async (req, res) => {
  try {
    await access(req, req.params.projectId);
    if (!isId(req.params.scanId)) throw fail(400, 'Invalid scan ID.');
    const run = (await db.query(`select s.*,u.display_name created_by_name,ps.reference_no story_ref,ps.title story_title,coalesce(sr.provider,'github') provider from ci_scan_runs s
      left join users u on u.id=s.created_by left join project_stories ps on ps.id=s.story_id left join source_repositories sr on sr.id=s.repository_id where s.id=$1 and s.project_id=$2`, [req.params.scanId, req.params.projectId])).rows[0];
    if (!run) throw fail(404, 'Scan not found.');
    // The scan page, like a test run's page: every problem found in any attempt of this scan, each once, with its
    // latest result (Found / New / Fixed), how many attempts found it, and its own scan history.
    const attempts = await scanAttempts(req.params.projectId, run.scan_number);
    const latest = attempts[attempts.length - 1];
    const scan = latest.id === run.id ? run : (await db.query(`select s.*,u.display_name created_by_name,ps.reference_no story_ref,ps.title story_title,coalesce(sr.provider,'github') provider from ci_scan_runs s
      left join users u on u.id=s.created_by left join project_stories ps on ps.id=s.story_id left join source_repositories sr on sr.id=s.repository_id where s.id=$1`, [latest.id])).rows[0];
    const jobs = (await db.query('select category,scanner,scanner_version,status,findings_count,error,started_at,completed_at from ci_scan_jobs where scan_run_id=$1 order by category', [scan.id])).rows;
    const rows = (await db.query(`select o.scan_run_id,o.file_path,o.line,f.id,f.category,f.scanner,f.rule_id,f.title,f.severity,f.priority,f.priority_manual,f.cwe,f.cve,f.package_name,f.installed_version,f.fixed_version,f.message,f.status,
        f.decision_reason,f.decided_at,du.display_name decided_by_name,exists(select 1 from ci_ai_reviews r where r.finding_id=f.id) as has_ai
      from ci_finding_occurrences o join ci_findings f on f.id=o.finding_id left join users du on du.id=f.decided_by
      where o.scan_run_id = any($1::uuid[]) limit 20000`, [attempts.map((a) => a.id)])).rows;
    const done = attempts.filter((a) => ['COMPLETED', 'PARTIAL'].includes(a.status));
    const byId = new Map();
    for (const r of rows) {
      const a = attempts.find((x) => x.id === r.scan_run_id);
      const f = byId.get(r.id) || { ...r, found: new Set() };
      f.found.add(a.attempt);
      if (!byId.has(r.id) || a.attempt >= f.place_attempt) { f.file_path = r.file_path; f.line = r.line; f.place_attempt = a.attempt; }
      byId.set(r.id, f);
    }
    const SEV = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
    const findings = [...byId.values()].map((f) => {
      // Attempts whose checks covered this kind of problem (a task's re-scan may run one check only).
      const checking = done.filter((a) => a.checked.includes(f.category));
      const last = checking[checking.length - 1], before = checking[checking.length - 2];
      const scan_status = !last ? 'FOUND' : !f.found.has(last.attempt) ? 'FIXED' : before && !f.found.has(before.attempt) ? 'NEW' : 'FOUND';
      const history = attempts.map((a) => ({ attempt: a.attempt, created_at: a.created_at, by: a.created_by_name, commit_sha: a.commit_sha, result: f.found.has(a.attempt) ? 'FOUND' : done.includes(a) && a.checked.includes(f.category) ? 'NOT_FOUND' : 'NOT_CHECKED' }));
      const { found, place_attempt, scan_run_id, ...rest } = f;
      return { ...rest, scan_status, times_found: found.size, times_checked: checking.length || found.size, history, is_new: scan_status === 'NEW' };
    }).sort((a, b) => SEV.indexOf(a.severity) - SEV.indexOf(b.severity) || String(a.category).localeCompare(b.category) || String(a.file_path).localeCompare(b.file_path));
    res.json({ ok: true, scan, jobs, findings, attempts });
  } catch (e) { respond(res, e); }
});

// Attempts of one scan (oldest first): who, when, which commit, how many problems, and New / Fixed compared with the
// attempt before it. Only the checks that ran in both attempts are compared (a task's re-scan may run one check only).
const FINDING_CATS = { SAST: ['SAST'], SECRETS: ['SECRETS'], SCA: ['SCA', 'CONTAINER', 'IAC'] };
async function scanAttempts(projectId, scanNumber) {
  const rows = (await db.query(`select s.id,s.attempt,s.status,s.commit_sha,s.target_type,s.target,s.summary,s.created_at,s.completed_at,u.display_name created_by_name,
      (select coalesce(array_agg(j.category),'{}') from ci_scan_jobs j where j.scan_run_id=s.id and j.status='COMPLETED') ran,
      (select count(*)::int from ci_finding_occurrences o where o.scan_run_id=s.id) problems
    from ci_scan_runs s left join users u on u.id=s.created_by where s.project_id=$1 and s.scan_number=$2 order by s.attempt`, [projectId, scanNumber])).rows;
  let before = null;
  for (const a of rows) {
    a.checked = [...new Set(a.ran.flatMap((c) => FINDING_CATS[c] || [c]))];
    if (before && ['COMPLETED', 'PARTIAL'].includes(a.status)) {
      const both = a.checked.filter((c) => before.checked.includes(c));
      const d = (await db.query(`with cur as (select o.finding_id from ci_finding_occurrences o join ci_findings f on f.id=o.finding_id where o.scan_run_id=$1 and f.category=any($3::text[])),
          prev as (select o.finding_id from ci_finding_occurrences o join ci_findings f on f.id=o.finding_id where o.scan_run_id=$2 and f.category=any($3::text[]))
        select (select count(*)::int from cur where finding_id not in (select finding_id from prev)) new_count,
               (select count(*)::int from prev where finding_id not in (select finding_id from cur)) fixed_count`, [a.id, before.id, both])).rows[0];
      a.new_count = d.new_count; a.fixed_count = d.fixed_count; a.compared_with = before.attempt;
    }
    if (['COMPLETED', 'PARTIAL'].includes(a.status)) before = a;
  }
  return rows;
}

// AI on demand: explain one finding (meaning, real risk?, suggested priority, fix). Saved, so it is not asked again
// unless ?refresh=1. Any project member who can see the finding may ask.
router.post('/api/projects/:projectId/code-intelligence/findings/:findingId/explain', requireAuth, async (req, res) => {
  try {
    await access(req, req.params.projectId);
    if (!isId(req.params.findingId)) throw fail(400, 'Invalid finding ID.');
    const f = (await db.query('select * from ci_findings where id=$1 and project_id=$2', [req.params.findingId, req.params.projectId])).rows[0];
    if (!f) throw fail(404, 'Finding not found.');
    if (req.query.refresh !== '1') {
      const saved = (await db.query('select r.result,r.created_at,u.display_name created_by_name from ci_ai_reviews r left join users u on u.id=r.created_by where r.finding_id=$1 order by r.created_at desc limit 1', [f.id])).rows[0];
      if (saved) return res.json({ ok: true, review: { ...saved.result, createdAt: saved.created_at, createdBy: saved.created_by_name, snippet: f.code_snippet, snippetStart: f.snippet_start_line, cached: true } });
    }
    const { result, model } = await require('../services/codeIntelligence/aiReview').explainFinding(f);
    const row = (await db.query('insert into ci_ai_reviews(finding_id,project_id,model,result,created_by) values($1,$2,$3,$4::jsonb,$5) returning created_at', [f.id, req.params.projectId, model, JSON.stringify(result), req.user.sub])).rows[0];
    res.json({ ok: true, review: { ...result, createdAt: row.created_at, createdBy: req.user.name || null, snippet: f.code_snippet, snippetStart: f.snippet_start_line, cached: false } });
  } catch (e) { res.status(e.statusCode || 502).json({ reply: e.statusCode ? e.message : 'The AI could not explain this finding: ' + String(e.message || '').slice(0, 200) }); }
});

// Change a finding's priority (QA / project manager). Severity never changes; the chosen priority is kept on re-scans.
router.patch('/api/projects/:projectId/code-intelligence/findings/:findingId/priority', requireAuth, async (req, res) => {
  try {
    const role = await access(req, req.params.projectId);
    if (!['PROJECT_MANAGER', 'QA'].includes(role)) throw fail(403, 'Project QA or manager permission required to change priority.');
    if (!isId(req.params.findingId)) throw fail(400, 'Invalid finding ID.');
    const priority = String(req.body?.priority || '').toUpperCase();
    if (!['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(priority)) throw fail(400, 'Priority must be Critical, High, Medium or Low.');
    const old = (await db.query('select id,priority,severity,title,file_path from ci_findings where id=$1 and project_id=$2', [req.params.findingId, req.params.projectId])).rows[0];
    if (!old) throw fail(404, 'Finding not found.');
    await db.query('update ci_findings set priority=$1,priority_manual=true,priority_updated_by=$2,priority_updated_at=now(),updated_at=now() where id=$3', [priority, req.user.sub, old.id]);
    await db.query("insert into project_audit_events(project_id,actor_id,event_type,metadata) values($1,$2,'FINDING_PRIORITY_CHANGED',$3::jsonb)",
      [req.params.projectId, req.user.sub, JSON.stringify({ findingId: old.id, title: old.title, file: old.file_path, severity: old.severity, from: old.priority, to: priority })]);
    res.json({ ok: true, priority });
  } catch (e) { respond(res, e); }
});

// ---- Code problems as tasks ----
const findingTasks = require('../services/codeIntelligence/findingTasks');
// Accept or reject one problem (all its places) in the scan results. QA / project manager.
// Accept creates the task (written by AI, assigned by the system to the team); Reject needs a reason and cancels an open task.
router.post('/api/projects/:projectId/code-intelligence/findings/decision', requireAuth, async (req, res) => {
  try {
    const role = await access(req, req.params.projectId);
    if (!['PROJECT_MANAGER', 'QA'].includes(role)) throw fail(403, 'Project QA or manager permission required to accept or reject a problem.');
    const ids = [...new Set((Array.isArray(req.body?.findingIds) ? req.body.findingIds : []).filter(isId))].slice(0, 2000);
    if (!ids.length) throw fail(400, 'Choose a problem first.');
    const r = await findingTasks.decideFindings({ projectId: req.params.projectId, findingIds: ids, decision: req.body?.decision, reason: req.body?.reason, userId: req.user.sub, scanId: isId(req.body?.scanId) ? req.body.scanId : null });
    await db.query("insert into project_audit_events(project_id,actor_id,event_type,metadata) values($1,$2,'CODE_PROBLEM_DECISION',$3::jsonb)",
      [req.params.projectId, req.user.sub, JSON.stringify({ findingIds: ids, decision: r.decision, reason: r.decision === 'REJECT' ? String(req.body?.reason || '').slice(0, 1000) : null, taskId: r.task?.id || null })]);
    // A new task is written by the AI right away.
    const ai = r.decision === 'ACCEPT' && r.task && !r.existing ? await aiWriteTask(r.task.id, req.user) : null;
    res.json({ ok: true, ...r, ai });
  } catch (e) { respond(res, e); }
});
// The code problem behind a task (shown in the task): what, where, the fix, and who accepted it.
router.get('/api/projects/:projectId/code-intelligence/tasks/:taskId', requireAuth, async (req, res) => {
  try {
    const role = await access(req, req.params.projectId);
    if (!isId(req.params.taskId)) throw fail(400, 'Invalid task ID.');
    const task = (await db.query("select id,status,metadata,failure_count from work_items where id=$1 and project_id=$2 and origin='CODE_FINDING' and deleted_at is null", [req.params.taskId, req.params.projectId])).rows[0];
    if (!task) throw fail(404, 'Code problem task not found.');
    const places = await taskPlaces(task.id);
    res.json({ ok: true, role, task, places, aiEnabled: require('../services/codeIntelligence/aiReview').ENABLED() });
  } catch (e) { respond(res, e); }
});
async function taskPlaces(taskId) {
  return (await db.query(`select f.id,f.title,f.category,f.severity,f.rule_id,f.cwe,f.cve,f.package_name,f.installed_version,f.fixed_version,f.message,f.status,f.decision_reason,
        f.code_snippet,f.snippet_start_line,
        coalesce(o.file_path,f.file_path) file_path,coalesce(o.line,f.line) line,exists(select 1 from ci_ai_reviews r where r.finding_id=f.id) has_ai,du.display_name decided_by_name,f.decided_at
      from ci_finding_task_links l join ci_findings f on f.id=l.finding_id
      left join lateral (select file_path,line from ci_finding_occurrences x where x.finding_id=f.id order by x.created_at desc limit 1) o on true
      left join users du on du.id=f.decided_by
      where l.work_item_id=$1 order by file_path,line`, [taskId])).rows;
}
// "✓ Mark as checked": a project member has read the AI's text in the task and agrees with it.
// The badge changes from "AI · unverified" to "AI · checked by … · date". Viewers cannot do it.
router.post('/api/projects/:projectId/code-intelligence/tasks/:taskId/ai-check', requireAuth, async (req, res) => {
  try {
    const role = await access(req, req.params.projectId);
    if (!['PROJECT_MANAGER', 'QA', 'DEVELOPER'].includes(role)) throw fail(403, 'Project QA, developer or manager permission required.');
    if (!isId(req.params.taskId)) throw fail(400, 'Invalid task ID.');
    const checked = { checkedAt: new Date().toISOString(), checkedBy: req.user.sub, checkedByName: req.user.name || null };
    const t = await db.withTransaction(async (client) => {
      const task = (await client.query("select id,status,metadata from work_items where id=$1 and project_id=$2 and origin='CODE_FINDING' and deleted_at is null for update", [req.params.taskId, req.params.projectId])).rows[0];
      if (!task) throw fail(404, 'Code problem task not found.');
      if (!task.metadata?.aiTask) throw fail(409, 'This task was not written by AI.');
      if (task.metadata.aiTask.checkedAt) throw fail(409, 'Already checked by ' + (task.metadata.aiTask.checkedByName || 'someone') + '.');
      await client.query("update work_items set metadata=jsonb_set(metadata,'{aiTask}',(metadata->'aiTask')||$2::jsonb),updated_by=$3,updated_at=now() where id=$1", [task.id, JSON.stringify(checked), req.user.sub]);
      await client.query('insert into work_item_history(work_item_id,event_type,old_status,new_status,performed_by,comment) values($1,$2,$3,$3,$4,$5)',
        [task.id, 'AI_TASK_CHECKED', task.status, req.user.sub, 'AI text checked and agreed.']);
      return task;
    });
    res.json({ ok: true, taskId: t.id, ...checked });
  } catch (e) { respond(res, e); }
});
// AI task generation: when a problem is accepted, the AI writes the new task in simple words (title, problem, steps
// to fix, how to check). Saved on the task (shown as "What to do"); the task title becomes the AI title. The finding
// keeps the scanner's words. If the AI is off or fails, the task keeps the scanner text (Accept never fails because of AI).
async function aiWriteTask(taskId, user) {
  const ai = require('../services/codeIntelligence/aiReview');
  if (!ai.ENABLED()) return { written: false, note: 'AI is not enabled on this server.' };
  try {
    const task = (await db.query('select id,title,status from work_items where id=$1', [taskId])).rows[0];
    const places = await taskPlaces(taskId);
    if (!task || !places.length) return { written: false, note: 'No code problem linked.' };
    const rep = places.find((p) => p.code_snippet) || places[0];
    const { result, model } = await ai.writeTask(rep, places);
    const CAT = { SAST: 'Code problem', SCA: 'Risky library', SECRETS: 'Exposed secret', CONTAINER: 'Docker setting', IAC: 'Infrastructure setting', QUALITY: 'Code quality' };
    const title = ((CAT[rep.category] || 'Code problem') + ' · ' + result.title).slice(0, 500);
    const aiTask = { ...result, model, createdAt: new Date().toISOString(), createdBy: user.sub, createdByName: user.name || null, scannerTitle: rep.title };
    await db.withTransaction(async (client) => {
      await client.query("update work_items set title=$2,metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('aiTask',$3::jsonb),updated_at=now() where id=$1", [taskId, title, JSON.stringify(aiTask)]);
      await client.query('insert into work_item_history(work_item_id,event_type,old_status,new_status,performed_by,comment) values($1,$2,$3,$3,$4,$5)',
        [taskId, 'AI_TASK_WRITTEN', task.status, user.sub, 'Task written by AI (unverified). Scanner title: ' + String(rep.title).slice(0, 300)]);
    });
    return { written: true, title };
  } catch (e) {
    return { written: false, note: e.statusCode ? e.message : 'The AI could not write this task: ' + String(e.message || '').slice(0, 200) };
  }
}

module.exports = router;

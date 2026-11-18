'use strict';
// Code problems as tasks (same task table, team assignment and statuses as failed tests).
//   In the scan results, QA or a Project Manager accepts or rejects each problem (the same problem in several
//   places = one problem):
//     Accept → it is a real problem: one task for all its places, assigned by the system to the project's team
//              (a Developer to fix it; QA when the team has no developer). The task is then worked in the Tasks tab.
//     Reject → not a real problem: the reason is kept, the row stays in the results as Rejected, and any open task
//              of it is cancelled. Either can be undone with the other icon.
//   The developer sets "Ready for retest"; the next scan closes the task when the problem is gone, or sends it back.
const db = require('../../db');
const { chooseAssignee, ROLE_LABELS, OPEN } = require('../failureAssignment');

const RANK = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
const SEV_WORD = { CRITICAL: 'Critical', HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low', INFO: 'Info' };
const CAT_WORD = { SAST: 'Code problem', SCA: 'Risky library', SECRETS: 'Exposed secret', CONTAINER: 'Docker setting', IAC: 'Infrastructure setting', QUALITY: 'Code quality' };
// Which scanner job checks which kind of problem (a fix is confirmed only when that check ran in the scan).
const JOB_OF = { SAST: 'SAST', SECRETS: 'SECRETS', SCA: 'SCA', CONTAINER: 'SCA', IAC: 'SCA' };
// The same grouping as the findings popup.
const groupKey = (f) => [f.category, f.title, f.cve || '', f.cwe || '', f.package_name || '', f.severity].join('\u0001');
const fail = (status, message) => Object.assign(new Error(message), { statusCode: status });

function groupsOf(rows) {
  const map = new Map();
  for (const f of rows) { const k = groupKey(f); if (!map.has(k)) map.set(k, []); map.get(k).push(f); }
  return [...map.values()];
}
function placesText(members) {
  const list = [...new Set(members.map((m) => (m.occ_path || m.file_path || '—') + (m.occ_line || m.line ? ':' + (m.occ_line || m.line) : '') + (m.installed_version && m.package_name ? ' (' + m.installed_version + ')' : '')))].sort();
  return list.slice(0, 25).join('\n') + (list.length > 25 ? '\n… and ' + (list.length - 25) + ' more' : '');
}
async function history(client, taskId, type, oldStatus, newStatus, userId, comment) {
  await client.query('insert into work_item_history(work_item_id,event_type,old_status,new_status,performed_by,comment) values($1,$2,$3,$4,$5,$6)',
    [taskId, type, oldStatus || null, newStatus || null, userId || null, comment]);
}
async function openTaskFor(client, ids) {
  return (await client.query(`select w.* from work_items w join ci_finding_task_links l on l.work_item_id=w.id
     where l.finding_id = any($1::uuid[]) and w.deleted_at is null and w.status = any($2::text[]) order by w.created_at desc limit 1`, [ids, OPEN])).rows[0] || null;
}
async function link(client, taskId, members, projectId) {
  for (const m of members) await client.query('insert into ci_finding_task_links(work_item_id,finding_id,project_id) values($1,$2,$3) on conflict do nothing', [taskId, m.id, projectId]);
}
async function nameOf(client, userId) {
  return userId ? (await client.query('select display_name from users where id=$1', [userId])).rows[0]?.display_name || null : null;
}

// One task for one accepted problem (its places = members), assigned by the system to the team: a Developer fixes it.
async function createTask(client, { run, members, userId }) {
  const f = members[0];
  const top = members.reduce((a, b) => ((RANK[b.priority] || 0) > (RANK[a.priority] || 0) ? b : a));
  const settings = (await client.query('select default_developer from project_workflow_settings where project_id=$1', [f.project_id])).rows[0] || {};
  const pick = await chooseAssignee(client, { projectId: f.project_id, category: 'CODE', reason: 'APPLICATION_DEFECT', fallbackDeveloper: settings.default_developer || null });
  const places = new Set(members.map((m) => (m.occ_path || m.file_path) + ':' + (m.occ_line || m.line || ''))).size;
  // Same title style as a failed-test task ("TC012 failed · …").
  const title = ((CAT_WORD[f.category] || 'Code problem') + ' · ' + String(f.title)).slice(0, 500);
  const description = [
    SEV_WORD[f.severity] + ' · ' + (CAT_WORD[f.category] || f.category) + (f.cve || f.cwe ? ' · ' + [f.cwe, f.cve].filter(Boolean).join(' · ') : ''),
    f.package_name ? 'Library: ' + f.package_name + (f.fixed_version ? ' · fix: upgrade to ' + f.fixed_version : '') : null,
    f.message ? String(f.message).slice(0, 1200) : null,
    'Found in ' + places + ' place' + (places === 1 ? '' : 's') + (run ? ' (Scan #' + run.scan_number + ' · ' + run.repo_full_name + ')' : '') + ':',
    placesText(members),
  ].filter(Boolean).join('\n');
  const metadata = { source: 'code_scan', scanRunId: run?.id || null, scanNumber: run?.scan_number || null, category: f.category, severity: f.severity,
    cve: f.cve || null, cwe: f.cwe || null, packageName: f.package_name || null, fixedVersion: f.fixed_version || null, repositoryId: f.repository_id || null };
  const t = (await client.query(`insert into work_items(project_id,work_type,title,description,priority,assigned_to,created_by,updated_by,metadata,origin,team_id,assigned_role,assigned_by_system,story_id,failure_count)
      values($1,'DEFECT_FIX',$2,$3,$4,$5,$6,$6,$7::jsonb,'CODE_FINDING',$8,$9,$10,$11,1) returning id,task_number,status`,
    [f.project_id, title, description, top.priority || 'MEDIUM', pick.userId, userId || null, JSON.stringify(metadata), pick.teamId, pick.role, Boolean(pick.userId), run?.story_id || null])).rows[0];
  await link(client, t.id, members, f.project_id);
  await history(client, t.id, 'CODE_TASK_CREATED', null, 'PENDING', userId, 'Created from the scan results: accepted' + (run ? ' in Scan #' + run.scan_number : '') + '. '
    + (pick.userId ? 'Assigned by the system to ' + (pick.teamName ? pick.teamName + ' · ' : '') + (ROLE_LABELS[pick.role] || pick.role) + '.' : 'Not assigned: ' + pick.note) + (pick.userId && pick.note ? ' ' + pick.note : ''));
  if (pick.userId) await client.query("insert into notification_outbox(project_id,user_id,channel,event_type,subject,payload_json,status) values($1,$2,'IN_APP','WORK_ITEM_ASSIGNED',$3,$4::jsonb,'PENDING')",
    [f.project_id, pick.userId, 'Code problem to fix: ' + f.title, JSON.stringify({ workItemId: t.id })]);
  return { ...t, assigned_to_name: await nameOf(client, pick.userId) };
}

// Accept or reject one problem (all its places) from the scan results. QA or Project Manager (checked by the route).
async function decideFindings({ projectId, findingIds, decision, reason, userId, scanId }) {
  const d = String(decision || '').toUpperCase();
  if (!['ACCEPT', 'REJECT'].includes(d)) throw fail(400, 'Choose Accept or Reject.');
  const why = String(reason || '').trim().slice(0, 1000);
  if (d === 'REJECT' && why.length < 3) throw fail(400, 'Please write the reason.');
  return db.withTransaction(async (client) => {
    const members = (await client.query(`select f.*,o.file_path occ_path,o.line occ_line from ci_findings f
        left join lateral (select file_path,line from ci_finding_occurrences x where x.finding_id=f.id order by x.created_at desc limit 1) o on true
       where f.project_id=$1 and f.id = any($2::uuid[])`, [projectId, findingIds])).rows;
    if (!members.length) throw fail(404, 'Problem not found in this project.');
    await client.query('select pg_advisory_xact_lock(hashtext($1))', ['ci-task:' + projectId + ':' + groupKey(members[0])]);
    const ids = members.map((m) => m.id);
    const open = await openTaskFor(client, ids);
    if (d === 'ACCEPT') {
      await client.query("update ci_findings set status='CONFIRMED',decision_reason=null,decided_by=$2,decided_at=now(),updated_at=now() where id = any($1::uuid[])", [ids, userId]);
      if (open) {
        await link(client, open.id, members, projectId);
        return { decision: d, existing: true, task: { id: open.id, task_number: open.task_number, status: open.status, assigned_to_name: await nameOf(client, open.assigned_to) } };
      }
      // The scan the user is looking at (else the last scan that found it).
      const run = (await client.query('select * from ci_scan_runs where id = any($1::uuid[]) and project_id=$2 order by (id=$3) desc limit 1', [[scanId, members[0].last_seen_scan_id].filter(Boolean), projectId, scanId || members[0].last_seen_scan_id])).rows[0] || null;
      return { decision: d, existing: false, task: await createTask(client, { run, members, userId }) };
    }
    await client.query("update ci_findings set status='FALSE_POSITIVE',decision_reason=$2,decided_by=$3,decided_at=now(),updated_at=now() where id = any($1::uuid[])", [ids, why, userId]);
    if (open) {
      await client.query("update work_items set status='CANCELLED',closed_at=now(),closed_by=$2,updated_by=$2,updated_at=now() where id=$1", [open.id, userId]);
      await history(client, open.id, 'CODE_REJECTED', open.status, 'CANCELLED', userId, 'Rejected in the scan results: ' + why + (/[.!?]$/.test(why) ? '' : '.') + ' Task cancelled.');
    }
    return { decision: d, task: open ? { id: open.id, task_number: open.task_number, status: 'CANCELLED' } : null };
  });
}

// After a scan: new places join the open task, "still found" for tasks waiting for retest, and "fixed" when a problem is gone.
// No task is created here: tasks start only when someone accepts a problem.
async function afterScan(runId) {
  if (!db.isConfigured()) return { fixed: 0, back: 0 };
  const run = (await db.query('select * from ci_scan_runs where id=$1', [runId])).rows[0];
  if (!run || !['COMPLETED', 'PARTIAL'].includes(run.status)) return { fixed: 0, back: 0 };
  const rows = (await db.query('select f.*,o.file_path occ_path,o.line occ_line from ci_finding_occurrences o join ci_findings f on f.id=o.finding_id where o.scan_run_id=$1', [runId])).rows;
  const ranJobs = new Set((await db.query("select category from ci_scan_jobs where scan_run_id=$1 and status='COMPLETED'", [runId])).rows.map((r) => r.category));
  let fixed = 0, back = 0;
  for (const members of groupsOf(rows)) {
    await db.withTransaction(async (client) => {
      await client.query('select pg_advisory_xact_lock(hashtext($1))', ['ci-task:' + run.project_id + ':' + groupKey(members[0])]);
      const task = await openTaskFor(client, members.map((m) => m.id));
      if (!task) return;
      await link(client, task.id, members, run.project_id);
      // New places of an accepted problem are accepted too.
      await client.query("update ci_findings set status='CONFIRMED',updated_at=now() where id = any($1::uuid[]) and status in ('OPEN','REOPENED')", [members.map((m) => m.id)]);
      await client.query('update work_items set failure_count=failure_count+1,updated_at=now() where id=$1', [task.id]);
      if (task.status === 'READY_FOR_RETEST') {
        const places = new Set(members.map((m) => (m.occ_path || '') + ':' + (m.occ_line || ''))).size;
        await client.query("update work_items set status='IN_PROGRESS',updated_at=now() where id=$1", [task.id]);
        await history(client, task.id, 'CODE_STILL_FOUND', 'READY_FOR_RETEST', 'IN_PROGRESS', null, 'Still found in ' + places + ' place' + (places === 1 ? '' : 's') + ' in Scan #' + run.scan_number + '; back to In progress.');
        back++;
      }
    });
  }
  // Fix check: tasks of this repository waiting for retest whose problem was not found by this scan (when its check ran).
  const waiting = (await db.query(`select w.id,w.status,w.metadata from work_items w where w.project_id=$1 and w.origin='CODE_FINDING' and w.deleted_at is null
      and w.status='READY_FOR_RETEST' and coalesce(w.metadata->>'repositoryId','')=coalesce($2::text,'')`, [run.project_id, run.repository_id])).rows;
  const inScan = new Set(rows.map((r) => r.id));
  for (const w of waiting) {
    if (!ranJobs.has(JOB_OF[w.metadata?.category] || w.metadata?.category)) continue;
    const linked = (await db.query('select finding_id from ci_finding_task_links where work_item_id=$1', [w.id])).rows.map((r) => r.finding_id);
    if (!linked.length || linked.some((id) => inScan.has(id))) continue;
    await db.withTransaction(async (client) => {
      await client.query("update work_items set status='COMPLETED',completed_at=now(),closed_at=now(),progress_percent=100,updated_at=now() where id=$1 and status='READY_FOR_RETEST'", [w.id]);
      await client.query("update ci_findings set status='FIXED',updated_at=now() where id = any($1::uuid[])", [linked]);
      await history(client, w.id, 'CODE_FIXED', 'READY_FOR_RETEST', 'COMPLETED', null, 'Not found in Scan #' + run.scan_number + ': fixed. Task closed.');
    });
    fixed++;
  }
  return { fixed, back };
}

module.exports = { afterScan, decideFindings };

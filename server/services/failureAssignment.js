'use strict';
// Who handles a failed test: the project's team -> the role that fits the failure -> the member of that role
// with the fewest open tasks. Fallbacks: the team's QA, then the project's fallback developer (app defects only),
// then a Project Manager of the project. Nothing found = the task stays unassigned.

const OPEN = ['PENDING', 'IN_PROGRESS', 'ON_HOLD', 'READY_FOR_RETEST'];

// AI failure type -> role. "Not analysed yet" and unclear cases go to QA, who check first.
const ROLE_BY_REASON = {
  APPLICATION_DEFECT: 'DEVELOPER',
  AUTOMATION_DEFECT: 'QA',
  TEST_DATA_PROBLEM: 'QA',
  ENVIRONMENT_PROBLEM: 'PROJECT_MANAGER',
  REQUIREMENT_AMBIGUITY: 'PROJECT_MANAGER',
  UNKNOWN: 'QA',
  UNANALYSED: 'QA',
};
const REASON_LABELS = {
  UNANALYSED: 'Not analysed yet', APPLICATION_DEFECT: 'App defect', AUTOMATION_DEFECT: 'Test problem',
  TEST_DATA_PROBLEM: 'Test data problem', ENVIRONMENT_PROBLEM: 'Environment problem',
  REQUIREMENT_AMBIGUITY: 'Unclear requirement', UNKNOWN: 'AI not sure',
};
const ROLE_LABELS = { DEVELOPER: 'Developer', QA: 'QA', PROJECT_MANAGER: 'Project Manager' };

// Other names the analysis can return for the same failure types.
const REASON_ALIASES = { TEST_DEFECT: 'AUTOMATION_DEFECT', TEST_DATA_DEFECT: 'TEST_DATA_PROBLEM', ENVIRONMENT_DEFECT: 'ENVIRONMENT_PROBLEM' };
function reasonOf(classification, confidence) {
  const raw = String(classification || '').toUpperCase();
  const value = REASON_ALIASES[raw] || raw;
  if (!ROLE_BY_REASON[value] || value === 'UNANALYSED') return 'UNKNOWN';
  // A low-confidence answer is treated as "AI not sure", so QA checks it first.
  const c = Number(confidence);
  if (Number.isFinite(c) && (c <= 1 ? c : c / 100) < 0.5) return 'UNKNOWN';
  return value;
}

// Active teams of the project, with the categories each handles (empty = all).
async function projectTeams(client, projectId) {
  return (await client.query(
    `select t.id, t.name, coalesce(pt.handles, '{}') as handles
       from project_teams pt join teams t on t.id = pt.team_id
      where pt.project_id = $1 and pt.is_active = true
      order by pt.created_at, t.name`, [projectId])).rows;
}

function teamFor(teams, category) {
  const cat = String(category || '').toUpperCase();
  return teams.find((t) => (t.handles || []).map((h) => String(h).toUpperCase()).includes(cat))
    || teams.find((t) => !(t.handles || []).length)
    || teams[0] || null;
}

// Members with this role in this project (and in this team when a team is given), fewest open tasks first.
async function leastBusy(client, projectId, role, teamId) {
  const rows = (await client.query(
    `select pm.user_id,
            (select count(*) from work_items w where w.project_id = $1 and w.assigned_to = pm.user_id
               and w.deleted_at is null and w.status = any($4::text[])) as open_tasks
       from project_members pm join users u on u.id = pm.user_id and u.is_active = true
      where pm.project_id = $1 and pm.project_role = $2
        and ($3::uuid is null or exists (select 1 from team_members tm where tm.team_id = $3 and tm.user_id = pm.user_id))
      order by open_tasks asc, pm.created_at asc limit 1`, [projectId, role, teamId || null, OPEN])).rows;
  return rows[0]?.user_id || null;
}

// Returns { teamId, teamName, role, userId, note }.
async function chooseAssignee(client, { projectId, category, reason, fallbackDeveloper }) {
  const teams = await projectTeams(client, projectId);
  const team = teamFor(teams, category);
  const wanted = ROLE_BY_REASON[reason] || 'QA';
  const tries = [[wanted, team?.id]];
  if (wanted !== 'QA') tries.push(['QA', team?.id]);
  for (const [role, teamId] of tries) {
    if (!teamId) break;
    const userId = await leastBusy(client, projectId, role, teamId);
    if (userId) return { teamId: team.id, teamName: team.name, role, userId, note: role === wanted ? null : `No ${ROLE_LABELS[wanted]} in ${team.name}; given to QA.` };
  }
  if (wanted === 'DEVELOPER' && fallbackDeveloper) {
    const ok = (await client.query(
      `select 1 from project_members pm join users u on u.id = pm.user_id
        where pm.project_id = $1 and pm.user_id = $2 and pm.project_role = 'DEVELOPER' and u.is_active = true`, [projectId, fallbackDeveloper])).rowCount;
    if (ok) return { teamId: team?.id || null, teamName: team?.name || null, role: 'DEVELOPER', userId: fallbackDeveloper, note: 'Given to the project\'s fallback developer.' };
  }
  const pm = await leastBusy(client, projectId, 'PROJECT_MANAGER', null);
  if (pm) return { teamId: team?.id || null, teamName: team?.name || null, role: 'PROJECT_MANAGER', userId: pm, note: team ? `No matching member in ${team.name}; given to the Project Manager.` : 'No team is assigned to this project; given to the Project Manager.' };
  return { teamId: team?.id || null, teamName: team?.name || null, role: wanted, userId: null, note: 'No member found to assign.' };
}

module.exports = { chooseAssignee, reasonOf, ROLE_BY_REASON, REASON_LABELS, ROLE_LABELS, OPEN };

// When the AI failure analysis of a run is saved: record the AI reason on each open failed-test task and, while the
// system's assignment still stands, route the task to the role that fits (e.g. App defect -> a Developer of the team).
// Safe to call many times: a task changes only when its AI reason changes.
const WORK_TYPE_BY_REASON = {
  APPLICATION_DEFECT: 'DEFECT_FIX', AUTOMATION_DEFECT: 'TEST_REVIEW', TEST_DATA_PROBLEM: 'TEST_REVIEW',
  ENVIRONMENT_PROBLEM: 'INVESTIGATION', REQUIREMENT_AMBIGUITY: 'INVESTIGATION', UNKNOWN: 'INVESTIGATION',
};
async function applyAnalyses(runId) {
  const db = require('../db');
  if (!db.isConfigured() || !runId) return { routed: 0 };
  return db.withTransaction(async (client) => {
    const rows = (await client.query(
      `select da.id, da.external_case_id, da.classification, da.confidence, tr.project_id, tr.session_id, r.test_category,
              ws.default_developer
         from defect_analyses da
         join test_runs tr on tr.id = da.run_id
         left join test_results r on r.run_id = da.run_id and r.external_case_id = da.external_case_id
         left join project_workflow_settings ws on ws.project_id = tr.project_id
        where da.run_id = $1 and tr.project_id is not null`, [runId])).rows;
    let routed = 0;
    for (const a of rows) {
      const task = (await client.query(
        `select * from work_items where project_id = $1 and session_id = $2 and upper(external_case_id) = upper($3)
            and origin = 'FAILED_TEST' and deleted_at is null and status = any($4::text[])
          order by created_at desc limit 1 for update`, [a.project_id, a.session_id, a.external_case_id, OPEN])).rows[0];
      if (!task) continue;
      const reason = reasonOf(a.classification, a.confidence);
      if (task.metadata?.aiReason === reason && String(task.defect_analysis_id || '') === String(a.id)) continue;
      const metadata = JSON.stringify({ ...(task.metadata || {}), aiReason: reason });
      const systemOwned = task.assigned_by_system || !task.assigned_to;
      if (!systemOwned) {
        await client.query('update work_items set defect_analysis_id = $2, metadata = $3::jsonb, updated_at = now() where id = $1', [task.id, a.id, metadata]);
        await client.query("insert into work_item_history(work_item_id,event_type,old_status,new_status,comment) values($1,'AI_ANALYSED',$2,$2,$3)",
          [task.id, task.status, `AI reason: ${REASON_LABELS[reason]}. Kept the person's assignment.`]);
        routed += 1; continue;
      }
      const pick = await chooseAssignee(client, { projectId: a.project_id, category: a.test_category, reason, fallbackDeveloper: a.default_developer || null });
      // Same role as now: keep the current person (no reshuffling). Different role: the system's new pick.
      const keep = task.assigned_to && task.assigned_role === pick.role;
      const userId = keep ? task.assigned_to : pick.userId;
      await client.query(
        `update work_items set defect_analysis_id = $2, metadata = $3::jsonb, team_id = $4, assigned_role = $5, assigned_to = $6,
                work_type = $7, assigned_by_system = $8, updated_at = now() where id = $1`,
        [task.id, a.id, metadata, pick.teamId, pick.role, userId, WORK_TYPE_BY_REASON[reason] || 'INVESTIGATION', Boolean(userId)]);
      await client.query("insert into work_item_history(work_item_id,event_type,old_status,new_status,comment) values($1,'AI_ROUTED',$2,$2,$3)",
        [task.id, task.status, `AI reason: ${REASON_LABELS[reason]}. ` + (userId ? `Assigned by the system to ${pick.teamName ? pick.teamName + ' · ' : ''}${ROLE_LABELS[pick.role] || pick.role}.` : 'No member found to assign.') + (pick.note && !keep ? ' ' + pick.note : '')]);
      if (userId && String(userId) !== String(task.assigned_to || '')) {
        await client.query("insert into notification_outbox(project_id,user_id,channel,event_type,subject,payload_json,status) values($1,$2,'IN_APP','WORK_ITEM_ASSIGNED',$3,$4::jsonb,'PENDING')",
          [a.project_id, userId, 'Failed test assigned to you: ' + task.title, JSON.stringify({ workItemId: task.id, runId })]);
      }
      routed += 1;
    }
    return { routed };
  });
}
module.exports.applyAnalyses = applyAnalyses;

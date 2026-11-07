// Company-wide teams (Teams page in the top bar): create a team, choose its members, assign it to projects.
// Assigning a team to a project adds its members to the project (source TEAM, role from their account).
// Removing a member from the team, or unassigning the team, removes people who joined only through teams.
const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../services/authService');

const router = express.Router();
const s = (v, n = 1000) => String(v ?? '').trim().slice(0, n);
const isId = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || ''));
const ids = (list) => [...new Set((Array.isArray(list) ? list : []).filter(isId).map(String))];
function fail(status, message) { const e = new Error(message); e.statusCode = status; return e; }
function respond(res, e) { return res.status(e.statusCode || 500).json({ reply: e.statusCode ? e.message : 'Unable to process request.' }); }
const ACCOUNT_TO_PROJECT_ROLE = { DEV: 'DEVELOPER', QA: 'QA', MANAGER: 'PROJECT_MANAGER' };
const LEGACY_ROLE = { PROJECT_MANAGER: 'MANAGER', DEVELOPER: 'DEV', QA: 'QA', VIEWER: 'DEV' };

async function audit(client, projectId, actorId, eventType, metadata) {
  await client.query("insert into project_audit_events(project_id,actor_id,event_type,metadata) values($1,$2,$3,$4::jsonb)", [projectId, actorId, eventType, JSON.stringify(metadata)]);
}

// Bring one project's members in line with the teams assigned to it.
async function syncProject(client, projectId, actorId) {
  const wanted = await client.query(
    `select distinct u.id, u.display_name, u.email, u.role
       from project_teams pt join team_members tm on tm.team_id = pt.team_id
       join users u on u.id = tm.user_id
      where pt.project_id = $1 and u.is_active = true`, [projectId]);
  const wantedIds = new Set(wanted.rows.map((u) => String(u.id)));
  const current = await client.query(
    `select pm.user_id, pm.source, pm.project_role, u.display_name, u.email
       from project_members pm join users u on u.id = pm.user_id where pm.project_id = $1`, [projectId]);
  const currentIds = new Set(current.rows.map((m) => String(m.user_id)));
  for (const u of wanted.rows) {
    if (currentIds.has(String(u.id))) continue;
    const role = ACCOUNT_TO_PROJECT_ROLE[String(u.role || '').toUpperCase()] || 'QA';
    await client.query(
      `insert into project_members(project_id,user_id,role,project_role,added_by,source) values($1,$2,$3,$4,$5,'TEAM')
       on conflict (project_id,user_id) do nothing`, [projectId, u.id, LEGACY_ROLE[role], role, actorId]);
    await audit(client, projectId, actorId, 'MEMBER_ADDED', { userId: u.id, memberName: u.display_name, memberEmail: u.email, projectRole: role, viaTeam: true });
  }
  const managers = current.rows.filter((m) => m.project_role === 'PROJECT_MANAGER').length;
  for (const m of current.rows) {
    if (m.source !== 'TEAM' || wantedIds.has(String(m.user_id))) continue;
    if (m.project_role === 'PROJECT_MANAGER' && managers <= 1) continue; // a project keeps at least one manager
    await client.query('delete from project_members where project_id=$1 and user_id=$2', [projectId, m.user_id]);
    await audit(client, projectId, actorId, 'MEMBER_REMOVED', { userId: m.user_id, memberName: m.display_name, memberEmail: m.email, previousRole: m.project_role, viaTeam: true });
  }
}

async function loadTeam(client, teamId) {
  const t = await client.query('select id,name from teams where id=$1 and project_id is null', [teamId]);
  if (!t.rowCount) throw fail(404, 'Team not found.');
  return t.rows[0];
}
async function projectsOf(client, teamId) {
  return (await client.query('select project_id from project_teams where team_id=$1', [teamId])).rows.map((r) => String(r.project_id));
}

// List: every company team with its members and projects.
router.get('/api/company-teams', requireAuth, requireRole('MANAGER'), async (req, res) => {
  try {
    const teams = await db.query(
      `select t.id, t.name, t.description, t.created_at, t.updated_at, u.display_name created_by_name, uu.display_name updated_by_name
         from teams t left join users u on u.id = t.created_by left join users uu on uu.id = t.updated_by where t.project_id is null order by lower(t.name)`);
    const members = await db.query(
      `select tm.team_id, u.id, u.display_name, u.email, u.role, tm.created_at added_at, ab.display_name added_by_name
         from team_members tm join users u on u.id = tm.user_id left join users ab on ab.id = tm.added_by
        join teams t on t.id = tm.team_id where t.project_id is null order by u.display_name`);
    const projects = await db.query(
      `select pt.team_id, p.id, p.name, p.reference_no, pt.created_at assigned_at, ab.display_name assigned_by_name
         from project_teams pt join projects p on p.id = pt.project_id left join users ab on ab.id = pt.added_by
        join teams t on t.id = pt.team_id where t.project_id is null order by p.name`);
    res.json({
      ok: true,
      teams: teams.rows.map((t) => ({
        ...t,
        members: members.rows.filter((m) => m.team_id === t.id).map(({ team_id, ...m }) => m),
        projects: projects.rows.filter((p) => p.team_id === t.id).map(({ team_id, ...p }) => p),
      })),
    });
  } catch (e) { respond(res, e); }
});

// Create a team, with members and projects in one step.
router.post('/api/company-teams', requireAuth, requireRole('MANAGER'), async (req, res) => {
  try {
    const name = s(req.body?.name, 120);
    if (!name) throw fail(400, 'Team name is required.');
    const team = await db.withTransaction(async (client) => {
      const dup = await client.query('select 1 from teams where project_id is null and lower(name)=lower($1)', [name]);
      if (dup.rowCount) throw fail(409, 'A team with this name already exists.');
      const t = (await client.query('insert into teams(name,description,created_by) values($1,$2,$3) returning id,name', [name, s(req.body?.description) || null, req.user.sub])).rows[0];
      for (const userId of ids(req.body?.memberIds)) await client.query('insert into team_members(team_id,user_id,added_by) select $1,id,$3 from users where id=$2 and is_active=true on conflict do nothing', [t.id, userId, req.user.sub]);
      for (const projectId of ids(req.body?.projectIds)) {
        const ok = await client.query('insert into project_teams(project_id,team_id,added_by) select id,$2,$3 from projects where id=$1 on conflict do nothing returning project_id', [projectId, t.id, req.user.sub]);
        if (ok.rowCount) { await audit(client, projectId, req.user.sub, 'TEAM_ATTACHED', { teamId: t.id, teamName: t.name }); await syncProject(client, projectId, req.user.sub); }
      }
      return t;
    });
    res.status(201).json({ ok: true, team });
  } catch (e) { respond(res, e); }
});

// Edit: name / description, members (full list) and projects (full list). Project members follow.
router.put('/api/company-teams/:teamId', requireAuth, requireRole('MANAGER'), async (req, res) => {
  try {
    if (!isId(req.params.teamId)) throw fail(400, 'Invalid team ID.');
    const name = s(req.body?.name, 120);
    if (!name) throw fail(400, 'Team name is required.');
    await db.withTransaction(async (client) => {
      const team = await loadTeam(client, req.params.teamId);
      const dup = await client.query('select 1 from teams where project_id is null and lower(name)=lower($1) and id<>$2', [name, team.id]);
      if (dup.rowCount) throw fail(409, 'A team with this name already exists.');
      await client.query('update teams set name=$1, description=$2, updated_at=now(), updated_by=$4 where id=$3', [name, s(req.body?.description) || null, team.id, req.user.sub]);
      const before = await projectsOf(client, team.id);
      // members
      const memberIds = ids(req.body?.memberIds);
      await client.query('delete from team_members where team_id=$1 and not (user_id = any($2::uuid[]))', [team.id, memberIds]);
      for (const userId of memberIds) await client.query('insert into team_members(team_id,user_id,added_by) select $1,id,$3 from users where id=$2 and is_active=true on conflict do nothing', [team.id, userId, req.user.sub]);
      // projects
      const projectIds = ids(req.body?.projectIds);
      for (const p of before.filter((p) => !projectIds.includes(p))) {
        await client.query('delete from project_teams where project_id=$1 and team_id=$2', [p, team.id]);
        await audit(client, p, req.user.sub, 'TEAM_DETACHED', { teamId: team.id, teamName: name });
      }
      for (const p of projectIds.filter((p) => !before.includes(p))) {
        const ok = await client.query('insert into project_teams(project_id,team_id,added_by) select id,$2,$3 from projects where id=$1 on conflict do nothing returning project_id', [p, team.id, req.user.sub]);
        if (ok.rowCount) await audit(client, p, req.user.sub, 'TEAM_ATTACHED', { teamId: team.id, teamName: name });
      }
      for (const p of new Set([...before, ...projectIds])) await syncProject(client, p, req.user.sub);
    });
    res.json({ ok: true });
  } catch (e) { respond(res, e); }
});

// Delete: unassign from all projects (their team-only members leave), then delete.
router.delete('/api/company-teams/:teamId', requireAuth, requireRole('MANAGER'), async (req, res) => {
  try {
    if (!isId(req.params.teamId)) throw fail(400, 'Invalid team ID.');
    await db.withTransaction(async (client) => {
      const team = await loadTeam(client, req.params.teamId);
      const projects = await projectsOf(client, team.id);
      await client.query('delete from teams where id=$1', [team.id]);
      for (const p of projects) { await audit(client, p, req.user.sub, 'TEAM_DETACHED', { teamId: team.id, teamName: team.name }); await syncProject(client, p, req.user.sub); }
    });
    res.json({ ok: true });
  } catch (e) { respond(res, e); }
});

// Project Team tab: which company teams each member is in (and which teams are assigned to the project).
router.get('/api/projects/:projectId/member-teams', requireAuth, async (req, res) => {
  try {
    if (!isId(req.params.projectId)) throw fail(400, 'Invalid project ID.');
    if (String(req.user.role).toUpperCase() !== 'MANAGER') {
      const m = await db.query('select 1 from project_members where project_id=$1 and user_id=$2', [req.params.projectId, req.user.sub]);
      if (!m.rowCount) throw fail(403, 'Not a member of this project.');
    }
    const assigned = await db.query('select t.id,t.name from project_teams pt join teams t on t.id=pt.team_id where pt.project_id=$1 order by t.name', [req.params.projectId]);
    const rows = await db.query(
      `select pm.user_id, pm.source, t.name, (pt.team_id is not null) assigned
         from project_members pm join team_members tm on tm.user_id = pm.user_id join teams t on t.id = tm.team_id and t.project_id is null
         left join project_teams pt on pt.team_id = t.id and pt.project_id = pm.project_id
        where pm.project_id = $1 order by t.name`, [req.params.projectId]);
    res.json({ ok: true, assignedTeams: assigned.rows, memberships: rows.rows });
  } catch (e) { respond(res, e); }
});

module.exports = router;

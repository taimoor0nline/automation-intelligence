const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../services/authService');

const PROJECT_ROLES = new Set(['PROJECT_MANAGER','QA','DEVELOPER','VIEWER']);
const WORK_TYPES = new Set(['TEST_REVIEW','DEFECT_FIX','RETEST','INVESTIGATION','MANUAL_TEST','GENERAL']);
const WORK_STATUSES = new Set(['PENDING','IN_PROGRESS','ON_HOLD','READY_FOR_RETEST','COMPLETED','CANCELLED']);
const PRIORITIES = new Set(['LOW','MEDIUM','HIGH','CRITICAL']);

function clean(value, max = 2000) { return String(value ?? '').trim().slice(0, max); }
function uuid(value) { const v = clean(value, 100); return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v) ? v : null; }
function mapLegacyRole(role) { return role === 'PROJECT_MANAGER' ? 'MANAGER' : role === 'DEVELOPER' ? 'DEV' : role === 'QA' ? 'QA' : 'DEV'; }

async function membership(projectId, userId) {
  const result = await db.query('select pm.*,u.email,u.display_name from project_members pm join users u on u.id=pm.user_id where pm.project_id=$1 and pm.user_id=$2 and u.is_active=true', [projectId,userId]);
  return result.rows[0] || null;
}
async function assertProjectAccess(req, projectId) {
  const role = String(req.user?.role || '').toUpperCase();
  if (role === 'MANAGER') return { project_role: 'PROJECT_MANAGER', platformManager: true };
  const member = await membership(projectId, req.user?.sub);
  if (!member) { const e = new Error('You do not have access to this project.'); e.statusCode = 403; throw e; }
  return member;
}
async function assertProjectManager(req, projectId) {
  const member = await assertProjectAccess(req, projectId);
  if (!member.platformManager && String(member.project_role || '').toUpperCase() !== 'PROJECT_MANAGER') {
    const e = new Error('Project Manager role is required.'); e.statusCode = 403; throw e;
  }
  return member;
}
async function addHistory(client, workItemId, eventType, oldStatus, newStatus, performedBy, comment = '', metadata = {}) {
  await client.query('insert into work_item_history(work_item_id,event_type,old_status,new_status,performed_by,comment,metadata) values($1,$2,$3,$4,$5,$6,$7::jsonb)', [workItemId,eventType,oldStatus||null,newStatus||null,performedBy||null,clean(comment,4000)||null,JSON.stringify(metadata||{})]);
}
async function enqueueNotification(client, { projectId, userId, eventType, subject, payload }) {
  if (!userId) return;
  await client.query("insert into notification_outbox(project_id,user_id,channel,event_type,subject,payload_json,status) values($1,$2,'IN_APP',$3,$4,$5::jsonb,'PENDING')", [projectId,userId,eventType,clean(subject,500),JSON.stringify(payload||{})]);
}

router.get('/api/projects/:projectId/members', requireAuth, async (req,res) => {
  try {
    await assertProjectAccess(req, req.params.projectId);
    const result = await db.query(`select pm.user_id,pm.project_role,pm.role as legacy_role,pm.created_at,u.email,u.display_name,u.is_active
      from project_members pm join users u on u.id=pm.user_id where pm.project_id=$1 order by case pm.project_role when 'PROJECT_MANAGER' then 1 when 'QA' then 2 when 'DEVELOPER' then 3 else 4 end,u.display_name`, [req.params.projectId]);
    res.json({ ok:true, members:result.rows });
  } catch(err) { res.status(err.statusCode||500).json({ reply:err.message }); }
});

router.post('/api/projects/:projectId/members', requireAuth, async (req,res) => {
  try {
    await assertProjectManager(req, req.params.projectId);
    const userId = uuid(req.body?.userId);
    const projectRole = clean(req.body?.projectRole,50).toUpperCase();
    if (!userId) return res.status(400).json({ reply:'Valid userId is required.' });
    if (!PROJECT_ROLES.has(projectRole)) return res.status(400).json({ reply:'projectRole must be PROJECT_MANAGER, QA, DEVELOPER, or VIEWER.' });
    const user = await db.query('select id,email,display_name,is_active from users where id=$1 and is_active=true',[userId]);
    if (!user.rowCount) return res.status(404).json({ reply:'Active user not found.' });
    await db.query(`insert into project_members(project_id,user_id,role,project_role) values($1,$2,$3,$4)
      on conflict(project_id,user_id) do update set role=excluded.role,project_role=excluded.project_role`, [req.params.projectId,userId,mapLegacyRole(projectRole),projectRole]);
    res.status(201).json({ ok:true, member:{ ...user.rows[0], project_role:projectRole } });
  } catch(err) { res.status(err.statusCode||500).json({ reply:err.message }); }
});

router.patch('/api/projects/:projectId/members/:userId', requireAuth, async (req,res) => {
  try {
    await assertProjectManager(req, req.params.projectId);
    const projectRole = clean(req.body?.projectRole,50).toUpperCase();
    if (!PROJECT_ROLES.has(projectRole)) return res.status(400).json({ reply:'Invalid projectRole.' });
    const result = await db.query('update project_members set role=$1,project_role=$2 where project_id=$3 and user_id=$4 returning *',[mapLegacyRole(projectRole),projectRole,req.params.projectId,req.params.userId]);
    if (!result.rowCount) return res.status(404).json({ reply:'Project member not found.' });
    res.json({ ok:true, member:result.rows[0] });
  } catch(err) { res.status(err.statusCode||500).json({ reply:err.message }); }
});

router.delete('/api/projects/:projectId/members/:userId', requireAuth, async (req,res) => {
  try {
    await assertProjectManager(req, req.params.projectId);
    const managerCount = await db.query("select count(*)::int n from project_members where project_id=$1 and project_role='PROJECT_MANAGER'",[req.params.projectId]);
    const target = await membership(req.params.projectId, req.params.userId);
    if (!target) return res.status(404).json({ reply:'Project member not found.' });
    if (target.project_role === 'PROJECT_MANAGER' && managerCount.rows[0].n <= 1) return res.status(409).json({ reply:'A project must retain at least one Project Manager.' });
    await db.query('delete from project_members where project_id=$1 and user_id=$2',[req.params.projectId,req.params.userId]);
    res.json({ ok:true });
  } catch(err) { res.status(err.statusCode||500).json({ reply:err.message }); }
});

router.get('/api/projects/:projectId/work-summary', requireAuth, async (req,res) => {
  try {
    await assertProjectAccess(req, req.params.projectId);
    const status = await db.query('select status,count(*)::int count from work_items where project_id=$1 group by status',[req.params.projectId]);
    const type = await db.query('select work_type,count(*)::int count from work_items where project_id=$1 group by work_type',[req.params.projectId]);
    const overdue = await db.query("select count(*)::int count from work_items where project_id=$1 and due_at<now() and status not in ('COMPLETED','CANCELLED')",[req.params.projectId]);
    res.json({ ok:true, byStatus:Object.fromEntries(status.rows.map(x=>[x.status,x.count])), byType:Object.fromEntries(type.rows.map(x=>[x.work_type,x.count])), overdue:overdue.rows[0].count });
  } catch(err) { res.status(err.statusCode||500).json({ reply:err.message }); }
});

router.get('/api/projects/:projectId/work-items', requireAuth, async (req,res) => {
  try {
    const member = await assertProjectAccess(req, req.params.projectId);
    const conditions=['w.project_id=$1']; const values=[req.params.projectId];
    const projectRole=String(member.project_role||'').toUpperCase();
    if (!member.platformManager && projectRole==='DEVELOPER') { values.push(req.user.sub); conditions.push(`w.assigned_to=$${values.length}`); }
    if (req.query.status) { values.push(clean(req.query.status,50).toUpperCase()); conditions.push(`w.status=$${values.length}`); }
    if (req.query.assignedTo) { values.push(req.query.assignedTo); conditions.push(`w.assigned_to=$${values.length}`); }
    if (req.query.workType) { values.push(clean(req.query.workType,50).toUpperCase()); conditions.push(`w.work_type=$${values.length}`); }
    const result=await db.query(`select w.*,u.display_name assigned_to_name,u.email assigned_to_email,ab.display_name assigned_by_name
      from work_items w left join users u on u.id=w.assigned_to left join users ab on ab.id=w.assigned_by
      where ${conditions.join(' and ')} order by case w.status when 'IN_PROGRESS' then 1 when 'READY_FOR_RETEST' then 2 when 'PENDING' then 3 when 'ON_HOLD' then 4 else 5 end,w.updated_at desc limit 500`,values);
    res.json({ ok:true, workItems:result.rows });
  } catch(err) { res.status(err.statusCode||500).json({ reply:err.message }); }
});

router.get('/api/my-work-items', requireAuth, async (req,res) => {
  try {
    const result=await db.query(`select w.*,p.name project_name from work_items w join projects p on p.id=w.project_id where w.assigned_to=$1 order by w.updated_at desc limit 500`,[req.user.sub]);
    res.json({ ok:true, workItems:result.rows });
  } catch(err) { res.status(500).json({ reply:err.message }); }
});

router.post('/api/projects/:projectId/work-items', requireAuth, async (req,res) => {
  try {
    const member = await assertProjectAccess(req, req.params.projectId);
    const role=String(member.project_role||'').toUpperCase();
    if (!member.platformManager && !['PROJECT_MANAGER','QA'].includes(role)) return res.status(403).json({ reply:'Project Manager or QA role is required to create work items.' });
    const workType=clean(req.body?.workType,50).toUpperCase()||'GENERAL'; const priority=clean(req.body?.priority,50).toUpperCase()||'MEDIUM';
    if (!WORK_TYPES.has(workType)) return res.status(400).json({ reply:'Invalid workType.' });
    if (!PRIORITIES.has(priority)) return res.status(400).json({ reply:'Invalid priority.' });
    const title=clean(req.body?.title,500); if(!title) return res.status(400).json({ reply:'Title is required.' });
    const assignedTo=uuid(req.body?.assignedTo);
    if (assignedTo && !(await membership(req.params.projectId,assignedTo))) return res.status(400).json({ reply:'Assigned user must be an active member of this project.' });
    const item=await db.withTransaction(async client=>{
      const inserted=await client.query(`insert into work_items(project_id,session_id,run_id,test_case_id,test_result_id,defect_analysis_id,external_case_id,work_type,title,description,status,priority,assigned_to,assigned_by,created_by,due_at,metadata)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'PENDING',$11,$12,$13,$13,$14,$15::jsonb) returning *`,[req.params.projectId,req.body?.sessionId||null,uuid(req.body?.runId),uuid(req.body?.testCaseId),uuid(req.body?.testResultId),uuid(req.body?.defectAnalysisId),clean(req.body?.externalCaseId,100)||null,workType,title,clean(req.body?.description,10000)||null,priority,assignedTo,req.user.sub,req.body?.dueAt||null,JSON.stringify(req.body?.metadata||{})]);
      const row=inserted.rows[0];
      await addHistory(client,row.id,'WORK_ITEM_CREATED',null,'PENDING',req.user.sub,'',{ workType,assignedTo });
      if(assignedTo) await enqueueNotification(client,{projectId:req.params.projectId,userId:assignedTo,eventType:'WORK_ITEM_ASSIGNED',subject:`Assigned: ${title}`,payload:{workItemId:row.id,externalCaseId:row.external_case_id,status:row.status}});
      return row;
    });
    res.status(201).json({ ok:true, workItem:item });
  } catch(err) { res.status(err.statusCode||500).json({ reply:err.message }); }
});

router.patch('/api/work-items/:id/assign', requireAuth, async (req,res) => {
  try {
    const existing=await db.query('select * from work_items where id=$1',[req.params.id]); if(!existing.rowCount)return res.status(404).json({reply:'Work item not found.'});
    await assertProjectManager(req,existing.rows[0].project_id);
    const assignedTo=uuid(req.body?.assignedTo); if(assignedTo && !(await membership(existing.rows[0].project_id,assignedTo))) return res.status(400).json({reply:'Assigned user must be an active project member.'});
    const item=await db.withTransaction(async client=>{const r=await client.query('update work_items set assigned_to=$1,assigned_by=$2,updated_at=now() where id=$3 returning *',[assignedTo,req.user.sub,req.params.id]);await addHistory(client,req.params.id,assignedTo?'WORK_ITEM_ASSIGNED':'WORK_ITEM_UNASSIGNED',existing.rows[0].status,existing.rows[0].status,req.user.sub,req.body?.comment||'',{assignedTo});if(assignedTo)await enqueueNotification(client,{projectId:existing.rows[0].project_id,userId:assignedTo,eventType:'WORK_ITEM_ASSIGNED',subject:`Assigned: ${existing.rows[0].title}`,payload:{workItemId:req.params.id,status:existing.rows[0].status}});return r.rows[0]});
    res.json({ok:true,workItem:item});
  } catch(err){res.status(err.statusCode||500).json({reply:err.message});}
});

router.patch('/api/work-items/:id/status', requireAuth, async (req,res) => {
  try {
    const existing=await db.query('select * from work_items where id=$1',[req.params.id]); if(!existing.rowCount)return res.status(404).json({reply:'Work item not found.'}); const item=existing.rows[0];
    const member=await assertProjectAccess(req,item.project_id); const projectRole=String(member.project_role||'').toUpperCase(); const next=clean(req.body?.status,50).toUpperCase(); if(!WORK_STATUSES.has(next))return res.status(400).json({reply:'Invalid work-item status.'});
    const isAssignee=String(item.assigned_to||'')===String(req.user.sub||''); const canManage=member.platformManager||['PROJECT_MANAGER','QA'].includes(projectRole);
    if(!canManage&&!isAssignee)return res.status(403).json({reply:'Only the assignee, Project Manager, or QA can change this work item.'});
    if(projectRole==='DEVELOPER'&&next==='COMPLETED')return res.status(409).json({reply:'Developers move fixes to READY_FOR_RETEST. COMPLETED is set after QA/system verification.'});
    const updated=await db.withTransaction(async client=>{const r=await client.query(`update work_items set status=$1,started_at=case when $1='IN_PROGRESS' and started_at is null then now() else started_at end,completed_at=case when $1='COMPLETED' then now() when status='COMPLETED' and $1<>'COMPLETED' then null else completed_at end,updated_at=now() where id=$2 returning *`,[next,item.id]);await addHistory(client,item.id,'STATUS_CHANGED',item.status,next,req.user.sub,req.body?.comment||'');if(next==='READY_FOR_RETEST'){const qa=await client.query("select user_id from project_members where project_id=$1 and project_role in ('QA','PROJECT_MANAGER')",[item.project_id]);for(const x of qa.rows)await enqueueNotification(client,{projectId:item.project_id,userId:x.user_id,eventType:'READY_FOR_RETEST',subject:`Ready for retest: ${item.title}`,payload:{workItemId:item.id,externalCaseId:item.external_case_id}});}return r.rows[0]});
    res.json({ok:true,workItem:updated});
  } catch(err){res.status(err.statusCode||500).json({reply:err.message});}
});

router.get('/api/work-items/:id', requireAuth, async (req,res) => {
  try { const r=await db.query(`select w.*,p.name project_name,u.display_name assigned_to_name,u.email assigned_to_email from work_items w join projects p on p.id=w.project_id left join users u on u.id=w.assigned_to where w.id=$1`,[req.params.id]); if(!r.rowCount)return res.status(404).json({reply:'Work item not found.'}); await assertProjectAccess(req,r.rows[0].project_id); const h=await db.query('select h.*,u.display_name performed_by_name from work_item_history h left join users u on u.id=h.performed_by where h.work_item_id=$1 order by h.created_at',[req.params.id]); const c=await db.query('select c.*,u.display_name user_name from work_item_comments c left join users u on u.id=c.user_id where c.work_item_id=$1 order by c.created_at',[req.params.id]); res.json({ok:true,workItem:r.rows[0],history:h.rows,comments:c.rows}); } catch(err){res.status(err.statusCode||500).json({reply:err.message});}
});

router.post('/api/work-items/:id/comments', requireAuth, async (req,res) => {
  try { const item=await db.query('select * from work_items where id=$1',[req.params.id]); if(!item.rowCount)return res.status(404).json({reply:'Work item not found.'}); await assertProjectAccess(req,item.rows[0].project_id); const comment=clean(req.body?.comment,10000); if(!comment)return res.status(400).json({reply:'Comment is required.'}); const c=await db.withTransaction(async client=>{const r=await client.query('insert into work_item_comments(work_item_id,user_id,comment) values($1,$2,$3) returning *',[req.params.id,req.user.sub,comment]);await addHistory(client,req.params.id,'COMMENT_ADDED',item.rows[0].status,item.rows[0].status,req.user.sub,comment);return r.rows[0]}); res.status(201).json({ok:true,comment:c}); } catch(err){res.status(err.statusCode||500).json({reply:err.message});}
});

router.get('/api/notifications', requireAuth, async (req,res) => {
  try { const r=await db.query("select * from notification_outbox where user_id=$1 and status in ('PENDING','SENT') order by created_at desc limit 100",[req.user.sub]); res.json({ok:true,notifications:r.rows}); } catch(err){res.status(500).json({reply:err.message});}
});

module.exports = router;

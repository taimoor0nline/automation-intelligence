'use strict';
const express=require('express');
const db=require('../db');
const {requireAuth,requireRole}=require('../services/authService');
const {getSession}=require('../data/sessionStore');
const fs=require('fs');
const path=require('path');
const {ROOT:ARTIFACT_ROOT}=require('../services/retainedExecutionEvidence');
const router=express.Router();
const MAX_FILE=5*1024*1024;
const TYPES=new Set(['application/pdf','text/plain','text/csv','image/png','image/jpeg','image/webp','application/zip',
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
 'application/msword','application/vnd.ms-excel']);
const id=v=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v||''));
const s=(v,n=4000)=>String(v??'').trim().slice(0,n);
const fail=(code,message)=>Object.assign(new Error(message),{statusCode:code});
function respond(res,e){return res.status(e.statusCode||500).json({reply:e.statusCode?e.message:'Unable to process request.'});}
async function access(req,projectId) {
 if(!id(projectId))throw fail(400,'Invalid project ID.');
 const project=await db.query('select * from projects where id=$1',[projectId]);
 if(!project.rowCount)throw fail(404,'Project not found.');
 if(String(req.user.role).toUpperCase()==='MANAGER')return {project:project.rows[0],role:'PROJECT_MANAGER'};
 const membership=await db.query('select project_role from project_members where project_id=$1 and user_id=$2',[projectId,req.user.sub]);
 if(!membership.rowCount)throw fail(403,'Not a member of this project.');
 return {project:project.rows[0],role:membership.rows[0].project_role||'VIEWER'};
}
function manager(role){if(role!=='PROJECT_MANAGER')throw fail(403,'Project manager permission required.');}
function reviewer(role){if(!['PROJECT_MANAGER','QA'].includes(role))throw fail(403,'Project QA or manager permission required.');}
function parseFile(body) {
 const filename=s(body?.filename,180).replace(/[\\/]/g,'_').replace(/[\u0000-\u001f]/g,'').trim();
 const mime=s(body?.mimeType,150).toLowerCase();
 if(!filename || !TYPES.has(mime))throw fail(400,'Filename or permitted file type is missing.');
 const base64=String(body?.base64||'');
 if(!base64 || base64.length>Math.ceil(MAX_FILE/3)*4+4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64))throw fail(413,'Invalid or oversized file.');
 const buf=Buffer.from(base64,'base64');
 if(!buf.length || buf.length>MAX_FILE || buf.toString('base64')!==base64)throw fail(413,'File cannot exceed 5 MB.');
 return {filename,mime,buf};
}
function download(res,row){
 res.set('Content-Type',row.mime_type);
 res.set('X-Content-Type-Options','nosniff');
 res.set('Cache-Control','private, no-store');
 res.set('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(row.filename));
 return res.send(row.file_data);
}
router.get('/api/projects/:projectId/workspace',requireAuth,async(req,res)=>{
 try {
 const ctx=await access(req,req.params.projectId);
 const [envs,stories,docs,team,runs]=await Promise.all([
 db.query('select id,name,base_url,stage_type,is_default,created_at from project_environments where project_id=$1 order by is_default desc,name',[req.params.projectId]),
 db.query('select s.*,u.display_name created_by_name from project_stories s left join users u on u.id=s.created_by where s.project_id=$1 order by s.updated_at desc limit 200',[req.params.projectId]),
 db.query('select id,filename,mime_type,category,file_size,version,uploaded_by,created_at from project_documents where project_id=$1 order by created_at desc limit 200',[req.params.projectId]),
 db.query('select pm.user_id,pm.project_role,u.display_name,u.email from project_members pm join users u on u.id=pm.user_id where pm.project_id=$1 and u.is_active=true order by u.display_name',[req.params.projectId]),
 db.query('select r.id,r.session_id,r.run_number,r.total,r.passed,r.failed,r.duration_ms,r.completed_at,t.environment,u.display_name executed_by_name from test_runs r left join test_sessions t on t.id=r.session_id left join users u on u.id=r.executed_by where r.project_id=$1 order by r.completed_at desc limit 50',[req.params.projectId])
 ]);
 res.json({ok:true,project:ctx.project,projectRole:ctx.role,environments:envs.rows,stories:stories.rows,documents:docs.rows,members:team.rows,runs:runs.rows});
 }catch(e){respond(res,e);}
});
router.patch('/api/projects/:projectId/profile',requireAuth,async(req,res)=>{
 try{
 const ctx=await access(req,req.params.projectId);manager(ctx.role);
 const fields={name:120,referenceNo:80,description:3000,objectives:6000,scopeIn:10000,scopeOut:6000,businessRules:10000,acceptanceCriteria:10000,targetUrl:1200,technologyStack:1000};
 const column={referenceNo:'reference_no',scopeIn:'scope_in',scopeOut:'scope_out',businessRules:'business_rules',acceptanceCriteria:'acceptance_criteria',targetUrl:'target_url',technologyStack:'technology_stack'};
 let updates=[],values=[];
 for(const [key,max] of Object.entries(fields)){if(Object.prototype.hasOwnProperty.call(req.body||{},key)){values.push(s(req.body[key],max)||null);updates.push((column[key]||key)+'=$'+values.length);}}
 for(const key of ['startDate','endDate'])if(Object.prototype.hasOwnProperty.call(req.body||{},key)){
 const val=req.body[key];if(val && !/^\d{4}-\d{2}-\d{2}$/.test(String(val)))throw fail(400,'Invalid date.');
 values.push(val||null);updates.push((key==='startDate'?'start_date':'end_date')+'=$'+values.length);
 }
 if(!updates.length)throw fail(400,'No project fields supplied.');
 values.push(req.params.projectId);
 const updated=await db.query('update projects set '+updates.join(',')+',updated_at=now() where id=$'+values.length+' returning *',values);
 res.json({ok:true,project:updated.rows[0]});
 }catch(e){respond(res,e);}
});
router.post('/api/projects/:projectId/environments',requireAuth,async(req,res)=>{
 try{
 const ctx=await access(req,req.params.projectId);manager(ctx.role);
 const name=s(req.body?.name,100),base=s(req.body?.baseUrl,1500);
 if(!name || !/^https?:\/\//i.test(base))throw fail(400,'Name and HTTP(S) base URL are required.');
 const stage=s(req.body?.stageType,30)||'QA',def=Boolean(req.body?.isDefault);
 const inserted=await db.withTransaction(async client=>{
 if(def)await client.query('update project_environments set is_default=false where project_id=$1',[req.params.projectId]);
 return client.query('insert into project_environments(project_id,name,base_url,stage_type,is_default,created_by) values($1,$2,$3,$4,$5,$6) returning *',[req.params.projectId,name,base,stage,def,req.user.sub]);
 });
 res.status(201).json({ok:true,environment:inserted.rows[0]});
 }catch(e){respond(res,e);}
});
router.post('/api/projects/:projectId/stories',requireAuth,async(req,res)=>{
 try{
 const ctx=await access(req,req.params.projectId);reviewer(ctx.role);
 const title=s(req.body?.title,250),story=s(req.body?.story,12000);
 if(!title || !story)throw fail(400,'Story title and business story are required.');
 const eid=req.body?.environmentId||null;
 if(eid){const env=await db.query('select 1 from project_environments where id=$1 and project_id=$2',[eid,req.params.projectId]);if(!env.rowCount)throw fail(400,'Environment does not belong to project.');}
 const result=await db.query('insert into project_stories(project_id,environment_id,reference_no,title,story,acceptance_criteria,page_paths,priority,created_by,updated_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) returning *',
 [req.params.projectId,eid,s(req.body?.referenceNo,70)||null,title,story,s(req.body?.acceptanceCriteria,8000)||null,s(req.body?.pagePaths,1500)||null,s(req.body?.priority,20)||'MEDIUM',req.user.sub]);
 res.status(201).json({ok:true,story:result.rows[0]});
 }catch(e){respond(res,e);}
});
router.patch('/api/projects/:projectId/stories/:storyId',requireAuth,async(req,res)=>{
 try{
 const ctx=await access(req,req.params.projectId);reviewer(ctx.role);
 const existing=await db.query('select * from project_stories where id=$1 and project_id=$2',[req.params.storyId,req.params.projectId]);
 if(!existing.rowCount)throw fail(404,'Story not found.');
 const old=existing.rows[0],b=req.body||{},updated=await db.query('update project_stories set title=$1,story=$2,acceptance_criteria=$3,page_paths=$4,priority=$5,updated_by=$6,updated_at=now() where id=$7 and project_id=$8 returning *',
 [s(b.title??old.title,250),s(b.story??old.story,12000),s(b.acceptanceCriteria??old.acceptance_criteria,8000),s(b.pagePaths??old.page_paths,1500),s(b.priority??old.priority,20),req.user.sub,req.params.storyId,req.params.projectId]);
 res.json({ok:true,story:updated.rows[0]});
 }catch(e){respond(res,e);}
});
router.post('/api/projects/:projectId/documents',requireAuth,async(req,res)=>{
 try{
 const ctx=await access(req,req.params.projectId);reviewer(ctx.role);
 const f=parseFile(req.body);
 const r=await db.query('insert into project_documents(project_id,filename,mime_type,category,file_size,file_data,version,uploaded_by) values($1,$2,$3,$4,$5,$6,$7,$8) returning id,filename,mime_type,category,file_size,version,created_at',
 [req.params.projectId,f.filename,f.mime,s(req.body?.category,50)||'OTHER',f.buf.length,f.buf,s(req.body?.version,30)||'1.0',req.user.sub]);
 res.status(201).json({ok:true,document:r.rows[0]});
 }catch(e){respond(res,e);}
});
router.get('/api/projects/:projectId/documents/:documentId/download',requireAuth,async(req,res)=>{
 try{
 await access(req,req.params.projectId);
 const d=await db.query('select filename,mime_type,file_data from project_documents where id=$1 and project_id=$2',[req.params.documentId,req.params.projectId]);
 if(!d.rowCount)throw fail(404,'Document not found.');
 download(res,d.rows[0]);
 }catch(e){respond(res,e);}
});
router.get('/api/projects/:projectId/evidence',requireAuth,async(req,res)=>{
 try{
 await access(req,req.params.projectId);
 const r=await db.query('select tr.session_id,tr.run_number,tr.completed_at,tr.executed_by,te.external_case_id,te.title,te.passed,te.evidence_json from test_results te join test_runs tr on tr.id=te.run_id where tr.project_id=$1 order by tr.completed_at desc limit 150',[req.params.projectId]);
 res.json({ok:true,results:r.rows});
 }catch(e){respond(res,e);}
});

router.get('/api/projects/:projectId/run-evidence/:runId/:caseId/:kind',requireAuth,async(req,res)=>{
 try{
 await access(req,req.params.projectId);
 const kind=s(req.params.kind,20);
 if(!id(req.params.runId)||!['screenshot','video'].includes(kind))throw fail(400,'Invalid evidence request.');
 const r=await db.query('select ev.relative_path,ev.mime_type from test_run_evidence ev join test_runs tr on tr.id=ev.run_id where ev.run_id=$1 and ev.external_case_id=$2 and ev.kind=$3 and tr.project_id=$4',[req.params.runId,req.params.caseId,kind,req.params.projectId]);
 if(!r.rowCount)throw fail(404,'Run evidence not found.');
 const filename=path.resolve(ARTIFACT_ROOT,r.rows[0].relative_path);
 if(!filename.startsWith(ARTIFACT_ROOT+path.sep) || !r.rows[0].relative_path.startsWith('run-evidence'+path.sep))throw fail(403,'Invalid evidence path.');
 await fs.promises.access(filename,fs.constants.R_OK);
 res.set('X-Content-Type-Options','nosniff');res.set('Cache-Control','private, no-store');res.type(r.rows[0].mime_type);
 return res.sendFile(filename);
 }catch(e){respond(res,e);}
});

async function task(req){
 if(!id(req.params.id))throw fail(400,'Invalid task ID.');
 const r=await db.query('select * from work_items where id=$1',[req.params.id]);
 if(!r.rowCount)throw fail(404,'Task not found.');
 const ctx=await access(req,r.rows[0].project_id);
 if(ctx.role==='DEVELOPER' && String(r.rows[0].assigned_to)!==String(req.user.sub))throw fail(403,'Task is not assigned to you.');
 return {item:r.rows[0],role:ctx.role};
}
router.get('/api/work-items/:id/details',requireAuth,async(req,res)=>{
 try{
 const ctx=await task(req);
 const closer=ctx.item.closed_by?await db.query('select display_name from users where id=$1',[ctx.item.closed_by]):null;
 const [children,attachments,history,comments]=await Promise.all([
 db.query('select id,title,status,priority,assigned_to,eta_at,completed_at from work_items where parent_work_item_id=$1 and deleted_at is null order by created_at',[req.params.id]),
 db.query('select id,filename,mime_type,file_size,created_at from work_item_attachments where work_item_id=$1 order by created_at desc',[req.params.id]),
 db.query('select event_type,old_status,new_status,comment,created_at,u.display_name by_name from work_item_history h left join users u on u.id=h.performed_by where work_item_id=$1 order by created_at desc limit 100',[req.params.id]),
 db.query('select c.id,c.comment,c.created_at,u.display_name user_name from work_item_comments c left join users u on u.id=c.user_id where work_item_id=$1 order by c.created_at',[req.params.id])
 ]);
 const parent=ctx.item.parent_work_item_id?(await db.query('select id,title,status from work_items where id=$1 and project_id=$2 and deleted_at is null',[ctx.item.parent_work_item_id,ctx.item.project_id])).rows[0]||null:null;
 res.json({ok:true,parent,task:{...ctx.item,closed_by_name:closer?.rows?.[0]?.display_name||null},subtasks:children.rows,attachments:attachments.rows,history:history.rows,comments:comments.rows,projectRole:ctx.role});
 }catch(e){respond(res,e);}
});
router.post('/api/work-items/:id/subtasks',requireAuth,async(req,res)=>{
 try{
 const ctx=await task(req);reviewer(ctx.role);
 const title=s(req.body?.title,450);
 if(!title)throw fail(400,'Subtask title is required.');
 const assignee=req.body?.assignedTo||null;
 if(assignee){const m=await db.query('select 1 from project_members where project_id=$1 and user_id=$2',[ctx.item.project_id,assignee]);if(!m.rowCount)throw fail(400,'Assignee must belong to this project.');}
 const r=await db.withTransaction(async client=>{
 const t=await client.query('insert into work_items(project_id,parent_work_item_id,session_id,external_case_id,work_type,title,description,priority,assigned_to,created_by,assigned_by,due_at,eta_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$12) returning *',
 [ctx.item.project_id,ctx.item.id,ctx.item.session_id,ctx.item.external_case_id,'GENERAL',title,s(req.body?.description,4000)||null,s(req.body?.priority,15)||'MEDIUM',assignee,req.user.sub,req.body?.dueAt||null,req.body?.etaAt||null]);
 await client.query('insert into work_item_history(work_item_id,event_type,new_status,performed_by,comment) values($1,$2,$3,$4,$5)',[ctx.item.id,'SUBTASK_CREATED',ctx.item.status,req.user.sub,title]);
 return t.rows[0];
 });
 res.status(201).json({ok:true,subtask:r});
 }catch(e){respond(res,e);}
});
router.patch('/api/work-items/:id/lifecycle',requireAuth,async(req,res)=>{
 try{
 const ctx=await task(req),item=ctx.item,action=s(req.body?.action,30).toUpperCase();
 const isManager=ctx.role==='PROJECT_MANAGER',isQA=ctx.role==='QA',isAssignee=String(item.assigned_to||'')===String(req.user.sub);
 if(!isManager && !isQA && !(action==='ETA' && isAssignee))throw fail(403,'Only project manager/QA can change lifecycle.');
 const sets=[],params=[];const put=(column,value)=>{params.push(value);sets.push(column+'=$'+params.length);};
 if(action==='ETA'){put('eta_at',req.body?.etaAt||null);}
 else if(action==='DEFER'){if(!req.body?.deferredUntil || !s(req.body?.reason,1000))throw fail(400,'Deferral date and reason required.');put('status','ON_HOLD');put('deferred_until',req.body.deferredUntil);put('deferred_reason',s(req.body.reason,1000));}
 else if(action==='REOPEN'){put('status','PENDING');put('closed_at',null);put('closed_by',null);put('deferred_until',null);put('deferred_reason',null);}
 else if(action==='CLOSE'){if(ctx.role==='DEVELOPER')throw fail(403,'Developer cannot close task.');put('status','COMPLETED');put('completed_at',new Date());put('closed_at',new Date());put('closed_by',req.user.sub);}
 else if(action==='DELETE'){if(!isManager)throw fail(403,'Project manager required to delete.');put('deleted_at',new Date());put('deleted_by',req.user.sub);}
 else if(action==='RESTORE'){if(!isManager)throw fail(403,'Project manager required to restore.');put('deleted_at',null);put('deleted_by',null);}
 else throw fail(400,'Unsupported lifecycle action.');
 params.push(item.id);const changed=await db.withTransaction(async client=>{
 const row=await client.query('update work_items set '+sets.join(',')+',updated_at=now() where id=$'+params.length+' returning *',params);
 await client.query('insert into work_item_history(work_item_id,event_type,old_status,new_status,performed_by,comment) values($1,$2,$3,$4,$5,$6)',[item.id,'TASK_'+action,item.status,row.rows[0].status,req.user.sub,s(req.body?.reason||req.body?.comment,1000)||null]);
 return row.rows[0];
 });
 res.json({ok:true,task:changed});
 }catch(e){respond(res,e);}
});
router.post('/api/work-items/:id/attachments',requireAuth,async(req,res)=>{
 try{
 const ctx=await task(req);if(ctx.item.deleted_at)throw fail(409,'Restore this task before attaching files.');
 const f=parseFile(req.body),r=await db.query('insert into work_item_attachments(work_item_id,filename,mime_type,file_size,file_data,uploaded_by) values($1,$2,$3,$4,$5,$6) returning id,filename,mime_type,file_size,created_at',[req.params.id,f.filename,f.mime,f.buf.length,f.buf,req.user.sub]);
 res.status(201).json({ok:true,attachment:r.rows[0]});
 }catch(e){respond(res,e);}
});
router.get('/api/work-items/:id/attachments/:attachmentId/download',requireAuth,async(req,res)=>{
 try{
 await task(req);
 const a=await db.query('select filename,mime_type,file_data from work_item_attachments where id=$1 and work_item_id=$2',[req.params.attachmentId,req.params.id]);
 if(!a.rowCount)throw fail(404,'Attachment not found.');download(res,a.rows[0]);
 }catch(e){respond(res,e);}
});
router.get('/api/projects/:projectId/task-tree',requireAuth,async(req,res)=>{
 try{await access(req,req.params.projectId);
 const r=await db.query("select id,parent_work_item_id as parent_id,title,status,work_type,external_case_id,session_id,assigned_to,created_at from work_items where project_id=$1 and deleted_at is null order by created_at,id",[req.params.projectId]);
 const byId=new Map(r.rows.map(x=>[x.id,{...x,children:[]}]));const roots=[];
 for(const node of byId.values()){const parent=node.parent_id&&byId.get(node.parent_id);if(parent&&parent.id!==node.id)parent.children.push(node);else roots.push(node);}
 res.json({ok:true,roots,total:r.rows.length});
 }catch(e){respond(res,e);}
});
router.get('/api/projects/:projectId/task-test-history',requireAuth,async(req,res)=>{
 try{await access(req,req.params.projectId);const taskId=req.query.taskId;
 if(!id(taskId))throw fail(400,'Valid taskId required.');
 const task=await db.query('select id from work_items where id=$1 and project_id=$2 and deleted_at is null',[taskId,req.params.projectId]);
 if(!task.rowCount)throw fail(404,'Task not found.');
 const rows=await db.query("select tr.id run_id,tr.run_number,tr.completed_at,tr.executed_by,u.display_name tester,te.external_case_id,te.title,te.passed,te.evidence_json from work_items w join test_runs tr on tr.session_id=w.session_id and tr.project_id=w.project_id join test_results te on te.run_id=tr.id and te.external_case_id=w.external_case_id left join users u on u.id=tr.executed_by where w.id=$1 and w.project_id=$2 order by tr.completed_at desc limit 100",[taskId,req.params.projectId]);
 res.json({ok:true,results:rows.rows});
 }catch(e){respond(res,e);}
});
router.get('/api/work-items/:id/test-links',requireAuth,async(req,res)=>{
 try{const ctx=await task(req);const r=await db.query('select id,session_id,external_case_id,created_at from task_test_case_links where work_item_id=$1 and project_id=$2 order by created_at desc',[ctx.item.id,ctx.item.project_id]);res.json({ok:true,links:r.rows});}catch(e){respond(res,e);}
});
router.post('/api/work-items/:id/test-links',requireAuth,async(req,res)=>{
 try{const ctx=await task(req);reviewer(ctx.role);const sessionId=s(req.body?.sessionId,120),caseId=s(req.body?.caseId,150);if(!sessionId||!caseId)throw fail(400,'Session and case IDs are required.');const session=getSession(sessionId);if(String(session.projectId)!==String(ctx.item.project_id)||!(session.testCases||[]).some(x=>String(x.id).toUpperCase()===caseId.toUpperCase()))throw fail(400,'Case must exist in the selected project session.');const r=await db.query('insert into task_test_case_links(project_id,work_item_id,session_id,external_case_id,created_by) values($1,$2,$3,$4,$5) on conflict(work_item_id,session_id,external_case_id) do update set work_item_id=excluded.work_item_id returning *',[ctx.item.project_id,ctx.item.id,sessionId,caseId,req.user.sub]);res.status(201).json({ok:true,link:r.rows[0]});}catch(e){respond(res,e);}
});
router.delete('/api/work-items/:id/test-links/:linkId',requireAuth,async(req,res)=>{
 try{const ctx=await task(req);reviewer(ctx.role);const r=await db.query('delete from task_test_case_links where id=$1 and work_item_id=$2 and project_id=$3 returning id',[req.params.linkId,ctx.item.id,ctx.item.project_id]);if(!r.rowCount)throw fail(404,'Link not found.');res.json({ok:true});}catch(e){respond(res,e);}
});
router.post('/api/projects/:projectId/project-test-plan',requireAuth,requireRole('QA','MANAGER'),async(req,res)=>{
 try{const ctx=await access(req,req.params.projectId);reviewer(ctx.role);const sessions=await db.query('select distinct session_id from test_sessions where project_id=$1 order by session_id limit 150',[req.params.projectId]);const groups=[],blocked=[];for(const row of sessions.rows){const session=getSession(row.session_id);if(!session||String(session.projectId)!==String(req.params.projectId)||!session.readinessValidated||!['AWAITING_APPROVAL','DONE'].includes(session.state)){blocked.push({sessionId:row.session_id,reason:'Session unavailable or not reviewed'});continue;}const ids=(session.testCases||[]).filter(tc=>tc.automationReadiness?.status==='READY'&&tc.approved!==false).map(tc=>tc.id);if(ids.length)groups.push({sessionId:row.session_id,caseIds:ids});}res.json({ok:true,groups,blocked});}catch(e){respond(res,e);}
});
router.post('/api/projects/:projectId/retest-plan',requireAuth,requireRole('QA','MANAGER'),async(req,res)=>{
 try{
 const ctx=await access(req,req.params.projectId);reviewer(ctx.role);
 const ids=[...new Set((Array.isArray(req.body?.taskIds)?req.body.taskIds:[]).filter(id))];
 if(!ids.length || ids.length>30 || ids.some(x=>!id(x)))throw fail(400,'Select between 1 and 30 tasks.');
 const includeChildren=req.body?.includeChildren===true;
 const r=await db.query(includeChildren?`with recursive selected as (select id,session_id,external_case_id,status,project_id,parent_work_item_id,ARRAY[id] as lineage from work_items where id=any($1::uuid[]) and project_id=$2 and deleted_at is null union all select w.id,w.session_id,w.external_case_id,w.status,w.project_id,w.parent_work_item_id,s.lineage||w.id from work_items w join selected s on w.parent_work_item_id=s.id where w.project_id=$2 and w.deleted_at is null and not w.id=any(s.lineage) and cardinality(s.lineage)<20) select distinct id,session_id,external_case_id,status,project_id from selected limit 501`:'select id,session_id,external_case_id,status,project_id from work_items where id=any($1::uuid[]) and project_id=$2 and deleted_at is null',[ids,req.params.projectId]);
 if(r.rows.length>500)throw fail(400,'Task hierarchy exceeds 500 items; narrow your selection.');
 if(!ids.every(selected=>r.rows.some(item=>item.id===selected)))throw fail(400,'Task selection contains missing or unauthorized tasks.');
 const groups=new Map(),blocked=[];
 const links=await db.query('select work_item_id,session_id,external_case_id from task_test_case_links where project_id=$1 and work_item_id=any($2::uuid[])',[req.params.projectId,r.rows.map(x=>x.id)]);
 const linked=links.rows.map(x=>({id:x.work_item_id,session_id:x.session_id,external_case_id:x.external_case_id}));
 const candidates=[...linked,...r.rows.filter(x=>!linked.some(y=>y.id===x.id))];
 for(const item of candidates) {
 if(!item.session_id || !item.external_case_id){blocked.push({taskId:item.id,reason:'No linked session/test case'});continue;}
 const session=getSession(item.session_id);
 const tc=(session.testCases||[]).find(x=>String(x.id).toUpperCase()===String(item.external_case_id).toUpperCase());
 if(String(session.projectId)!==String(req.params.projectId) || !tc || tc.automationReadiness?.status!=='READY' || !session.readinessValidated || !['AWAITING_APPROVAL','DONE'].includes(session.state)){
 blocked.push({taskId:item.id,reason:'Generate/review this case in the current test session before retesting'});continue;
 }
 const group=groups.get(item.session_id)||{sessionId:item.session_id,caseIds:[],taskIds:[],targetUrl:session.targetUrl};
 if(!group.caseIds.includes(tc.id))group.caseIds.push(tc.id);
 group.taskIds.push(item.id);groups.set(item.session_id,group);
 }
 res.json({ok:true,groups:[...groups.values()],blocked,executor:'existing /api/test-runs/start (isolated Cypress; screenshot/video evidence)'});
 }catch(e){respond(res,e);}
});


router.get('/api/projects/:projectId/deleted-tasks',requireAuth,async(req,res)=>{
 try{
 const ctx=await access(req,req.params.projectId);manager(ctx.role);
 const r=await db.query('select w.id,w.title,w.status,w.deleted_at,w.deleted_by,u.display_name deleted_by_name from work_items w left join users u on u.id=w.deleted_by where w.project_id=$1 and w.deleted_at is not null order by w.deleted_at desc limit 100',[req.params.projectId]);
 res.json({ok:true,tasks:r.rows});
 }catch(e){respond(res,e);}
});

router.get('/api/projects/:projectId/workflow',requireAuth,async(req,res)=>{
 try{
 const ctx=await access(req,req.params.projectId);
 const r=await db.query('select auto_create_failed_tasks,auto_close_verified_retests,default_developer,updated_at from project_workflow_settings where project_id=$1',[req.params.projectId]);
 res.json({ok:true,workflow:r.rows[0]||{auto_create_failed_tasks:false,auto_close_verified_retests:false,default_developer:null},projectRole:ctx.role});
 }catch(e){respond(res,e);}
});
router.put('/api/projects/:projectId/workflow',requireAuth,async(req,res)=>{
 try{
 const ctx=await access(req,req.params.projectId);manager(ctx.role);
 const developer=req.body?.defaultDeveloper||null;
 if(developer){
 const d=await db.query("select 1 from project_members pm join users u on u.id=pm.user_id where pm.project_id=$1 and pm.user_id=$2 and pm.project_role='DEVELOPER' and u.is_active=true",[req.params.projectId,developer]);
 if(!d.rowCount)throw fail(400,'Default assignee must be an active developer on this project.');
 }
 const a=Boolean(req.body?.autoCreateFailedTasks),b=Boolean(req.body?.autoCloseVerifiedRetests);
 const r=await db.query('insert into project_workflow_settings(project_id,auto_create_failed_tasks,auto_close_verified_retests,default_developer,updated_by) values($1,$2,$3,$4,$5) on conflict(project_id) do update set auto_create_failed_tasks=excluded.auto_create_failed_tasks,auto_close_verified_retests=excluded.auto_close_verified_retests,default_developer=excluded.default_developer,updated_by=excluded.updated_by,updated_at=now() returning *',
 [req.params.projectId,a,b,developer,req.user.sub]);
 res.json({ok:true,workflow:r.rows[0]});
 }catch(e){respond(res,e);}
});
module.exports=router;
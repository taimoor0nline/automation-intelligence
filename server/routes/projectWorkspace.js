'use strict';
const express=require('express');
const db=require('../db');
const {requireAuth,requireRole}=require('../services/authService');
const {getSession,hydrateSession}=require('../data/sessionStore');
const persistence=require('../services/persistenceService');
const fs=require('fs');
const path=require('path');
const {ROOT:ARTIFACT_ROOT}=require('../services/retainedExecutionEvidence');
const vault=require('../services/credentialVault');
const crypto=require('crypto');
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
 db.query('select id,name,base_url,stage_type,is_default,is_active,disabled_at,created_at,updated_at,login_required,jsonb_array_length(test_users) as test_user_count from project_environments where project_id=$1 order by is_default desc,name',[req.params.projectId]),
 db.query('select s.*,u.display_name created_by_name,uu.display_name updated_by_name from project_stories s left join users u on u.id=s.created_by left join users uu on uu.id=s.updated_by where s.project_id=$1 order by s.updated_at desc limit 200',[req.params.projectId]),
 db.query('select d.id,d.filename,d.mime_type,d.category,d.file_size,d.version,d.uploaded_by,d.created_at,u.display_name uploaded_by_name from project_documents d left join users u on u.id=d.uploaded_by where d.project_id=$1 order by d.created_at desc limit 200',[req.params.projectId]),
 db.query('select pm.user_id,pm.project_role,pm.created_at,u.display_name,u.email,ab.display_name added_by_name from project_members pm join users u on u.id=pm.user_id left join users ab on ab.id=pm.added_by where pm.project_id=$1 and u.is_active=true order by u.display_name',[req.params.projectId]),
 db.query('select r.id,r.session_id,r.run_number,r.total,r.passed,r.failed,r.duration_ms,r.completed_at,t.environment,u.display_name executed_by_name,src.id source_run_id,src.run_number source_run_number,coalesce(lu.whole_reruns,0)::int rerun_count,(select count(*) from test_runs z where z.session_id=r.session_id)::int runs_in_session,exists(select 1 from test_report_snapshots ai where ai.run_id=r.id and ai.report_kind=\'AI_ANALYSIS\' and ai.report_html is not null) has_ai_snapshot,lu.executed_by_name last_by_name,lu.completed_at last_at from test_runs r left join test_sessions t on t.id=r.session_id left join users u on u.id=r.executed_by left join test_run_reruns rl on rl.session_id=r.session_id and rl.run_number=r.run_number left join test_runs src on src.id=rl.source_run_id left join lateral (select ku.display_name executed_by_name,kr.completed_at,count(*) over() whole_reruns from test_runs kr left join users ku on ku.id=kr.executed_by where kr.session_id=r.session_id and kr.run_number>r.run_number and not exists (select 1 from test_results a where a.run_id=r.id and not exists (select 1 from test_results b where b.run_id=kr.id and b.external_case_id=a.external_case_id)) order by kr.run_number desc limit 1) lu on true where r.project_id=$1 order by r.completed_at desc limit 50',[req.params.projectId])
 ]);
 // AI report available: saved with the run, or (older runs) the session's report file when that session has a single run.
 const {REPORT_DIR,reportFileName}=require('../services/reportGenerator');
 for(const r of runs.rows){r.has_ai_report=r.has_ai_snapshot||(r.runs_in_session===1&&fs.existsSync(path.join(REPORT_DIR,reportFileName(r.session_id))));delete r.has_ai_snapshot;delete r.runs_in_session;}
 res.json({ok:true,project:ctx.project,projectRole:ctx.role,environments:envs.rows,stories:stories.rows,documents:docs.rows,members:team.rows,runs:runs.rows,runGroups:await groupedRunRows(req.params.projectId)});
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
 values.push(req.user.sub);updates.push('updated_by=$'+values.length);
 values.push(req.params.projectId);
 const updated=await db.query('update projects set '+updates.join(',')+',updated_at=now() where id=$'+values.length+' returning *',values);
 res.json({ok:true,project:updated.rows[0]});
 }catch(e){respond(res,e);}
});
const ENV_TYPES=new Set(['QA','DEV','STAGING','UAT','PRODUCTION']);
function envFields(body={},existing=null){
 const name=s(body.name??existing?.name,100),base=s(body.baseUrl??existing?.base_url,1500);
 const stage=s(body.stageType??existing?.stage_type??'QA',30).toUpperCase();
 if(!name||!/^https?:\/\//i.test(base))throw fail(400,'Name and valid HTTP(S) base URL are required.');
 if(!ENV_TYPES.has(stage))throw fail(400,'Invalid environment stage type.');
 try{const parsed=new URL(base);if(!['http:','https:'].includes(parsed.protocol)||!parsed.hostname)throw Error();}catch{throw fail(400,'Environment base URL must be a valid HTTP(S) address.');}
 return {name,base,stage};
}
async function usageForEnvironment(client,projectId,env){
 const result=await client.query(`select
  (select count(*)::int from project_stories where project_id=$1 and environment_id=$2) as stories,
  (select count(*)::int from test_sessions where project_id=$1 and lower(environment)=lower($3)) as sessions,
  (select count(*)::int from test_runs r join test_sessions t on t.id=r.session_id where r.project_id=$1 and lower(t.environment)=lower($3)) as runs`,[projectId,env.id,env.name]);
 const row=result.rows[0];
 return {stories:row.stories,sessions:row.sessions,runs:row.runs,total:row.stories+row.sessions+row.runs};
}
async function auditEnv(client,projectId,envId,user,eventType,extra={}){
 await client.query("insert into project_audit_events(project_id,actor_id,event_type,metadata) values($1,$2,$3,$4::jsonb)",
  [projectId,user,eventType,JSON.stringify({environmentId:envId,...extra})]);
}
// Test login of the application under test, stored per environment. The password is encrypted and is
// never returned by list/save responses; only QA / project managers can load it to start testing.
const MAX_TEST_USERS=12;
// Several test users per environment, each with a role (Admin, Customer…). A blank password keeps the saved one.
function testUsersFields(body={},previous=null){
 const saved=Array.isArray(previous?.test_users)?previous.test_users:[];
 let incoming=body.testUsers;
 if(!Array.isArray(incoming)){
  // Older single-login payload (testUsername/testPassword) updates the first user.
  if(!Object.hasOwn(body,'testUsername')&&typeof body.testPassword!=='string')return saved;
  incoming=[{id:saved[0]?.id,role:saved[0]?.role||'Default User',username:body.testUsername??saved[0]?.username,password:body.testPassword}];
 }
 if(incoming.length>MAX_TEST_USERS)throw fail(400,'At most '+MAX_TEST_USERS+' test users are allowed per environment.');
 return incoming.map((user,index)=>{
  const before=saved.find(item=>user?.id&&item.id===user.id)||null;
  const role=s(user?.role,60),username=s(user?.username,200);
  const password=typeof user?.password==='string'&&user.password.length?String(user.password).slice(0,500):'';
  const passwordEncrypted=password?vault.encrypt(password):(before?.passwordEncrypted||null);
  if(!role||!username)throw fail(400,'Test user '+(index+1)+' needs a role and a username.');
  if(!passwordEncrypted)throw fail(400,'Test user '+(index+1)+' ('+role+') needs a password.');
  return {id:before?.id||crypto.randomUUID(),role,username,passwordEncrypted};
 });
}
function loginFields(body={},previous=null){
 const loginRequired=Object.hasOwn(body,'loginRequired')?Boolean(body.loginRequired):Boolean(previous?.login_required);
 const users=testUsersFields(body,previous);
 if(loginRequired&&!users.length)throw fail(400,'Add at least one test user when application login is required.');
 // The first user is also kept in the single-login columns for older code.
 return {loginRequired,username:users[0]?.username||null,passwordEncrypted:users[0]?.passwordEncrypted||null,users};
}
function publicTestUsers(users){
 return (Array.isArray(users)?users:[]).map(({id,role,username,passwordEncrypted})=>({id,role,username,hasPassword:Boolean(passwordEncrypted)}));
}
function publicEnv(env){
 if(!env)return env;
 const {test_password_encrypted,test_users,...rest}=env;
 return {...rest,has_test_password:Boolean(test_password_encrypted),test_users:publicTestUsers(test_users)};
}
router.get('/api/projects/:projectId/environments/:environmentId/test-login',requireAuth,async(req,res)=>{
 try{
  const ctx=await access(req,req.params.projectId);
  if(!['PROJECT_MANAGER','QA'].includes(ctx.role))throw fail(403,'QA or project manager permission required.');
  if(!id(req.params.environmentId))throw fail(400,'Invalid environment ID.');
  const found=await db.query('select login_required,test_username,test_password_encrypted,test_users from project_environments where id=$1 and project_id=$2',[req.params.environmentId,req.params.projectId]);
  if(!found.rowCount)throw fail(404,'Environment not found.');
  const env=found.rows[0];
  const unreadable=role=>fail(409,'The saved test password'+(role?' for '+role:'')+' cannot be read. Re-enter it in the environment settings.');
  let password='';
  try{password=vault.decrypt(env.test_password_encrypted);}catch{throw unreadable('');}
  const users=(Array.isArray(env.test_users)?env.test_users:[]).map(user=>{
   try{return {role:user.role,username:user.username,password:vault.decrypt(user.passwordEncrypted)};}catch{throw unreadable(user.role);}
  });
  res.json({ok:true,loginRequired:Boolean(env.login_required),username:env.test_username||'',password,users});
 }catch(e){respond(res,e);}
});
router.get('/api/projects/:projectId/environments',requireAuth,async(req,res)=>{
 try{
  const ctx=await access(req,req.params.projectId);
  const environments=await db.query('select e.*,cu.display_name created_by_name,uu.display_name updated_by_name from project_environments e left join users cu on cu.id=e.created_by left join users uu on uu.id=e.updated_by where e.project_id=$1 order by e.is_active desc,e.is_default desc,e.name',[req.params.projectId]);
  const list=await Promise.all(environments.rows.map(async env=>{
   const usage=await usageForEnvironment(db,req.params.projectId,env);
   const {id,name,base_url,stage_type,is_default,is_active,created_at,updated_at,disabled_at,login_required,test_username,test_password_encrypted,test_users,created_by_name,updated_by_name}=env;
   return {id,name,base_url,stage_type,is_default,is_active,created_at,updated_at,disabled_at,created_by_name,updated_by_name,login_required:Boolean(login_required),test_username:test_username||'',has_test_password:Boolean(test_password_encrypted),test_users:publicTestUsers(test_users),usage,canDelete:usage.total===0};
  }));
  res.json({ok:true,environments:list,canManage:ctx.role==='PROJECT_MANAGER'});
 }catch(e){respond(res,e);}
});
router.post('/api/projects/:projectId/environments',requireAuth,async(req,res)=>{
 try{
  const ctx=await access(req,req.params.projectId);manager(ctx.role);
  const {name,base,stage}=envFields(req.body);
  const def=Boolean(req.body?.isDefault);
  const login=loginFields(req.body);
  const inserted=await db.withTransaction(async client=>{
   if(def)await client.query('update project_environments set is_default=false where project_id=$1',[req.params.projectId]);
   const result=await client.query('insert into project_environments(project_id,name,base_url,stage_type,is_default,is_active,created_by,login_required,test_username,test_password_encrypted,test_users) values($1,$2,$3,$4,$5,true,$6,$7,$8,$9,$10::jsonb) returning *',
    [req.params.projectId,name,base,stage,def,req.user.sub,login.loginRequired,login.username,login.passwordEncrypted,JSON.stringify(login.users)]);
   await auditEnv(client,req.params.projectId,result.rows[0].id,req.user.sub,'ENVIRONMENT_CREATED',{name});
   return result.rows[0];
  });
  res.status(201).json({ok:true,environment:publicEnv(inserted)});
 }catch(e){if(e.code==='23505')return respond(res,fail(409,'An environment with this name already exists.'));respond(res,e);}
});
router.patch('/api/projects/:projectId/environments/:environmentId',requireAuth,async(req,res)=>{
 try{
  const ctx=await access(req,req.params.projectId);manager(ctx.role);
  const envId=req.params.environmentId;
  if(!id(envId))throw fail(400,'Invalid environment ID.');
  const updated=await db.withTransaction(async client=>{
   const found=await client.query('select * from project_environments where id=$1 and project_id=$2 for update',[envId,req.params.projectId]);
   if(!found.rowCount)throw fail(404,'Environment not found.');
   const previous=found.rows[0],isActive=Object.hasOwn(req.body||{},'isActive')?req.body.isActive:previous.is_active;
   if(typeof isActive!=='boolean')throw fail(400,'isActive must be a boolean.');
   const {name,base,stage}=envFields(req.body,previous);
   if(name!==previous.name){const used=await usageForEnvironment(client,req.params.projectId,previous);if(used.total>0)throw fail(409,'Environment with existing stories or test transactions cannot be renamed; disable it and create a new environment.');}
   const setDefault=Object.hasOwn(req.body||{},'isDefault')?req.body.isDefault:previous.is_default;
   if(typeof setDefault!=='boolean')throw fail(400,'isDefault must be a boolean.');
   if(!isActive&&setDefault&&Object.hasOwn(req.body||{},'isDefault')&&req.body.isDefault)throw fail(400,'Disabled environment cannot be default.');
   const def=Boolean(isActive&&setDefault);
   const login=loginFields(req.body,previous);
   if(def)await client.query('update project_environments set is_default=false where project_id=$1 and id<>$2',[req.params.projectId,envId]);
   const saved=await client.query(`update project_environments set name=$1,base_url=$2,stage_type=$3,is_default=$4,is_active=$5,
     disabled_at=case when $5=false then coalesce(disabled_at,now()) else null end,
     disabled_by=case when $5=false then coalesce(disabled_by,$6::uuid) else null end,updated_at=now(),updated_by=$6::uuid,
     login_required=$9,test_username=$10,test_password_encrypted=$11,test_users=$12::jsonb
     where id=$7 and project_id=$8 returning *`,[name,base,stage,def,isActive,req.user.sub,envId,req.params.projectId,login.loginRequired,login.username,login.passwordEncrypted,JSON.stringify(login.users)]);
   await auditEnv(client,req.params.projectId,envId,req.user.sub,previous.is_active===true&&isActive===false?'ENVIRONMENT_DISABLED':previous.is_active===false&&isActive===true?'ENVIRONMENT_ENABLED':'ENVIRONMENT_UPDATED',
    {oldName:previous.name,newName:name,previousDefault:previous.is_default,isDefault:def});
   return saved.rows[0];
  });
  res.json({ok:true,environment:publicEnv(updated)});
 }catch(e){if(e.code==='23505')return respond(res,fail(409,'An environment with this name already exists.'));respond(res,e);}
});
router.delete('/api/projects/:projectId/environments/:environmentId',requireAuth,async(req,res)=>{
 try{
  const ctx=await access(req,req.params.projectId);manager(ctx.role);
  if(!id(req.params.environmentId))throw fail(400,'Invalid environment ID.');
  await db.withTransaction(async client=>{
   const found=await client.query('select * from project_environments where id=$1 and project_id=$2 for update',[req.params.environmentId,req.params.projectId]);
   if(!found.rowCount)throw fail(404,'Environment not found.');
   const env=found.rows[0];
   const usage=await usageForEnvironment(client,req.params.projectId,env);
   if(usage.total>0)throw fail(409,'Environment has existing stories or test transactions and cannot be deleted. Disable it for new transactions instead.');
   const removed=await client.query('delete from project_environments where id=$1 and project_id=$2 returning id',[env.id,req.params.projectId]);
   if(!removed.rowCount)throw fail(404,'Environment not found.');
   await auditEnv(client,req.params.projectId,env.id,req.user.sub,'ENVIRONMENT_DELETED',{name:env.name});
  });
  res.json({ok:true,deleted:true});
 }catch(e){
  if(e.code==='23503')return respond(res,fail(409,'Environment is referenced by another record; disable it instead of deleting.'));
  respond(res,e);
 }
});
router.post('/api/projects/:projectId/stories',requireAuth,async(req,res)=>{
 try{
 const ctx=await access(req,req.params.projectId);reviewer(ctx.role);
 const title=s(req.body?.title,250),story=s(req.body?.story,12000);
 if(!title || !story)throw fail(400,'Story title and business story are required.');
 const eid=req.body?.environmentId||null;
 if(eid){const env=await db.query('select 1 from project_environments where id=$1 and project_id=$2 and is_active=true',[eid,req.params.projectId]);if(!env.rowCount)throw fail(400,'Environment does not belong to project.');}
 const result=await db.query('insert into project_stories(project_id,environment_id,reference_no,title,story,acceptance_criteria,page_paths,priority,created_by,updated_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) returning *',
 [req.params.projectId,eid,'ST-'+require('crypto').randomUUID().slice(0,8).toUpperCase(),title,story,s(req.body?.acceptanceCriteria,8000)||null,s(req.body?.pagePaths,1500)||null,s(req.body?.priority,20)||'MEDIUM',req.user.sub]);
 await db.query('insert into project_audit_events(project_id,story_id,actor_id,event_type,metadata) values($1,$2,$3,$4,$5::jsonb)',[req.params.projectId,result.rows[0].id,req.user.sub,'STORY_CREATED',JSON.stringify({referenceNo:result.rows[0].reference_no})]);
 res.status(201).json({ok:true,story:result.rows[0]});
 }catch(e){respond(res,e);}
});
// Delete a story (project manager only). Its test sessions, cases and runs stay; they are just no longer linked to it.
router.delete('/api/projects/:projectId/stories/:storyId',requireAuth,async(req,res)=>{
 try{
 const ctx=await access(req,req.params.projectId);manager(ctx.role);
 const story=await db.withTransaction(async client=>{
 const d=await client.query('delete from project_stories where id=$1 and project_id=$2 returning id,reference_no,title',[req.params.storyId,req.params.projectId]);
 if(!d.rowCount)throw fail(404,'Story not found.');
 await client.query("insert into project_audit_events(project_id,actor_id,event_type,metadata) values($1,$2,'STORY_DELETED',$3::jsonb)",[req.params.projectId,req.user.sub,JSON.stringify({storyId:d.rows[0].id,referenceNo:d.rows[0].reference_no,title:d.rows[0].title})]);
 return d.rows[0];
 });
 res.json({ok:true,story});
 }catch(e){respond(res,e);}
});
router.patch('/api/projects/:projectId/stories/:storyId',requireAuth,async(req,res)=>{
 try{
 const ctx=await access(req,req.params.projectId);reviewer(ctx.role);
 const existing=await db.query('select * from project_stories where id=$1 and project_id=$2',[req.params.storyId,req.params.projectId]);
 if(!existing.rowCount)throw fail(404,'Story not found.');
 const old=existing.rows[0],b=req.body||{};
 const updated=await db.withTransaction(async client=>{
 const updated=await client.query('update project_stories set title=$1,story=$2,acceptance_criteria=$3,page_paths=$4,priority=$5,updated_by=$6,updated_at=now() where id=$7 and project_id=$8 returning *',
 [s(b.title??old.title,250),s(b.story??old.story,12000),s(b.acceptanceCriteria??old.acceptance_criteria,8000),s(b.pagePaths??old.page_paths,1500),s(b.priority??old.priority,20),req.user.sub,req.params.storyId,req.params.projectId]);
 await client.query("insert into project_audit_events(project_id,story_id,actor_id,event_type,metadata) values($1,$2,$3,'STORY_UPDATED',$4::jsonb)",[req.params.projectId,req.params.storyId,req.user.sub,JSON.stringify({previousUpdatedAt:old.updated_at,newUpdatedAt:updated.rows[0].updated_at,fields:['title','story','acceptance_criteria','page_paths','priority'].filter(k=>String(old[k]??'')!==String(updated.rows[0][k]??''))})]);
 return updated.rows[0];
 });
 res.json({ok:true,story:updated});
 }catch(e){respond(res,e);}
});
// Project document categories (stored in project_documents.category).
const DOCUMENT_CATEGORIES=new Set(['REQUIREMENTS','USER_STORIES','UI_DESIGN','API_SPEC','TEST_PLAN','TEST_DATA','REPORT','OTHER']);
router.post('/api/projects/:projectId/documents',requireAuth,async(req,res)=>{
 try{
 const ctx=await access(req,req.params.projectId);reviewer(ctx.role);
 const f=parseFile(req.body);
 const r=await db.query('insert into project_documents(project_id,filename,mime_type,category,file_size,file_data,version,uploaded_by) values($1,$2,$3,$4,$5,$6,$7,$8) returning id,filename,mime_type,category,file_size,version,created_at',
 [req.params.projectId,f.filename,f.mime,DOCUMENT_CATEGORIES.has(String(req.body?.category||'').toUpperCase())?String(req.body.category).toUpperCase():'OTHER',f.buf.length,f.buf,s(req.body?.version,30)||'1.0',req.user.sub]);
 await db.query("insert into project_audit_events(project_id,actor_id,event_type,metadata) values($1,$2,'DOCUMENT_UPLOADED',$3::jsonb)",[req.params.projectId,req.user.sub,JSON.stringify({documentId:r.rows[0].id,filename:r.rows[0].filename,category:r.rows[0].category})]);
 res.status(201).json({ok:true,document:r.rows[0]});
 }catch(e){respond(res,e);}
});
// Delete a project document (project manager only); recorded in the audit log.
router.delete('/api/projects/:projectId/documents/:documentId',requireAuth,async(req,res)=>{
 try{
 const ctx=await access(req,req.params.projectId);manager(ctx.role);
 const doc=await db.withTransaction(async client=>{
 const d=await client.query('delete from project_documents where id=$1 and project_id=$2 returning id,filename,category',[req.params.documentId,req.params.projectId]);
 if(!d.rowCount)throw fail(404,'Document not found.');
 await client.query("insert into project_audit_events(project_id,actor_id,event_type,metadata) values($1,$2,'DOCUMENT_DELETED',$3::jsonb)",[req.params.projectId,req.user.sub,JSON.stringify({documentId:d.rows[0].id,filename:d.rows[0].filename,category:d.rows[0].category})]);
 return d.rows[0];
 });
 res.json({ok:true,document:doc});
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
 db.query('select h.event_type,h.old_status,h.new_status,h.comment,h.created_at,u.display_name by_name from work_item_history h left join users u on u.id=h.performed_by where h.work_item_id=$1 order by h.created_at desc limit 100',[req.params.id]),
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
 [ctx.item.project_id,ctx.item.id,null,null,'GENERAL',title,s(req.body?.description,4000)||null,s(req.body?.priority,15)||'MEDIUM',assignee,req.user.sub,req.body?.dueAt||null,req.body?.etaAt||null]);
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
 put('updated_by',req.user.sub);
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
 const ctx=await task(req);if(ctx.role==='VIEWER')throw fail(403,'Viewers cannot modify task attachments.');if(ctx.item.deleted_at)throw fail(409,'Restore this task before attaching files.');
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
 const role=await access(req,req.params.projectId);const values=[req.params.projectId];let filter='';if(role.role==='DEVELOPER'){values.push(req.user.sub);filter=' and assigned_to=$2';}const r=await db.query('select id,parent_work_item_id as parent_id,title,status,work_type,external_case_id,session_id,assigned_to,created_at from work_items where project_id=$1 and deleted_at is null'+filter+' order by created_at,id',values);
 const byId=new Map(r.rows.map(x=>[x.id,{...x,children:[]}]));const roots=[];
 for(const node of byId.values()){const parent=node.parent_id&&byId.get(node.parent_id);if(parent&&parent.id!==node.id)parent.children.push(node);else roots.push(node);}
 res.json({ok:true,roots,total:r.rows.length});
 }catch(e){respond(res,e);}
});
router.get('/api/projects/:projectId/task-test-history',requireAuth,async(req,res)=>{
 try{await access(req,req.params.projectId);const taskId=req.query.taskId;
 if(!id(taskId))throw fail(400,'Valid taskId required.');
 const task=await db.query('select id,assigned_to from work_items where id=$1 and project_id=$2 and deleted_at is null',[taskId,req.params.projectId]);
 if(!task.rowCount)throw fail(404,'Task not found.');
 const permission=await access(req,req.params.projectId);if(permission.role==='DEVELOPER'&&String(task.rows[0].assigned_to)!==String(req.user.sub))throw fail(403,'Task is not assigned to you.');
 const rows=await db.query(`with linked_cases as (select session_id,external_case_id from task_test_case_links where work_item_id=$1 and project_id=$2 union select session_id,external_case_id from work_items where id=$1 and project_id=$2 and session_id is not null and external_case_id is not null) select tr.id run_id,tr.run_number,tr.completed_at,tr.executed_by,u.display_name tester,te.external_case_id,te.title,te.passed,te.evidence_json from linked_cases lc join test_runs tr on tr.session_id=lc.session_id and tr.project_id=$2 join test_results te on te.run_id=tr.id and te.external_case_id=lc.external_case_id left join users u on u.id=tr.executed_by order by tr.completed_at desc limit 100`,[taskId,req.params.projectId]);
 res.json({ok:true,results:rows.rows});
 }catch(e){respond(res,e);}
});
router.get('/api/work-items/:id/test-links',requireAuth,async(req,res)=>{
 try{const ctx=await task(req);const r=await db.query('select id,session_id,external_case_id,created_at from task_test_case_links where work_item_id=$1 and project_id=$2 order by created_at desc',[ctx.item.id,ctx.item.project_id]);res.json({ok:true,links:r.rows});}catch(e){respond(res,e);}
});
router.post('/api/work-items/:id/test-links',requireAuth,async(req,res)=>{
 try{const ctx=await task(req);reviewer(ctx.role);const sessionId=s(req.body?.sessionId,120),caseId=s(req.body?.caseId,150);if(!sessionId||!caseId)throw fail(400,'Session and case IDs are required.');const valid=await db.query('select 1 from test_cases tc join test_sessions ts on ts.id=tc.session_id where ts.project_id=$1 and tc.session_id=$2 and upper(tc.external_case_id)=upper($3) limit 1',[ctx.item.project_id,sessionId,caseId]);if(!valid.rowCount)throw fail(400,'Case must exist in the selected project session.');const r=await db.query('insert into task_test_case_links(project_id,work_item_id,session_id,external_case_id,created_by) values($1,$2,$3,$4,$5) on conflict(work_item_id,session_id,external_case_id) do update set work_item_id=excluded.work_item_id returning *',[ctx.item.project_id,ctx.item.id,sessionId,caseId,req.user.sub]);res.status(201).json({ok:true,link:r.rows[0]});}catch(e){respond(res,e);}
});
router.delete('/api/work-items/:id/test-links/:linkId',requireAuth,async(req,res)=>{
 try{const ctx=await task(req);reviewer(ctx.role);const r=await db.query('delete from task_test_case_links where id=$1 and work_item_id=$2 and project_id=$3 returning id',[req.params.linkId,ctx.item.id,ctx.item.project_id]);if(!r.rowCount)throw fail(404,'Link not found.');res.json({ok:true});}catch(e){respond(res,e);}
});

// ---- Runs grouped as attempts (Runs & reports) ----
// Every execution stays its own saved run (own time, runner, results, screenshots, reports). For display, a re-run is an
// attempt of the run it repeats: the saved link from the ↻ / ▶ button, or for older re-runs the earliest earlier run in the
// same session that contains all of its test cases. Attempt 1 is the original run.
async function runGroups(projectId){
 const runs=(await db.query(`select r.id,r.session_id,r.run_number,r.project_run_number,r.passed,r.failed,r.total,r.completed_at,t.environment,u.display_name executed_by_name,
   coalesce((select array_agg(x.external_case_id) from test_results x where x.run_id=r.id),'{}') case_ids
   from test_runs r left join test_sessions t on t.id=r.session_id left join users u on u.id=r.executed_by where r.project_id=$1 order by r.session_id,r.run_number`,[projectId])).rows;
 const links=new Map((await db.query('select k.session_id,k.run_number,k.source_run_id from test_run_reruns k join test_runs src on src.id=k.source_run_id where src.project_id=$1',[projectId])).rows.map(l=>[l.session_id+'#'+l.run_number,l.source_run_id]));
 const byId=new Map(runs.map(r=>[r.id,r])),parent=new Map();
 for(const r of runs){
  const linked=links.get(r.session_id+'#'+r.run_number);
  if(linked&&byId.has(linked)&&linked!==r.id){parent.set(r.id,linked);continue;}
  if(r.run_number>1&&r.case_ids.length){const src=runs.find(e=>e.session_id===r.session_id&&e.run_number<r.run_number&&r.case_ids.every(c=>e.case_ids.includes(c)));if(src)parent.set(r.id,src.id);}
 }
 const rootOf=runId=>{let cur=runId,guard=0;while(parent.has(cur)&&guard++<200)cur=parent.get(cur);return cur;};
 const groups=new Map();
 for(const r of runs){const root=rootOf(r.id);if(!groups.has(root))groups.set(root,[]);groups.get(root).push(r);}
 for(const list of groups.values())list.sort((a,b)=>a.run_number-b.run_number);
 // Project-wide run number: given once to each run (attempt 1), in the order runs were first made, then saved.
 const unnumbered=[...groups.values()].map(l=>l[0]).filter(r=>r.project_run_number==null).sort((a,b)=>new Date(a.completed_at)-new Date(b.completed_at));
 if(unnumbered.length){
  await db.withTransaction(async client=>{
   await client.query('select pg_advisory_xact_lock(hashtext($1))',['run-number:'+projectId]);
   let next=Number((await client.query('select coalesce(max(project_run_number),0) n from test_runs where project_id=$1',[projectId])).rows[0].n);
   for(const r of unnumbered){
    const done=await client.query('update test_runs set project_run_number=$2 where id=$1 and project_run_number is null returning project_run_number',[r.id,next+1]);
    if(done.rowCount){next+=1;r.project_run_number=next;}
    else r.project_run_number=(await client.query('select project_run_number from test_runs where id=$1',[r.id])).rows[0]?.project_run_number??null;
   }
  });
 }
 return {byId,rootOf,groups};
}
// AI report available for a run: saved with it, or (older runs) the session's report file when that session has one run.
async function aiAvailability(projectId,runs){
 const snaps=new Set((await db.query("select run_id from test_report_snapshots where project_id=$1 and report_kind='AI_ANALYSIS' and report_html is not null",[projectId])).rows.map(x=>x.run_id));
 const perSession=new Map();for(const r of runs)perSession.set(r.session_id,(perSession.get(r.session_id)||0)+1);
 const {REPORT_DIR,reportFileName}=require('../services/reportGenerator');
 return r=>snaps.has(r.id)||(perSession.get(r.session_id)===1&&fs.existsSync(path.join(REPORT_DIR,reportFileName(r.session_id))));
}
// Latest result of each test case across a group's attempts.
async function groupCaseState(list){
 const rows=(await db.query('select run_id,external_case_id,title,passed,test_category,scenario_type,priority from test_results where run_id=any($1::uuid[])',[list.map(r=>r.id)])).rows;
 const state=new Map();
 list.forEach((a,i)=>{for(const x of rows.filter(y=>y.run_id===a.id)){const prev=state.get(x.external_case_id);state.set(x.external_case_id,{...(prev||{}),...x,first:prev?.first||x,latest_attempt:i+1,latest_run_id:a.id,latest_by_name:a.executed_by_name,latest_completed_at:a.completed_at,times_run:(prev?.times_run||0)+1});}});
 return state;
}
// Runs & reports list: one row per run; Result = current status of its test cases; Times run = attempts.
async function groupedRunRows(projectId){
 const {groups}=await runGroups(projectId);
 const all=[...groups.values()].flat(),hasAi=await aiAvailability(projectId,all),out=[];
 for(const list of groups.values()){
  const root=list[0],latest=list[list.length-1],state=await groupCaseState(list);
  const cases=root.case_ids.map(c=>state.get(c)).filter(Boolean),passed=cases.filter(c=>c.passed).length;
  out.push({id:root.id,session_id:root.session_id,run_number:root.project_run_number??root.run_number,environment:root.environment,executed_by_name:root.executed_by_name,completed_at:root.completed_at,
   passed,failed:cases.length-passed,total:cases.length,rerun_count:list.length-1,last_by_name:latest.executed_by_name,last_at:latest.completed_at,
   latest_attempt_id:latest.id,latest_run_number:latest.run_number,has_ai_report:hasAi(latest)});
 }
 return out.sort((a,b)=>new Date(b.last_at)-new Date(a.last_at)).slice(0,100);
}
async function projectSession(sessionId,projectId){
 const session=getSession(sessionId);
 if(String(session.projectId)===String(projectId) && Array.isArray(session.testCases) && session.testCases.length)return session;
 const restored=await persistence.loadSession(sessionId);
 if(!restored||String(restored.projectId)!==String(projectId))return null;
 return hydrateSession(sessionId,restored);
}
router.get('/api/projects/:projectId/test-cases',requireAuth,async(req,res)=>{
 try{
  await access(req,req.params.projectId);
  const result=await db.query('select tc.session_id,tc.external_case_id,tc.title,ts.state,ts.updated_at from test_cases tc join test_sessions ts on ts.id=tc.session_id where ts.project_id=$1 order by ts.updated_at desc,tc.external_case_id limit 300',[req.params.projectId]);
  res.json({ok:true,cases:result.rows});
 }catch(e){respond(res,e);}
});
router.post('/api/projects/:projectId/project-test-plan',requireAuth,requireRole('QA','MANAGER'),async(req,res)=>{
 try{const ctx=await access(req,req.params.projectId);reviewer(ctx.role);// Optional storyId: only the sessions generated for that story (story_test_sessions / project_story_id).
const storyId=id(req.body?.storyId)?req.body.storyId:null;const sessions=storyId?await db.query('select distinct s.id as session_id,s.updated_at from test_sessions s left join story_test_sessions sts on sts.session_id=s.id where s.project_id=$1 and (sts.story_id=$2 or s.project_story_id=$2) order by s.updated_at desc limit 150',[req.params.projectId,storyId]):await db.query('select id as session_id from test_sessions where project_id=$1 order by updated_at desc limit 150',[req.params.projectId]);const groups=[],blocked=[];for(const row of sessions.rows){const session=await projectSession(row.session_id,req.params.projectId);if(!session||String(session.projectId)!==String(req.params.projectId)||!session.readinessValidated||!['AWAITING_APPROVAL','DONE'].includes(session.state)){blocked.push({sessionId:row.session_id,reason:'Session unavailable or not reviewed'});continue;}const ids=(session.testCases||[]).filter(tc=>tc.automationReadiness?.status==='READY'&&tc.approved!==false).map(tc=>tc.id);if(ids.length)groups.push({sessionId:row.session_id,caseIds:ids});}// Last run of these sessions, for the "run existing or generate new" question.
const last=groups.length?(await db.query('select run_number,completed_at,passed,failed from test_runs where project_id=$1 and session_id=any($2::text[]) order by completed_at desc limit 1',[req.params.projectId,groups.map(g=>g.sessionId)])).rows[0]||null:null;res.json({ok:true,groups,blocked,caseCount:groups.reduce((n,g)=>n+g.caseIds.length,0),lastRun:last});}catch(e){respond(res,e);}
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
 const session=await projectSession(item.session_id,req.params.projectId);
 const tc=(session?.testCases||[]).find(x=>String(x.id).toUpperCase()===String(item.external_case_id).toUpperCase());
 if(!session || String(session.projectId)!==String(req.params.projectId) || !tc || tc.automationReadiness?.status!=='READY' || !session.readinessValidated || !['AWAITING_APPROVAL','DONE'].includes(session.state)){
 blocked.push({taskId:item.id,reason:'Generate/review this case in the current test session before retesting'});continue;
 }
 const group=groups.get(item.session_id)||{sessionId:item.session_id,caseIds:[],taskIds:[],targetUrl:session.targetUrl};
 if(!group.caseIds.includes(tc.id))group.caseIds.push(tc.id);
 group.taskIds.push(item.id);groups.set(item.session_id,group);
 }
 res.json({ok:true,groups:[...groups.values()],blocked,executor:'existing /api/test-runs/start (isolated Cypress; screenshot/video evidence)'});
 }catch(e){respond(res,e);}
});


// Re-run (Runs & reports): which cases of a run, or one case, can run again in their original session.
// Same rules as task retest: the session must be restored and reviewed, and each case approved and Automation Ready.
// The browser then starts it with the existing POST /api/test-runs/start, so it is saved as a new run of that session.
router.post('/api/projects/:projectId/runs/:runId/rerun-plan',requireAuth,requireRole('QA','MANAGER'),async(req,res)=>{
 try{
 const ctx=await access(req,req.params.projectId);reviewer(ctx.role);
 if(!id(req.params.runId))throw fail(400,'Invalid run ID.');
 const run=await db.query('select r.session_id,r.run_number,t.environment from test_runs r left join test_sessions t on t.id=r.session_id where r.project_id=$1 and r.id=$2',[req.params.projectId,req.params.runId]);
 if(!run.rowCount)throw fail(404,'Run not found.');
 const {session_id:sessionId,run_number:runNumber,environment}=run.rows[0];
 const onlyCase=s(req.body?.caseId,80);
 const wanted=onlyCase?[onlyCase]:(await db.query('select distinct external_case_id from test_results r join test_runs tr on tr.id=r.run_id where tr.id=$1 order by 1',[req.params.runId])).rows.map(x=>x.external_case_id);
 const session=await projectSession(sessionId,req.params.projectId);
 if(!session)throw fail(409,'This testing session can no longer be restored. Generate the test cases again on the testing page.');
 if(session.state==='RUNNING')throw fail(409,'A test is already running in this session. Wait for it to finish.');
 if(!session.readinessValidated||!['AWAITING_APPROVAL','DONE'].includes(session.state))throw fail(409,'This session has not been reviewed. Review its test cases on the testing page before re-running.');
 const caseIds=[],blocked=[];
 for(const caseId of wanted){
  const tc=(session.testCases||[]).find(x=>String(x.id).toUpperCase()===String(caseId).toUpperCase());
  if(!tc)blocked.push({caseId,reason:'no longer in this session'});
  else if(tc.automationReadiness?.status!=='READY')blocked.push({caseId,reason:'not Automation Ready'});
  // Same AI-repair safety rule the runner applies: a repaired case needs a passing full regression first.
  else if(tc.canonicalIr&&!require('../services/repairLearning').gateCheck(session,tc).ok)blocked.push({caseId,reason:'fixed by AI repair; run the full regression on the testing page first'});
  else caseIds.push(tc.id);
 }
 res.json({ok:true,sessionId,runNumber,environment,caseIds,blocked});
 }catch(e){respond(res,e);}
});

router.post('/api/projects/:projectId/runs/:runId/rerun-link',requireAuth,requireRole('QA','MANAGER'),async(req,res)=>{
 try{
 const ctx=await access(req,req.params.projectId);reviewer(ctx.role);
 if(!id(req.params.runId))throw fail(400,'Invalid run ID.');
 const runNumber=Number(req.body?.runNumber);
 if(!Number.isInteger(runNumber)||runNumber<1)throw fail(400,'Invalid run number.');
 const src=await db.query('select session_id,run_number from test_runs where project_id=$1 and id=$2',[req.params.projectId,req.params.runId]);
 if(!src.rowCount)throw fail(404,'Run not found.');
 if(runNumber<=src.rows[0].run_number)throw fail(400,'A re-run must come after the run it repeats.');
 const caseIds=(Array.isArray(req.body?.caseIds)?req.body.caseIds:[]).map(x=>s(x,80)).filter(Boolean).slice(0,500);
 await db.query('insert into test_run_reruns(session_id,run_number,source_run_id,case_ids,started_by) values($1,$2,$3,$4::jsonb,$5) on conflict(session_id,run_number) do nothing',[src.rows[0].session_id,runNumber,req.params.runId,JSON.stringify(caseIds),req.user.sub]);
 res.json({ok:true});
 }catch(e){respond(res,e);}
});

// Testing page → "Run existing tests": the saved, reviewed test cases of this project (or story), grouped by the session
// they were generated in (one run can only use one session). Same rules as the run plan: the session is restored and
// reviewed, the case is approved and Automation Ready, and AI-repaired cases need a passing full regression first.
router.get('/api/projects/:projectId/existing-tests',requireAuth,requireRole('QA','MANAGER'),async(req,res)=>{
 try{
 const ctx=await access(req,req.params.projectId);reviewer(ctx.role);
 const storyId=id(req.query.storyId)?req.query.storyId:null;
 const rows=(storyId
  ?await db.query('select distinct s.id session_id,s.updated_at,s.environment,ps.reference_no story_ref,ps.title story_title from test_sessions s left join story_test_sessions sts on sts.session_id=s.id left join project_stories ps on ps.id=coalesce(s.project_story_id,sts.story_id) where s.project_id=$1 and (sts.story_id=$2 or s.project_story_id=$2) order by s.updated_at desc limit 60',[req.params.projectId,storyId])
  :await db.query('select s.id session_id,s.updated_at,s.environment,ps.reference_no story_ref,ps.title story_title from test_sessions s left join project_stories ps on ps.id=s.project_story_id where s.project_id=$1 order by s.updated_at desc limit 60',[req.params.projectId])).rows;
 const {gateCheck}=require('../services/repairLearning');
 // One entry per unique test: a test generated again in another session with the same steps, test data and expected
 // result is listed once (newest session), even if the AI worded its title differently. Cases that cannot run are left out.
 const norm=v=>String(v??'').trim().toLowerCase().replace(/\s+/g,' ');
 const signature=tc=>JSON.stringify([(tc.steps||[]).map(st=>typeof st==='string'?norm(st):[norm(st.action),norm(st.target),norm(st.value)]),
  (tc.expectedResults||[]).map(norm),Object.entries(tc.testData||{}).map(([k,v])=>[norm(k),norm(typeof v==='string'?v:JSON.stringify(v))]).sort()]);
 const seen=new Set(),cases=[];
 for(const row of rows){
  const session=await projectSession(row.session_id,req.params.projectId);
  if(!session||String(session.projectId)!==String(req.params.projectId)||!session.readinessValidated||!['AWAITING_APPROVAL','DONE'].includes(session.state))continue;
  for(const tc of session.testCases||[]){
   if(tc.automationReadiness?.status!=='READY'||tc.approved===false)continue;
   if(tc.canonicalIr&&!gateCheck(session,tc).ok)continue;
   const sig=signature(tc);if(seen.has(sig))continue;seen.add(sig);
   cases.push({key:row.session_id+'|'+tc.id,sessionId:row.session_id,id:tc.id,title:String(tc.title||'').replace(/^Test execution\s+\S+\s+-\s+/i,''),type:tc.type||'functional',category:tc.testCategory||null,priority:tc.priority||'medium',
    source:tc.source||'ai',steps:Array.isArray(tc.steps)?tc.steps.length:0,expected:(Array.isArray(tc.expectedResults)?tc.expectedResults:[]).slice(0,2).join(' · '),
    savedAt:row.updated_at,environment:session.environment||row.environment||null,story:row.story_ref?(row.story_ref+' · '+(row.story_title||'')):null});
  }
 }
 const envs=(await db.query('select id,name,base_url,is_default from project_environments where project_id=$1 and is_active=true order by is_default desc,name',[req.params.projectId])).rows;
 res.json({ok:true,cases,environments:envs});
 }catch(e){respond(res,e);}
});
// "Run existing tests" with another environment: point the saved session at that environment before it runs.
router.post('/api/projects/:projectId/sessions/:sessionId/environment',requireAuth,requireRole('QA','MANAGER'),async(req,res)=>{
 try{
 const ctx=await access(req,req.params.projectId);reviewer(ctx.role);
 if(!id(req.body?.environmentId))throw fail(400,'Choose an environment.');
 const env=await db.query('select name,base_url from project_environments where project_id=$1 and id=$2 and is_active=true',[req.params.projectId,req.body.environmentId]);
 if(!env.rowCount)throw fail(404,'Environment not found or disabled.');
 const session=await projectSession(s(req.params.sessionId,120),req.params.projectId);
 if(!session)throw fail(404,'This testing session can no longer be restored.');
 if(session.state==='RUNNING')throw fail(409,'A test is already running in this session.');
 session.targetUrl=env.rows[0].base_url;session.environment=env.rows[0].name;
 await persistence.persistSession(req.params.sessionId,session,{projectId:req.params.projectId,repositoryId:session.repositoryId||null,userId:req.user.sub});
 await db.query('update test_sessions set environment=$1,target_url=$4 where id=$2 and project_id=$3',[env.rows[0].name,req.params.sessionId,req.params.projectId,env.rows[0].base_url]);
 res.json({ok:true,environment:env.rows[0].name,targetUrl:env.rows[0].base_url});
 }catch(e){respond(res,e);}
});

// Validation trusts only elements seen by a page scan. A manual session reuses the project's latest scan of the same
// app address (and its element list), so selectors like [data-testid="username"] are verified without generating again.
async function reuseLatestScan(session,sessionId,projectId,targetUrl){
 if(session.pageDiscoveries?.length)return false;
 const url=String(targetUrl||session.targetUrl||'').replace(/\/+$/,''); // stored with or without a trailing slash
 const rows=(await db.query("select id from test_sessions where project_id=$1 and rtrim(target_url,'/')=$2 and id<>$3 and jsonb_array_length(coalesce(session_json->'pageDiscoveries','[]'::jsonb))>0 order by updated_at desc limit 5",[projectId,url,sessionId])).rows;
 for(const row of rows){
  const prev=await projectSession(row.id,projectId);
  if(!prev?.pageDiscoveries?.length)continue;
  session.pageDiscoveries=prev.pageDiscoveries;session.additionalPaths=prev.additionalPaths||[];session.discoveredFromSession=row.id;
  try{const store=require('../services/canonicalArtifactStore'),art=await store.load(row.id);if(art?.registry){session.canonicalElementRegistry=art.registry;await store.persistRegistry(sessionId,art.registry);}}catch(e){console.warn('[manual-session] element list not copied:',e.message);}
  return true;
 }
 return false;
}
// ---- Manual test cases (testing page ⊕ "Add Human Test Case") ----
// A manual case is saved to the database as soon as it is saved in the editor (before, it lived only in the page until
// a run). Without generated cases there is no session yet, so one is started for the project (story optional).
router.post('/api/projects/:projectId/manual-session',requireAuth,requireRole('QA','MANAGER'),async(req,res)=>{
 try{
 const ctx=await access(req,req.params.projectId);reviewer(ctx.role);
 const targetUrl=s(req.body?.targetUrl,500),environment=s(req.body?.environmentName,120)||'Test',storyId=id(req.body?.storyId)?req.body.storyId:null;
 if(!/^https?:\/\//i.test(targetUrl))throw fail(400,'The project needs an application URL or environment before adding test cases.');
 if(storyId){const st=await db.query('select id from project_stories where id=$1 and project_id=$2',[storyId,req.params.projectId]);if(!st.rowCount)throw fail(400,'Story does not belong to this project.');}
 const sessionId='run-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7);
 const session=getSession(sessionId);
 Object.assign(session,{projectId:req.params.projectId,projectStoryId:storyId,contextSource:{type:storyId?'STORY':'PROJECT',storyId,taskId:null},createdBy:req.user.sub,
  story:s(req.body?.story,20000)||'Manual test cases',targetUrl,environment,state:'AWAITING_APPROVAL',testCases:[],manualOnly:true});
 await reuseLatestScan(session,sessionId,req.params.projectId,targetUrl);
 await persistence.persistSession(sessionId,session,{projectId:req.params.projectId,userId:req.user.sub});
 if(storyId){await db.query('update test_sessions set project_story_id=$1 where id=$2',[storyId,sessionId]);await db.query('insert into story_test_sessions(story_id,session_id) values($1,$2) on conflict do nothing',[storyId,sessionId]);}
 res.status(201).json({ok:true,sessionId,pagesScanned:(session.pageDiscoveries||[]).length,elementsKnown:session.canonicalElementRegistry?.elements?.length||0});
 }catch(e){respond(res,e);}
});
router.post('/api/projects/:projectId/sessions/:sessionId/manual-test-cases',requireAuth,requireRole('QA','MANAGER'),async(req,res)=>{
 try{
 const ctx=await access(req,req.params.projectId);reviewer(ctx.role);
 const session=await projectSession(s(req.params.sessionId,120),req.params.projectId);
 if(!session)throw fail(404,'This testing session is not part of the project.');
 if(session.state==='RUNNING')throw fail(409,'Wait for the current run to finish.');
 await reuseLatestScan(session,s(req.params.sessionId,120),req.params.projectId,session.targetUrl); // older manual sessions had no scan
 const raw=req.body?.testCase||{},list=v=>(Array.isArray(v)?v:[]).map(x=>typeof x==='string'?s(x,2000):x).filter(Boolean).slice(0,100);
 const caseId=s(raw.id,40).toUpperCase();
 if(!/^TC-?[A-Z]?\d{1,4}$/.test(caseId))throw fail(400,'Invalid test case ID.');
 if(!s(raw.title))throw fail(400,'Title is required.');
 const prev=(session.testCases||[]).find(x=>String(x.id).toUpperCase()===caseId);
 // Keep everything the editor sends (e.g. the manual automation script and its parsed form); the main fields are cleaned below.
 const tc={...(prev||{}),...raw,id:caseId,title:s(raw.title,300),type:s(raw.type,40)||'functional',priority:s(raw.priority,20)||'medium',
  preconditions:list(raw.preconditions),steps:list(raw.steps),expectedResults:list(raw.expectedResults),testData:raw.testData&&typeof raw.testData==='object'?raw.testData:(prev?.testData||{}),
  testCategory:s(raw.testCategory,40).toUpperCase()||prev?.testCategory||'FUNCTIONAL',testSubcategory:s(raw.testSubcategory,80)||prev?.testSubcategory||null,
  securitySubcategory:raw.securitySubcategory?s(raw.securitySubcategory,60):(prev?.securitySubcategory||null),
  // Keep the page's own label: human (⊕ Manually), ai-on-demand (⊕ With AI), ai-reviewed (an AI case edited), ai-canonical (generated).
  source:/^(human|ai)/.test(String(raw.source||''))?s(raw.source,40):prev?.source||'human',createdBy:prev?.createdBy||req.user.sub};
 // An edited case must be validated again before it can run (same rule as the testing page's own editor).
 if(prev&&JSON.stringify([prev.steps,prev.expectedResults,prev.preconditions])!==JSON.stringify([tc.steps,tc.expectedResults,tc.preconditions]))delete tc.automationReadiness;
 session.testCases=prev?(session.testCases||[]).map(x=>String(x.id).toUpperCase()===caseId?tc:x):[tc,...(session.testCases||[])];
 await persistence.persistSession(req.params.sessionId,session,{projectId:req.params.projectId,userId:req.user.sub});
 await persistence.persistTestCases(req.params.sessionId,[tc],null,req.user.sub);
 res.json({ok:true,testCase:{id:tc.id,source:tc.source,testCategory:tc.testCategory}});
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

// Team directory is reusable; attachment to a project is explicitly authorized.
router.get('/api/teams',requireAuth,async(req,res)=>{try{
 const r=await db.query('select t.id,t.name,t.description,count(tm.user_id)::int as member_count from teams t left join team_members tm on tm.team_id=t.id group by t.id order by t.name');
 res.json({ok:true,teams:r.rows});
}catch(e){respond(res,e);}});
// Audit trail for team changes: actor = the signed-in user; team and member names are read from the database.
async function teamAudit(projectId,actorId,eventType,teamId,userId=null){
 await db.query(`insert into project_audit_events(project_id,actor_id,event_type,metadata)
  select $1,$2,$3,jsonb_build_object('teamId',t.id,'teamName',t.name)||coalesce((select jsonb_build_object('userId',u.id,'memberName',u.display_name,'memberEmail',u.email) from users u where u.id=$5),'{}'::jsonb)
  from teams t where t.id=$4`,[projectId,actorId,eventType,teamId,userId]);
}
// ---- Project teams (owned by one project): list, create, rename, delete, and set a member's team ----
router.get('/api/projects/:projectId/project-teams',requireAuth,async(req,res)=>{try{
 await access(req,req.params.projectId);
 const teams=await db.query('select t.id,t.name,(select count(*)::int from team_members tm join project_members pm on pm.user_id=tm.user_id and pm.project_id=t.project_id where tm.team_id=t.id) as member_count from teams t where t.project_id=$1 order by lower(t.name)',[req.params.projectId]);
 const memberships=await db.query('select tm.team_id,tm.user_id from team_members tm join teams t on t.id=tm.team_id where t.project_id=$1',[req.params.projectId]);
 res.json({ok:true,teams:teams.rows,memberships:memberships.rows});
}catch(e){respond(res,e);}});
router.post('/api/projects/:projectId/project-teams',requireAuth,async(req,res)=>{try{
 const ctx=await access(req,req.params.projectId);manager(ctx.role);
 const name=s(req.body?.name,120);if(!name)throw fail(400,'Team name is required.');
 const team=await db.withTransaction(async client=>{
  const dup=await client.query('select 1 from teams where project_id=$1 and lower(name)=lower($2)',[req.params.projectId,name]);if(dup.rowCount)throw fail(409,'A team with this name already exists in this project.');
  const t=await client.query('insert into teams(name,project_id,created_by) values($1,$2,$3) returning id,name',[name,req.params.projectId,req.user.sub]);
  // Linked to the project so the existing task-assignment rule (members must be in a project team) keeps working.
  await client.query('insert into project_teams(project_id,team_id) values($1,$2) on conflict do nothing',[req.params.projectId,t.rows[0].id]);
  await client.query("insert into project_audit_events(project_id,actor_id,event_type,metadata) values($1,$2,'TEAM_CREATED',$3::jsonb)",[req.params.projectId,req.user.sub,JSON.stringify({teamId:t.rows[0].id,teamName:name})]);
  return t.rows[0];
 });
 res.status(201).json({ok:true,team});
}catch(e){respond(res,e);}});
router.patch('/api/projects/:projectId/project-teams/:teamId',requireAuth,async(req,res)=>{try{
 const ctx=await access(req,req.params.projectId);manager(ctx.role);
 const name=s(req.body?.name,120);if(!name)throw fail(400,'Team name is required.');
 const dup=await db.query('select 1 from teams where project_id=$1 and lower(name)=lower($2) and id<>$3',[req.params.projectId,name,req.params.teamId]);if(dup.rowCount)throw fail(409,'A team with this name already exists in this project.');
 const r=await db.query('update teams t set name=$1 from teams old where t.id=old.id and t.id=$2 and t.project_id=$3 returning t.id,t.name,old.name as old_name',[name,req.params.teamId,req.params.projectId]);
 if(!r.rowCount)throw fail(404,'Team not found in this project.');
 await db.query("insert into project_audit_events(project_id,actor_id,event_type,metadata) values($1,$2,'TEAM_RENAMED',$3::jsonb)",[req.params.projectId,req.user.sub,JSON.stringify({teamId:r.rows[0].id,oldName:r.rows[0].old_name,teamName:name})]);
 res.json({ok:true,team:{id:r.rows[0].id,name}});
}catch(e){respond(res,e);}});
router.delete('/api/projects/:projectId/project-teams/:teamId',requireAuth,async(req,res)=>{try{
 const ctx=await access(req,req.params.projectId);manager(ctx.role);
 const r=await db.query('delete from teams where id=$1 and project_id=$2 returning id,name',[req.params.teamId,req.params.projectId]);
 if(!r.rowCount)throw fail(404,'Team not found in this project.');
 await db.query("insert into project_audit_events(project_id,actor_id,event_type,metadata) values($1,$2,'TEAM_DELETED',$3::jsonb)",[req.params.projectId,req.user.sub,JSON.stringify({teamId:r.rows[0].id,teamName:r.rows[0].name})]);
 res.json({ok:true});
}catch(e){respond(res,e);}});
// A member belongs to at most one team of the project; teamId null removes them from the project's teams.
router.put('/api/projects/:projectId/members/:userId/team',requireAuth,async(req,res)=>{try{
 const ctx=await access(req,req.params.projectId);manager(ctx.role);
 if(!id(req.params.userId))throw fail(400,'Valid user ID required.');
 const member=await db.query('select u.display_name from project_members pm join users u on u.id=pm.user_id where pm.project_id=$1 and pm.user_id=$2',[req.params.projectId,req.params.userId]);
 if(!member.rowCount)throw fail(404,'This person is not a member of the project.');
 const teamId=req.body?.teamId||null;
 let teamName=null;
 if(teamId){const t=await db.query('select name from teams where id=$1 and project_id=$2',[teamId,req.params.projectId]);if(!t.rowCount)throw fail(400,'Team does not belong to this project.');teamName=t.rows[0].name;}
 await db.withTransaction(async client=>{
  await client.query('delete from team_members where user_id=$1 and team_id in (select id from teams where project_id=$2)',[req.params.userId,req.params.projectId]);
  if(teamId)await client.query('insert into team_members(team_id,user_id) values($1,$2) on conflict do nothing',[teamId,req.params.userId]);
  await client.query("insert into project_audit_events(project_id,actor_id,event_type,metadata) values($1,$2,'MEMBER_TEAM_CHANGED',$3::jsonb)",[req.params.projectId,req.user.sub,JSON.stringify({userId:req.params.userId,memberName:member.rows[0].display_name,teamName})]);
 });
 res.json({ok:true,teamId,teamName});
}catch(e){respond(res,e);}});
router.post('/api/teams',requireAuth,requireRole('MANAGER'),async(req,res)=>{try{
 const name=s(req.body?.name,120);if(!name)throw fail(400,'Team name is required.');
 const r=await db.query('insert into teams(name,description,created_by) values($1,$2,$3) on conflict ((lower(name))) do update set description=excluded.description returning *',[name,s(req.body?.description,1000),req.user.sub]);
 res.status(201).json({ok:true,team:r.rows[0]});
}catch(e){respond(res,e);}});
router.post('/api/teams/:teamId/members',requireAuth,async(req,res)=>{try{
 if(!id(req.params.teamId)||!id(req.body?.userId))throw fail(400,'Valid team and user IDs required.');
 const targetProject=req.body?.projectId;
 if(targetProject){const ctx=await access(req,targetProject);manager(ctx.role);const attached=await db.query('select 1 from project_teams where project_id=$1 and team_id=$2',[targetProject,req.params.teamId]);if(!attached.rowCount)throw fail(403,'Team must be attached to the selected project.');const member=await db.query('select 1 from project_members where project_id=$1 and user_id=$2',[targetProject,req.body.userId]);if(!member.rowCount)throw fail(400,'User must belong to the project.');}
 else if(req.user.role!=='MANAGER')throw fail(403,'Global manager access required without a project.');
 if(targetProject&&req.user.role!=='MANAGER'){const shared=await db.query('select count(*)::int as total from project_teams where team_id=$1',[req.params.teamId]);if(shared.rows[0].total>1)throw fail(409,'Team is shared across projects; global manager must change membership.');}
 const r=await db.query('insert into team_members(team_id,user_id) select $1,u.id from users u where u.id=$2 and u.is_active=true on conflict do nothing returning user_id',[req.params.teamId,req.body.userId]);
 if(r.rowCount&&targetProject)await teamAudit(targetProject,req.user.sub,'TEAM_MEMBER_ADDED',req.params.teamId,req.body.userId);
 res.status(r.rowCount?201:200).json({ok:true});
}catch(e){respond(res,e);}});
router.delete('/api/projects/:projectId/teams/:teamId/members/:userId',requireAuth,async(req,res)=>{try{
 const ctx=await access(req,req.params.projectId);manager(ctx.role);
 const attached=await db.query('select 1 from project_teams where project_id=$1 and team_id=$2',[req.params.projectId,req.params.teamId]);
 if(!attached.rowCount)throw fail(404,'Team not associated with project.');
 const shared=await db.query('select count(*)::int as total from project_teams where team_id=$1',[req.params.teamId]);if(shared.rows[0].total>1)throw fail(409,'Team is shared across projects; manage its global membership as a platform manager.');
 await teamAudit(req.params.projectId,req.user.sub,'TEAM_MEMBER_REMOVED',req.params.teamId,req.params.userId);
 await db.query('delete from team_members where team_id=$1 and user_id=$2',[req.params.teamId,req.params.userId]);
 res.json({ok:true});
}catch(e){respond(res,e);}});
router.get('/api/projects/:projectId/team-members',requireAuth,async(req,res)=>{try{
 await access(req,req.params.projectId);
 const r=await db.query(`select pt.team_id,u.id as user_id,u.display_name,u.email from project_teams pt join team_members tm on tm.team_id=pt.team_id join users u on u.id=tm.user_id join project_members pm on pm.project_id=pt.project_id and pm.user_id=u.id where pt.project_id=$1 order by u.display_name`,[req.params.projectId]);
 res.json({ok:true,members:r.rows});
}catch(e){respond(res,e);}});
router.delete('/api/teams/:teamId/members/:userId',requireAuth,requireRole('MANAGER'),async(req,res)=>{try{
 if(!id(req.params.teamId)||!id(req.params.userId))throw fail(400,'Valid team and user IDs required.');
 await db.query('delete from team_members where team_id=$1 and user_id=$2',[req.params.teamId,req.params.userId]);
 res.json({ok:true});
}catch(e){respond(res,e);}});
router.get('/api/teams/:teamId/members',requireAuth,requireRole('MANAGER'),async(req,res)=>{try{
 if(!id(req.params.teamId))throw fail(400,'Valid team ID required.');
 const r=await db.query('select u.id,u.display_name,u.email from team_members tm join users u on u.id=tm.user_id where tm.team_id=$1 order by u.display_name',[req.params.teamId]);
 res.json({ok:true,members:r.rows});
}catch(e){respond(res,e);}});
router.get('/api/projects/:projectId/teams',requireAuth,async(req,res)=>{try{
 await access(req,req.params.projectId);
 const r=await db.query('select t.id,t.name,t.description from project_teams pt join teams t on t.id=pt.team_id where pt.project_id=$1 order by t.name',[req.params.projectId]);
 res.json({ok:true,teams:r.rows});
}catch(e){respond(res,e);}});
router.post('/api/projects/:projectId/teams',requireAuth,async(req,res)=>{try{
 const ctx=await access(req,req.params.projectId);manager(ctx.role);
 if(!id(req.body?.teamId))throw fail(400,'Valid team ID required.');
 const r=await db.query('insert into project_teams(project_id,team_id) select $1,id from teams where id=$2 on conflict do nothing returning team_id',[req.params.projectId,req.body.teamId]);
 if(!r.rowCount)throw fail(404,'Team not found or already associated.');
 await teamAudit(req.params.projectId,req.user.sub,'TEAM_ATTACHED',req.body.teamId);
 res.status(201).json({ok:true});
}catch(e){respond(res,e);}});
router.delete('/api/projects/:projectId/teams/:teamId',requireAuth,async(req,res)=>{try{
 const ctx=await access(req,req.params.projectId);manager(ctx.role);
 await teamAudit(req.params.projectId,req.user.sub,'TEAM_DETACHED',req.params.teamId);
 await db.query('delete from project_teams where project_id=$1 and team_id=$2',[req.params.projectId,req.params.teamId]);
 res.json({ok:true});
}catch(e){respond(res,e);}});
router.get('/api/projects/:projectId/team-assignees',requireAuth,async(req,res)=>{try{
 await access(req,req.params.projectId);
 const r=await db.query(`select distinct u.id,u.display_name,u.email,pm.project_role from project_members pm join users u on u.id=pm.user_id where pm.project_id=$1 and u.is_active=true and (exists(select 1 from project_teams pt join team_members tm on tm.team_id=pt.team_id where pt.project_id=$1 and tm.user_id=u.id) or not exists(select 1 from project_teams pt0 join team_members tm0 on tm0.team_id=pt0.team_id join project_members pm0 on pm0.project_id=pt0.project_id and pm0.user_id=tm0.user_id where pt0.project_id=$1)) order by u.display_name`,[req.params.projectId]);
 res.json({ok:true,users:r.rows});
}catch(e){respond(res,e);}});
router.get('/api/projects/:projectId/test-inventory',requireAuth,async(req,res)=>{try{
 await access(req,req.params.projectId);
 const [cases,runs,stories]=await Promise.all([
 db.query(`select tc.session_id,tc.external_case_id,tc.title,tc.priority,tc.source,tc.test_category,tc.type,tc.created_at,tc.updated_at,cu.display_name as created_by_name,uu.display_name as updated_by_name,sts.story_id,ps.reference_no as story_reference from test_cases tc join test_sessions ts on ts.id=tc.session_id left join users cu on cu.id=tc.created_by left join users uu on uu.id=tc.updated_by left join story_test_sessions sts on sts.session_id=ts.id left join project_stories ps on ps.id=sts.story_id where ts.project_id=$1 order by tc.created_at desc limit 1000`,[req.params.projectId]),
 db.query('select id,session_id,run_number,total,passed,failed,executed_by,completed_at from test_runs where project_id=$1 order by completed_at desc limit 500',[req.params.projectId]),
 db.query(`select ps.id,ps.reference_no,ps.title,count(distinct sts.session_id)::int as generation_count,count(distinct tc.id)::int as case_count,count(distinct tr.id)::int as execution_count from project_stories ps left join story_test_sessions sts on sts.story_id=ps.id left join test_cases tc on tc.session_id=sts.session_id left join test_runs tr on tr.session_id=sts.session_id where ps.project_id=$1 group by ps.id order by ps.created_at desc`,[req.params.projectId])
 ]);
 res.json({ok:true,cases:cases.rows,runs:runs.rows,stories:stories.rows});
}catch(e){respond(res,e);}});
router.get('/api/projects/:projectId/audit',requireAuth,async(req,res)=>{try{
 await access(req,req.params.projectId);
 const r=await db.query(`select a.*,u.display_name as actor_name from project_audit_events a left join users u on u.id=a.actor_id where a.project_id=$1 order by a.created_at desc limit 300`,[req.params.projectId]);
 res.json({ok:true,events:r.rows});
}catch(e){respond(res,e);}});
router.get('/api/projects/:projectId/report-snapshots',requireAuth,async(req,res)=>{try{
 await access(req,req.params.projectId);
 const kind=s(req.query.kind,30).toUpperCase();
 if(kind&&!['REVIEWED_CASE','EXECUTION','AI_LEARNING'].includes(kind))throw fail(400,'Invalid report kind.');
 const r=await db.query("select id,session_id,run_id,external_case_id,report_kind,revision,report_json,recorded_by,created_at from test_report_snapshots where project_id=$1 and ($2::text='' or report_kind=$2) order by created_at desc limit 250",[req.params.projectId,kind]);
 res.json({ok:true,reports:r.rows});
}catch(e){respond(res,e);}});
// Run details page: the run, every test result (failed first) and its saved execution report.
router.get('/api/projects/:projectId/runs/:runId/details',requireAuth,async(req,res)=>{try{
 await access(req,req.params.projectId);
 if(!id(req.params.runId))throw fail(400,'Invalid run ID.');
 const run=await db.query('select r.id,r.session_id,r.run_number,r.total,r.passed,r.failed,r.duration_ms,r.browser,r.completed_at,r.summary_json,t.environment,t.target_url,ps.reference_no story_ref,ps.title story_title,u.display_name executed_by_name from test_runs r left join test_sessions t on t.id=r.session_id left join project_stories ps on ps.id=t.project_story_id left join users u on u.id=r.executed_by where r.project_id=$1 and r.id=$2',[req.params.projectId,req.params.runId]);
 if(!run.rowCount)throw fail(404,'Run not found.');
 const results=await db.query(`select te.external_case_id,te.title,te.passed,te.duration_ms,te.error_message,te.evidence_json,te.test_category,te.scenario_type,te.priority,te.severity,
   lt.passed latest_passed,lt.run_id latest_run_id,lt.run_number latest_run_number,lt.completed_at latest_completed_at,lt.executed_by_name latest_by_name,
   (select count(*) from test_results y join test_runs yr on yr.id=y.run_id where yr.session_id=$2 and y.external_case_id=te.external_case_id)::int times_run,
   tc.created_at case_created_at,tcu.display_name case_created_by_name
  from test_results te left join test_cases tc on tc.session_id=$2 and tc.external_case_id=te.external_case_id left join users tcu on tcu.id=tc.created_by left join lateral (
   select x.passed,rr.id run_id,rr.run_number,rr.completed_at,u.display_name executed_by_name from test_results x join test_runs rr on rr.id=x.run_id left join users u on u.id=rr.executed_by
    where rr.session_id=$2 and x.external_case_id=te.external_case_id order by rr.completed_at desc nulls last,rr.run_number desc limit 1) lt on true
  where te.run_id=$1 order by te.passed asc,te.external_case_id`,[req.params.runId,run.rows[0].session_id]);
 const report=await db.query("select s.id,s.created_at,(s.report_html is not null) has_html,u.display_name recorded_by_name from test_report_snapshots s left join users u on u.id=s.recorded_by where s.project_id=$1 and s.run_id=$2 and s.report_kind='EXECUTION' order by s.created_at desc limit 1",[req.params.projectId,req.params.runId]);
 const reruns=await db.query('select kr.id,kr.run_number,kr.completed_at,ku.display_name executed_by_name from test_runs r join test_runs kr on kr.session_id=r.session_id and kr.run_number>r.run_number and not exists (select 1 from test_results a where a.run_id=r.id and not exists (select 1 from test_results b where b.run_id=kr.id and b.external_case_id=a.external_case_id)) left join users ku on ku.id=kr.executed_by where r.id=$1 order by kr.run_number',[req.params.runId]);
 const source=await db.query('select src.id,src.run_number from test_run_reruns k join test_runs src on src.id=k.source_run_id where k.session_id=$1 and k.run_number=$2',[run.rows[0].session_id,run.rows[0].run_number]);
 const r=run.rows[0],summary=r.summary_json||{};delete r.summary_json;
 res.json({ok:true,run:{...r,execution_mode:summary.executionMode||null,skipped:Number(summary.skipped||0)},results:results.rows,report:report.rows[0]||null,reruns:reruns.rows,source:source.rows[0]||null});
}catch(e){respond(res,e);}});
// Run page (Runs & reports → 👁): the run (attempt 1), all its attempts, and each test case's latest result across them.
router.get('/api/projects/:projectId/runs/:runId/group',requireAuth,async(req,res)=>{try{
 await access(req,req.params.projectId);
 if(!id(req.params.runId))throw fail(400,'Invalid run ID.');
 const {byId,rootOf,groups}=await runGroups(req.params.projectId);
 if(!byId.has(req.params.runId))throw fail(404,'Run not found.');
 const list=groups.get(rootOf(req.params.runId)),root=list[0],hasAi=await aiAvailability(req.params.projectId,[...groups.values()].flat());
 const state=await groupCaseState(list);
 const created=new Map((await db.query('select c.external_case_id,c.created_at,c.source,u.display_name created_by_name from test_cases c left join users u on u.id=c.created_by where c.session_id=$1',[root.session_id])).rows.map(c=>[c.external_case_id,c]));
 const cases=root.case_ids.map(c=>state.get(c)).filter(Boolean).sort((a,b)=>String(a.external_case_id).localeCompare(String(b.external_case_id),undefined,{numeric:true})).map(c=>({
  external_case_id:c.external_case_id,title:c.first.title,test_category:c.first.test_category,scenario_type:c.first.scenario_type,priority:c.first.priority,
  passed:c.passed,times_run:c.times_run,latest_attempt:c.latest_attempt,latest_by_name:c.latest_by_name,latest_completed_at:c.latest_completed_at,
  case_created_at:created.get(c.external_case_id)?.created_at||null,case_created_by_name:created.get(c.external_case_id)?.created_by_name||null,source:created.get(c.external_case_id)?.source||null}));
 res.json({ok:true,run:{id:root.id,session_id:root.session_id,run_number:root.project_run_number??root.run_number,environment:root.environment,executed_by_name:root.executed_by_name,completed_at:root.completed_at},
  attempts:list.map((a,i)=>({id:a.id,attempt:i+1,run_number:a.run_number,passed:a.passed,failed:a.failed,total:a.total,completed_at:a.completed_at,executed_by_name:a.executed_by_name,has_ai_report:hasAi(a)})),cases});
}catch(e){respond(res,e);}});
// AI report of one run (Runs & reports → Actions). Old runs saved before reports were kept per run: the session's report
// file is used only when that session has a single run, because then it can only belong to this run.
router.get('/api/projects/:projectId/runs/:runId/ai-report',requireAuth,async(req,res)=>{try{
 await access(req,req.params.projectId);
 if(!id(req.params.runId))throw fail(400,'Invalid run ID.');
 const run=await db.query('select session_id,run_number,(select count(*) from test_runs x where x.session_id=r.session_id)::int runs_in_session from test_runs r where project_id=$1 and id=$2',[req.params.projectId,req.params.runId]);
 if(!run.rowCount)throw fail(404,'Run not found.');
 const snap=await db.query("select report_html from test_report_snapshots where run_id=$1 and report_kind='AI_ANALYSIS' and report_html is not null order by revision desc limit 1",[req.params.runId]);
 let html=snap.rows[0]?.report_html||null;
 if(!html&&run.rows[0].runs_in_session===1){
  const {REPORT_DIR,reportFileName}=require('../services/reportGenerator');
  const file=require('path').join(REPORT_DIR,reportFileName(run.rows[0].session_id));
  if(require('fs').existsSync(file))html=require('fs').readFileSync(file,'utf8');
 }
 if(!html)throw fail(404,'No AI report was generated for this run.');
 res.setHeader('Content-Type','text/html; charset=utf-8');res.send(html);
}catch(e){respond(res,e);}});
// Test case popup (Run details → Actions): the case itself (steps, test data, passing criteria) and every run of it.
// History is matched by session + case ID, because generated case IDs (TC001…) restart in every session.
router.get('/api/projects/:projectId/runs/:runId/cases/:caseId',requireAuth,async(req,res)=>{try{
 await access(req,req.params.projectId);
 if(!id(req.params.runId))throw fail(400,'Invalid run ID.');
 const caseId=String(req.params.caseId||'').slice(0,80);
 const run=await db.query('select session_id from test_runs where project_id=$1 and id=$2',[req.params.projectId,req.params.runId]);
 if(!run.rowCount)throw fail(404,'Run not found.');
 const sessionId=run.rows[0].session_id;
 const tc=await db.query('select c.external_case_id,c.title,c.type,c.priority,c.case_json,c.created_at,c.updated_at,cu.display_name created_by_name,uu.display_name updated_by_name from test_cases c left join users cu on cu.id=c.created_by left join users uu on uu.id=c.updated_by where c.session_id=$1 and c.external_case_id=$2',[sessionId,caseId]);
 const history=await db.query(`select rr.id run_id,rr.run_number,rr.completed_at,u.display_name executed_by_name,t.environment,x.title,x.passed,x.error_message,x.evidence_json,x.priority
   from test_results x join test_runs rr on rr.id=x.run_id left join test_sessions t on t.id=rr.session_id left join users u on u.id=rr.executed_by
  where rr.project_id=$1 and rr.session_id=$2 and x.external_case_id=$3 order by rr.completed_at desc nulls last,rr.run_number desc`,[req.params.projectId,sessionId,caseId]);
 if(!tc.rowCount&&!history.rowCount)throw fail(404,'Test case not found.');
 // Evidence links are sent only when the file still exists, so the popup never offers a screenshot that is gone.
 // Per-run evidence (run-evidence folder, recorded in test_run_evidence) is permanent. Older links (/api/artifacts/...)
 // point at the session's latest files kept in memory, so they are valid only for the newest run and only while the file exists.
 const saved=await db.query('select run_id,kind,relative_path from test_run_evidence where run_id=any($1::uuid[]) and external_case_id=$2',[history.rows.map(x=>x.run_id),caseId]);
 const onDisk=async rel=>{const f=path.resolve(ARTIFACT_ROOT,rel);if(!f.startsWith(ARTIFACT_ROOT+path.sep))return false;try{await fs.promises.access(f,fs.constants.R_OK);return true;}catch{return false;}};
 const legacy=getSession(sessionId).artifacts||{};
 for(const [i,x] of history.rows.entries()){
  const ev=x.evidence_json?.evidence||x.evidence_json||{},out={};
  for(const kind of ['screenshot','video']){
   // A permanently stored file for this run always wins, even if the result's link was later rewritten.
   const row=saved.rows.find(e=>e.run_id===x.run_id&&e.kind===kind);
   if(row&&await onDisk(row.relative_path)){out[kind+'Url']='/api/projects/'+encodeURIComponent(req.params.projectId)+'/run-evidence/'+x.run_id+'/'+encodeURIComponent(caseId)+'/'+kind;continue;}
   const url=ev[kind+'Url'];if(typeof url!=='string')continue;
   if(url.startsWith('/api/artifacts/')&&i===0){const file=(kind==='video'?legacy.videosByTestCase:legacy.screenshotsByTestCase)?.[String(caseId).toUpperCase()];if(file&&fs.existsSync(file))out[kind+'Url']=url;}
  }
  x.evidence_json=out;
 }
 const c=tc.rows[0]||null,j=c?.case_json||{};
 res.json({ok:true,testCase:c?{id:c.external_case_id,title:c.title,type:c.type,priority:c.priority,category:j.testCategory||null,source:j.source||null,
   preconditions:Array.isArray(j.preconditions)?j.preconditions:[],steps:Array.isArray(j.steps)?j.steps:[],testData:j.testData&&typeof j.testData==='object'?j.testData:{},
   expectedResults:Array.isArray(j.expectedResults)?j.expectedResults:[],review:j.review||null,
   created_at:c.created_at,created_by_name:c.created_by_name,updated_at:c.updated_at,updated_by_name:c.updated_by_name}:null,history:history.rows});
}catch(e){respond(res,e);}});
router.get('/api/projects/:projectId/report-snapshots/:reportId',requireAuth,async(req,res)=>{try{
 await access(req,req.params.projectId);
 if(!id(req.params.reportId))throw fail(400,'Invalid report ID.');
 const r=await db.query('select * from test_report_snapshots where project_id=$1 and id=$2',[req.params.projectId,req.params.reportId]);
 if(!r.rowCount)throw fail(404,'Report not found.');
 if(req.query.format==='html'){if(!r.rows[0].report_html)throw fail(404,'HTML report unavailable.');res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Content-Security-Policy',"sandbox; default-src 'none'; style-src 'unsafe-inline'");return res.send(r.rows[0].report_html);}
 const {report_html,...report}=r.rows[0];res.json({ok:true,report,hasHtml:!!report_html});
}catch(e){respond(res,e);}});
router.post('/api/projects/:projectId/repair-memory',requireAuth,async(req,res)=>{try{
 const ctx=await access(req,req.params.projectId);reviewer(ctx.role);
 const repair=await require('../services/repairMemoryService').propose({projectId:req.params.projectId,entry:req.body,userId:req.user.sub});
 res.status(201).json({ok:true,repair});
}catch(e){respond(res,e);}});
// Change a learning between Project-specific and Global (QA / project manager of the owning project).
router.patch('/api/projects/:projectId/repair-memory/:memoryId/scope',requireAuth,async(req,res)=>{try{
 const ctx=await access(req,req.params.projectId);reviewer(ctx.role);
 const result=await require('../services/repairMemoryService').setScope({projectId:req.params.projectId,memoryId:req.params.memoryId,scope:req.body?.scope,userId:req.user.sub});
 await db.query("insert into project_audit_events(project_id,actor_id,event_type,metadata) values($1,$2,'LEARNING_SCOPE_CHANGED',$3::jsonb)",[req.params.projectId,req.user.sub,JSON.stringify({memoryId:result.id,scope:result.scope})]);
 res.json({ok:true,repair:result});
}catch(e){respond(res,e);}});
router.post('/api/projects/:projectId/repair-memory/:memoryId/verify',requireAuth,async(req,res)=>{try{
 const ctx=await access(req,req.params.projectId);reviewer(ctx.role);
 const result=await require('../services/repairMemoryService').verifyApplied({projectId:req.params.projectId,memoryId:req.params.memoryId,runId:req.body?.runId,userId:req.user.sub});
 res.json({ok:true,...result});
}catch(e){respond(res,e);}});
// Verified repairs are project-scoped suggestions; applying them still requires the existing review/approval workflow.
router.get('/api/projects/:projectId/repair-memory',requireAuth,async(req,res)=>{try{
 await access(req,req.params.projectId);
 const memory=require('../services/repairMemoryService');
 const repairs=await memory.suggestions(req.params.projectId,{pagePath:req.query.pagePath,limit:req.query.limit,view:req.query.scope});
 res.json({ok:true,repairs:repairs.map(r=>({...r,recommendation:memory.recommendation(r)})),reusePolicy:'review_required'});
}catch(e){respond(res,e);}});
router.post('/api/projects/:projectId/repair-memory/:memoryId/events',requireAuth,async(req,res)=>{try{
 const ctx=await access(req,req.params.projectId);reviewer(ctx.role);
 const eventType=s(req.body?.eventType,20).toUpperCase();
 if(!['SUGGESTED','APPLIED','SUCCEEDED','FAILED','REVOKED'].includes(eventType))throw fail(400,'Invalid reuse event.');
 const sessionId=s(req.body?.sessionId,150)||null;
 const runId=s(req.body?.runId,50)||null;
 if(sessionId){const owned=await db.query('select 1 from test_sessions where id=$1 and project_id=$2',[sessionId,req.params.projectId]);if(!owned.rowCount)throw fail(400,'Session does not belong to project.');}
 if(runId){const owned=await db.query('select 1 from test_runs where id=$1 and project_id=$2',[runId,req.params.projectId]);if(!owned.rowCount)throw fail(400,'Run does not belong to project.');}
 if(['APPLIED','SUCCEEDED','FAILED'].includes(eventType)&&!runId)throw fail(400,'Run ID required for applied repair events.');
 const result=await require('../services/repairMemoryService').recordReuse({projectId:req.params.projectId,memoryId:req.params.memoryId,sessionId,runId,eventType,userId:req.user.sub});
 res.json({ok:true,...result});
}catch(e){respond(res,e);}});
// ---- Failed tests as tasks: the failed test case and its failure, and the assignee's progress ----
const {REASON_LABELS,ROLE_LABELS}=require('../services/failureAssignment');
router.get('/api/work-items/:id/failure',requireAuth,async(req,res)=>{
 try{
 const ctx=await task(req),w=ctx.item;
 if(!w.session_id||!w.external_case_id)return res.json({ok:true,testCase:null,failure:null});
 const c=(await db.query(`select c.external_case_id,c.title,c.type,c.priority,c.source,c.test_category,c.case_json,c.created_at,c.updated_at,
   cu.display_name created_by_name,uu.display_name updated_by_name,ps.reference_no story_ref,ps.title story_title
   from test_cases c left join users cu on cu.id=c.created_by left join users uu on uu.id=c.updated_by
   left join test_sessions ts on ts.id=c.session_id left join project_stories ps on ps.id=ts.project_story_id
   where c.session_id=$1 and c.external_case_id=$2`,[w.session_id,w.external_case_id])).rows[0]||null;
 const j=c?.case_json||{};
 const runNo=async rid=>rid?(await db.query('select id,coalesce(project_run_number,run_number) as number from test_runs where id=$1',[rid])).rows[0]||null:null;
 const [first,last]=await Promise.all([runNo(w.first_failed_run_id),runNo(w.last_failed_run_id||w.run_id)]);
 const result=w.test_result_id?(await db.query('select error_message from test_results where id=$1',[w.test_result_id])).rows[0]||null:null;
 // Latest result of this case in the project: does it still fail?
 const latest=(await db.query(`select r.passed,coalesce(tr.project_run_number,tr.run_number) as number from test_results r join test_runs tr on tr.id=r.run_id
   where tr.session_id=$1 and r.external_case_id=$2 order by tr.completed_at desc nulls last limit 1`,[w.session_id,w.external_case_id])).rows[0]||null;
 const ai=w.defect_analysis_id?(await db.query('select classification,confidence,summary from defect_analyses where id=$1',[w.defect_analysis_id])).rows[0]||null:null;
 const env=(await db.query("select session_json->>'environment' as env from test_sessions where id=$1",[w.session_id])).rows[0]?.env||null;
 const team=w.team_id?(await db.query('select name from teams where id=$1',[w.team_id])).rows[0]?.name||null:null;
 const reason=w.metadata?.aiReason||null;
 res.json({ok:true,
  testCase:c?{id:c.external_case_id,title:c.title,source:c.source,category:c.test_category,type:c.type,priority:c.priority,
   story:c.story_ref?{ref:c.story_ref,title:c.story_title}:null,page:j.pageUrl||j.page||j.targetPath||null,
   steps:Array.isArray(j.steps)?j.steps:[],expected:Array.isArray(j.expectedResults)?j.expectedResults:[],
   createdAt:c.created_at,createdBy:c.created_by_name,updatedAt:c.updated_at,updatedBy:c.updated_by_name}:null,
  failure:w.origin==='FAILED_TEST'?{count:w.failure_count||0,firstRun:first,lastRun:last,runId:(w.last_failed_run_id||w.run_id)||null,environment:env,
   error:result?.error_message||null,latest:latest?{passed:latest.passed,run:latest.number}:null,
   aiReason:reason,aiReasonLabel:REASON_LABELS[reason]||null,ai:ai?{confidence:ai.confidence,summary:ai.summary}:null,
   team,role:w.assigned_role||null,roleLabel:ROLE_LABELS[w.assigned_role]||null,bySystem:Boolean(w.assigned_by_system)}:null});
 }catch(e){respond(res,e);}
});
// The assignee (or QA / Project Manager) reports progress and adds time spent.
router.patch('/api/work-items/:id/progress',requireAuth,async(req,res)=>{
 try{
 const ctx=await task(req),item=ctx.item;
 const isAssignee=String(item.assigned_to||'')===String(req.user.sub);
 if(!isAssignee&&!['PROJECT_MANAGER','QA'].includes(ctx.role))throw fail(403,'Only the assignee, QA or the project manager can update progress.');
 const notes=[],sets=[],params=[req.params.id];
 const put=(col,val)=>{params.push(val);sets.push(col+'=$'+params.length);};
 if(req.body?.progress!=null&&req.body.progress!==''){
  const p=Math.round(Number(req.body.progress));if(!Number.isFinite(p)||p<0||p>100)throw fail(400,'Progress must be between 0 and 100.');
  if(p!==Number(item.progress_percent||0)){put('progress_percent',p);notes.push('Progress '+Number(item.progress_percent||0)+'% → '+p+'%');}
 }
 const add=Math.round(Number(req.body?.addMinutes||0));
 if(add){if(!Number.isFinite(add)||add<0||add>24*60)throw fail(400,'Time spent must be between 0 and 24 hours at a time.');
  sets.push('time_spent_minutes=time_spent_minutes+'+add);notes.push('Added '+(add>=60?Math.floor(add/60)+' h'+(add%60?' '+add%60+' min':''):add+' min')+' of work');}
 if(!sets.length)throw fail(400,'Nothing to save.');
 put('updated_by',req.user.sub);
 const r=await db.withTransaction(async client=>{
  const u=await client.query('update work_items set '+sets.join(',')+',updated_at=now() where id=$1 returning *',params);
  await client.query("insert into work_item_history(work_item_id,event_type,old_status,new_status,performed_by,comment) values($1,'PROGRESS_UPDATED',$2,$2,$3,$4)",[item.id,item.status,req.user.sub,notes.join(' · ')+'.']);
  return u.rows[0];
 });
 res.json({ok:true,task:r});
 }catch(e){respond(res,e);}
});

module.exports=router;
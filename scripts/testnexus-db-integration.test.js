'use strict';
/**
 * Authenticated HTTP + real PostgreSQL TestNexus workspace acceptance.
 * Runs only against a disposable CI database after migrations.
 */
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const express=require('express');
const jwt=require('jsonwebtoken');
const db=require('../server/db');
const persistence=require('../server/services/persistenceService');
const projectRoutes=require('../server/routes/projectWorkspace');
const workRoutes=require('../server/routes/workManagement');
const PWD='unused-ci-secret';
const assertJson=(status,reply,expected)=>assert.equal(status,expected,JSON.stringify(reply));
async function main(){
 assert.ok(db.isConfigured(),'DATABASE_ENABLED=true and DATABASE_URL required');
 const ids={qa:randomUUID(),viewer:randomUUID(),developer:randomUUID(),project:randomUUID(),task:randomUUID(),otherProject:randomUUID()};
 const sessionId='ci-session-'+randomUUID();
 const caseData={id:'TC001',title:'Registration works',type:'functional',testCategory:'FUNCTIONAL',priority:'medium',automationReadiness:{status:'READY'},approved:true};
 for(const [role,id] of [['QA',ids.qa],['DEV',ids.viewer],['DEV',ids.developer]]){
  await db.query('insert into users(id,email,display_name,password_hash,role) values($1,$2,$3,$4,$5)',[id,'ci-'+id+'@example.test','CI '+role,PWD,role]);
 }
 await db.query('insert into projects(id,name,created_by) values($1,$2,$3)',[ids.project,'TestNexus workspace CI',ids.qa]);
 await db.query('insert into projects(id,name,created_by) values($1,$2,$3)',[ids.otherProject,'Other workspace CI',ids.qa]);
 for(const [user,legacy,role] of [[ids.qa,'QA','QA'],[ids.viewer,'DEV','VIEWER'],[ids.developer,'DEV','DEVELOPER']]){
  await db.query('insert into project_members(project_id,user_id,role,project_role) values($1,$2,$3,$4)',[ids.project,user,legacy,role]);
 }
 const session={projectId:ids.project,createdBy:ids.qa,state:'DONE',story:'Verify registration',targetUrl:'https://example.test',targetType:'WEB',testCases:[caseData],readinessValidated:true,automationReadiness:{ready:1,total:1}};
 await persistence.persistSession(sessionId,session,{projectId:ids.project,userId:ids.qa});
 await persistence.persistTestCases(sessionId,[caseData]);
 await persistence.persistRun({sessionId,session,runNumber:1,summary:{total:1,passed:1,failed:0,tests:[{testCaseId:'TC001',title:'Registration works',pass:true}]},approvedIds:['TC001'],userId:ids.qa});
 await db.query("insert into work_items(id,project_id,session_id,external_case_id,work_type,title,priority,created_by,assigned_to) values($1,$2,null,null,'GENERAL','Registration parent','MEDIUM',$3,$3)",[ids.task,ids.project,ids.qa]);
 const app=express();app.use(express.json());app.use(projectRoutes);app.use(workRoutes);
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});
 const base='http://127.0.0.1:'+server.address().port;
 const token=(sub,role)=>jwt.sign({sub,role},process.env.JWT_SECRET||'change-me-in-production',{expiresIn:'5m'});
 async function call(method,url,identity=ids.qa,role='QA',body){
  const headers={Authorization:'Bearer '+token(identity,role)};
  if(body!==undefined)headers['Content-Type']='application/json';
  const res=await fetch(base+url,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  return {status:res.status,data:await res.json()};
 }
 try{
  let r=await call('GET','/api/projects/'+ids.project+'/test-cases');
  assertJson(r.status,r.data,200);assert.ok(r.data.cases.some(x=>x.external_case_id==='TC001'));
  r=await call('POST','/api/work-items/'+ids.task+'/test-links',ids.qa,'QA',{sessionId,caseId:'TC001'});
  assertJson(r.status,r.data,201);assert.equal(r.data.link.external_case_id,'TC001');
  r=await call('GET','/api/projects/'+ids.project+'/task-test-history?taskId='+ids.task);
  assertJson(r.status,r.data,200);assert.equal(r.data.results.length,1);assert.equal(r.data.results[0].passed,true);
  r=await call('POST','/api/projects/'+ids.project+'/project-test-plan',ids.qa,'QA',{});
  assertJson(r.status,r.data,200);assert.ok(r.data.groups.some(g=>g.caseIds.includes('TC001')));
  r=await call('POST','/api/projects/'+ids.project+'/retest-plan',ids.qa,'QA',{taskIds:[ids.task]});
  assertJson(r.status,r.data,200);assert.ok(r.data.groups.some(g=>g.caseIds.includes('TC001')));
  r=await call('POST','/api/work-items/'+ids.task+'/subtasks',ids.qa,'QA',{title:'Email confirmation'});
  assertJson(r.status,r.data,201);const child=r.data.subtask;
  assert.equal(child.parent_work_item_id,ids.task);
  assert.equal(child.session_id,null);assert.equal(child.external_case_id,null);
  r=await call('GET','/api/projects/'+ids.project+'/task-tree');
  assertJson(r.status,r.data,200);assert.ok(r.data.roots.some(n=>n.id===ids.task&&n.children.some(x=>x.id===child.id)));
  r=await call('POST','/api/work-items/'+ids.task+'/test-links',ids.qa,'QA',{sessionId:'not-this-project',caseId:'TC001'});
  assertJson(r.status,r.data,400);
  r=await call('POST','/api/work-items/'+ids.task+'/attachments',ids.viewer,'DEV',{filename:'note.txt',mimeType:'text/plain',base64:'aGVsbG8='});
  assertJson(r.status,r.data,403);
  r=await call('PATCH','/api/work-items/'+ids.task+'/status',ids.viewer,'DEV',{status:'IN_PROGRESS'});
  assertJson(r.status,r.data,403);
  r=await call('GET','/api/work-items/'+ids.task+'/details',ids.developer,'DEV');
  assertJson(r.status,r.data,403);
  r=await call('GET','/api/projects/'+ids.project+'/task-tree',ids.developer,'DEV');
  assertJson(r.status,r.data,200);assert.equal(r.data.total,0);
  r=await call('GET','/api/projects/'+ids.otherProject+'/task-tree',ids.viewer,'DEV');
  assertJson(r.status,r.data,403);
  console.log('TestNexus authenticated PostgreSQL HTTP integration passed: 13 assertions across case links, histories, planning, hierarchy and roles.');
 }finally{
  await new Promise(resolve=>server.close(resolve));
  await db.getPool().end();
 }
}
main().catch(e=>{console.error(e);process.exitCode=1});

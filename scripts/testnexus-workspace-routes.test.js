'use strict';
/**
 * Executable HTTP-handler contract tests for the TestNexus workspace.
 * These tests intentionally use a DB double; they do not replace PostgreSQL
 * migrations, real Cypress runs, or browser accessibility acceptance.
 */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const Module=require('node:module');
const routePath=path.join(__dirname,'..','server','routes','projectWorkspace.js');
const P='11111111-1111-4111-8111-111111111111';
const TASK='22222222-2222-4222-8222-222222222222';
const USER='33333333-3333-4333-8333-333333333333';
const OTHER='44444444-4444-4444-8444-444444444444';
const answer=rows=>({rows,rowCount:rows.length});
function loadRouter({query,transaction,loadSession}={}){
 const routes=new Map(),sessions=new Map();
 const router={};
 for(const verb of ['get','post','patch','put','delete'])router[verb]=(url,...handlers)=>{routes.set(verb.toUpperCase()+' '+url,handlers.at(-1));return router};
 const fakeDb={
  isConfigured:()=>true,
  query:query|| (async()=>answer([])),
  withTransaction:async action=>action({query:transaction||query||(async()=>answer([]))}),
 };
 const auth={requireAuth:(_req,_res,next)=>next(),requireRole:()=> (_req,_res,next)=>next()};
 const sessionStore={
  getSession:id=>sessions.get(id)||{projectId:null,testCases:[],state:'IDLE'},
  hydrateSession:(id,data)=>{sessions.set(id,data);return data}
 };
 const persist={loadSession:loadSession|| (async()=>null)};
 const native=Module._load;
 Module._load=function(request,parent,isMain){
  if(parent?.filename===routePath){
   if(request==='express')return {Router:()=>router};
   if(request==='../db')return fakeDb;
   if(request==='../services/authService')return auth;
   if(request==='../data/sessionStore')return sessionStore;
   if(request==='../services/persistenceService')return persist;
   if(request==='../services/retainedExecutionEvidence')return {ROOT:path.join(__dirname,'artifacts')};
  }
  return native.call(this,request,parent,isMain);
 };
 try{delete require.cache[require.resolve(routePath)];require(routePath)}
 finally{Module._load=native;delete require.cache[require.resolve(routePath)]}
 return {routes,sessions};
}
async function invoke(router,method,url,{params={},user={},body={},query={}}={}){
 let statusCode=200,output=null;
 const res={status:n=>{statusCode=n;return res},json:value=>{output=value;return res},set:()=>res,type:()=>res,send:()=>res};
 const fn=router.routes.get(method+' '+url);
 assert.ok(fn,method+' '+url+' handler exists');
 await fn({params,body,query,user:{sub:USER,role:'QA',...user}},res);
 return {status:statusCode,body:output};
}
const member=(role='QA')=>async sql=>{
 if(sql.includes('select * from projects'))return answer([{id:P,name:'Example'}]);
 if(sql.includes('select project_role from project_members'))return answer([{project_role:role}]);
 return answer([]);
};
test('outsiders cannot read project task hierarchy',async()=>{
 const router=loadRouter({query:async sql=>sql.includes('select * from projects')?answer([{id:P}]):answer([])});
 const result=await invoke(router,'GET','/api/projects/:projectId/task-tree',{params:{projectId:P}});
 assert.equal(result.status,403);
});
test('developer task hierarchy is restricted by assignee and preserves nesting',async()=>{
 let checked=false;
 const query=async(sql,params)=>{
  const base=await member('DEVELOPER')(sql);
  if(sql.includes('select id,parent_work_item_id as parent_id')){assert.match(sql,/assigned_to=\$2/);assert.deepEqual(params,[P,USER]);checked=true;return answer([
    {id:TASK,parent_id:null,title:'Parent'},
    {id:OTHER,parent_id:TASK,title:'Child'}
  ])}
  return base;
 };
 const router=loadRouter({query});
 const result=await invoke(router,'GET','/api/projects/:projectId/task-tree',{params:{projectId:P},user:{role:'DEV'}});
 assert.equal(result.status,200);assert.ok(checked);assert.equal(result.body.roots[0].children[0].id,OTHER);
});
test('a task can link a persisted test case without requiring an in-memory session',async()=>{
 const query=async(sql)=>{
  if(sql.includes('select * from work_items'))return answer([{id:TASK,project_id:P,assigned_to:USER}]);
  if(sql.includes('from test_cases tc join test_sessions'))return answer([{id:1}]);
  if(sql.includes('insert into task_test_case_links'))return answer([{id:OTHER,session_id:'saved-session',external_case_id:'TC001'}]);
  return member('QA')(sql);
 };
 const router=loadRouter({query});
 const result=await invoke(router,'POST','/api/work-items/:id/test-links',{params:{id:TASK},body:{sessionId:'saved-session',caseId:'TC001'}});
 assert.equal(result.status,201);assert.equal(result.body.link.external_case_id,'TC001');
});
test('new child tasks do not silently inherit parent test-case associations',async()=>{
 let inserted=null;
 const query=async(sql)=>{
  if(sql.includes('select * from work_items'))return answer([{id:TASK,project_id:P,assigned_to:USER,session_id:'parent-session',external_case_id:'TC002',status:'PENDING'}]);
  return member('QA')(sql);
 };
 const transaction=async(sql,params)=>{
  if(sql.includes('insert into work_items')){inserted=params;return answer([{id:OTHER,title:'Child'}])}
  return answer([]);
 };
 const router=loadRouter({query,transaction});
 const result=await invoke(router,'POST','/api/work-items/:id/subtasks',{params:{id:TASK},body:{title:'Child'}});
 assert.equal(result.status,201);assert.equal(inserted[2],null);assert.equal(inserted[3],null);
});
test('unassigned developer cannot view a task execution history',async()=>{
 const query=async(sql)=>{
  if(sql.includes('select id,assigned_to from work_items'))return answer([{id:TASK,assigned_to:OTHER}]);
  return member('DEVELOPER')(sql);
 };
 const router=loadRouter({query});
 const result=await invoke(router,'GET','/api/projects/:projectId/task-test-history',{params:{projectId:P},query:{taskId:TASK},user:{role:'DEV'}});
 assert.equal(result.status,403);
});
test('retest planning restores a persisted READY case after application restart',async()=>{
 const stored={projectId:P,testCases:[{id:'TC001',automationReadiness:{status:'READY'}}],readinessValidated:true,state:'DONE',targetUrl:'https://example.test'};
 const query=async(sql)=>{
  if(sql.includes('select id,session_id,external_case_id,status,project_id from work_items'))return answer([{id:TASK,project_id:P,session_id:'saved-session',external_case_id:'TC001',status:'READY_FOR_RETEST'}]);
  if(sql.includes('from task_test_case_links'))return answer([{work_item_id:TASK,session_id:'saved-session',external_case_id:'TC001'}]);
  return member('QA')(sql);
 };
 const router=loadRouter({query,loadSession:async()=>stored});
 const result=await invoke(router,'POST','/api/projects/:projectId/retest-plan',{params:{projectId:P},body:{taskIds:[TASK]}});
 assert.equal(result.status,200);assert.equal(result.body.groups.length,1);assert.deepEqual(result.body.groups[0].caseIds,['TC001']);
});
test('invalid cross-project test cases are rejected',async()=>{
 const query=async(sql)=>{
  if(sql.includes('select * from work_items'))return answer([{id:TASK,project_id:P,assigned_to:USER}]);
  return member('QA')(sql);
 };
 const router=loadRouter({query});
 const result=await invoke(router,'POST','/api/work-items/:id/test-links',{params:{id:TASK},body:{sessionId:'wrong-project',caseId:'TC003'}});
 assert.equal(result.status,400);
});

'use strict';
const db=require('../db');
const {chooseAssignee,ROLE_LABELS}=require('./failureAssignment');
const priority=v=>['LOW','MEDIUM','HIGH','CRITICAL'].includes(String(v||'').toUpperCase())?String(v).toUpperCase():'MEDIUM';
async function applyProjectWorkflow({sessionId,projectId,runNumber,executedBy}){
 if(!db.isConfigured()||!projectId||!runNumber)return {created:0,closed:0};
 const policyR=await db.query('select * from project_workflow_settings where project_id=$1',[projectId]);
 const policy=policyR.rows[0];if(!policy || (!policy.auto_create_failed_tasks&&!policy.auto_close_verified_retests))return {created:0,closed:0};
 const run=await db.query('select id,coalesce(project_run_number,run_number) as number from test_runs where project_id=$1 and session_id=$2 and run_number=$3',[projectId,sessionId,runNumber]);
 const runNo=run.rows[0]?.number||runNumber;
 if(!run.rowCount)return {created:0,closed:0};
 const results=await db.query('select id,external_case_id,title,test_category,priority,passed,error_message,duration_ms from test_results where run_id=$1',[run.rows[0].id]);
 let created=0,closed=0;
 for(const r of results.rows){
  if(!r.external_case_id)continue;
  const outcome=await db.withTransaction(async client=>{
   await client.query('select pg_advisory_xact_lock(hashtext($1),hashtext($2))',[String(projectId),String(sessionId)+':'+String(r.external_case_id)]);
   const active=await client.query("select w.id,w.status,w.origin from work_items w where w.project_id=$1 and w.deleted_at is null and w.status not in ('COMPLETED','CANCELLED') and ((w.session_id=$2 and upper(w.external_case_id)=upper($3)) or exists (select 1 from task_test_case_links l where l.work_item_id=w.id and l.project_id=$1 and l.session_id=$2 and upper(l.external_case_id)=upper($3))) order by w.created_at desc limit 1 for update of w",[projectId,sessionId,r.external_case_id]);
   if(!r.passed&&policy.auto_create_failed_tasks){
    // A test that did not run (no error and no duration) is not a failure.
    if(!r.error_message&&!r.duration_ms)return 'unchanged';
    if(active.rowCount){
     // Same case failed again: keep one task, count the failure, and send a retest that failed back to work.
     const a=active.rows[0],reopen=a.status==='READY_FOR_RETEST';
     await client.query("update work_items set failure_count=failure_count+1,last_failed_run_id=$2,run_id=$2,test_result_id=$3,status=case when $4 then 'IN_PROGRESS' else status end,updated_at=now() where id=$1",[a.id,run.rows[0].id,r.id,reopen]);
     await client.query("insert into work_item_history(work_item_id,event_type,old_status,new_status,performed_by,comment) values($1,'TEST_FAILED_AGAIN',$2,$3,$4,$5)",[a.id,a.status,reopen?'IN_PROGRESS':a.status,executedBy||null,'Failed again in Run #'+runNo+(reopen?' (retest failed, back to In progress).':'.')]);
     return 'existing';
    }
    // New failure: the system assigns it to the project's team, the role that fits (QA checks first) and the least busy member.
    const pick=await chooseAssignee(client,{projectId,category:r.test_category,reason:'UNANALYSED',fallbackDeveloper:policy.default_developer||null});
    const who=pick.userId;
    const caseTitle=String(r.title||'').replace(/^\s*(?:test execution\s+)?TC(?:\d{3}|-H\d{3})\s*[-—:·]?\s*/i,'').trim()||'Test case';
    const t=await client.query("insert into work_items(project_id,session_id,run_id,test_result_id,external_case_id,work_type,title,description,priority,assigned_to,created_by,updated_by,metadata,origin,team_id,assigned_role,failure_count,first_failed_run_id,last_failed_run_id,assigned_by_system) values($1,$2,$3,$4,$5,'INVESTIGATION',$6,$7,$8,$9,$10,$10,$11::jsonb,'FAILED_TEST',$12,$13,1,$3,$3,$14) returning id",[projectId,sessionId,run.rows[0].id,r.id,r.external_case_id,(r.external_case_id+' failed · '+caseTitle).slice(0,500),r.error_message?String(r.error_message).slice(0,4000):null,priority(r.priority),who,executedBy||null,JSON.stringify({source:'project_workflow',testCategory:r.test_category||null,executionRunId:run.rows[0].id,aiReason:'UNANALYSED'}),pick.teamId,pick.role,Boolean(who)]);
    await client.query("insert into task_test_case_links(project_id,work_item_id,session_id,external_case_id,created_by) values($1,$2,$3,$4,$5) on conflict do nothing",[projectId,t.rows[0].id,sessionId,r.external_case_id,executedBy||null]);
    await client.query("insert into work_item_history(work_item_id,event_type,new_status,performed_by,comment) values($1,'WORKFLOW_FAILED_TEST','PENDING',$2,$3)",[t.rows[0].id,executedBy||null,'Created automatically: failed in Run #'+runNo+'. '+(who?'Assigned by the system to '+(pick.teamName?pick.teamName+' · ':'')+(ROLE_LABELS[pick.role]||pick.role)+'.':'Not assigned: '+pick.note)+(who&&pick.note?' '+pick.note:'')]);
    if(who)await client.query("insert into notification_outbox(project_id,user_id,channel,event_type,subject,payload_json,status) values($1,$2,'IN_APP','WORK_ITEM_ASSIGNED',$3,$4::jsonb,'PENDING')",[projectId,who,'Failed test needs review: '+r.title,JSON.stringify({workItemId:t.rows[0].id,runId:run.rows[0].id})]);
    return 'created';
   }
   if(r.passed&&active.rowCount&&!(policy.auto_close_verified_retests&&active.rows[0].status==='READY_FOR_RETEST')){
    await client.query("insert into work_item_history(work_item_id,event_type,old_status,new_status,performed_by,comment) values($1,'TEST_PASSED',$2,$2,$3,$4)",[active.rows[0].id,active.rows[0].status,executedBy||null,'Passed in Run #'+runNo+'.']);
    await client.query('update work_items set updated_at=now() where id=$1',[active.rows[0].id]);
    return 'unchanged';
   }
   if(r.passed&&policy.auto_close_verified_retests&&active.rowCount&&active.rows[0].status==='READY_FOR_RETEST'){
    await client.query("update work_items set status='COMPLETED',completed_at=now(),closed_at=now(),closed_by=$1,updated_by=$1,updated_at=now() where id=$2",[executedBy||null,active.rows[0].id]);
    await client.query("insert into work_item_history(work_item_id,event_type,old_status,new_status,performed_by,comment) values($1,'VERIFIED_RETEST_PASSED','READY_FOR_RETEST','COMPLETED',$2,$3)",[active.rows[0].id,executedBy||null,'Closed following a passing execution with project auto-close enabled.']);
    return 'closed';
   }
   return 'unchanged';
  });
  if(outcome==='created')created++;
  if(outcome==='closed')closed++;
 }
 return {created,closed};
}
module.exports={applyProjectWorkflow};
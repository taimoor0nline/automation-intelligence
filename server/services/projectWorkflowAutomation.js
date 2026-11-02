'use strict';
const db=require('../db');
const priority=v=>['LOW','MEDIUM','HIGH','CRITICAL'].includes(String(v||'').toUpperCase())?String(v).toUpperCase():'MEDIUM';
async function applyProjectWorkflow({sessionId,projectId,runNumber,executedBy}){
 if(!db.isConfigured()||!projectId||!runNumber)return {created:0,closed:0};
 const policyR=await db.query('select * from project_workflow_settings where project_id=$1',[projectId]);
 const policy=policyR.rows[0];if(!policy || (!policy.auto_create_failed_tasks&&!policy.auto_close_verified_retests))return {created:0,closed:0};
 const run=await db.query('select id from test_runs where project_id=$1 and session_id=$2 and run_number=$3',[projectId,sessionId,runNumber]);
 if(!run.rowCount)return {created:0,closed:0};
 const results=await db.query('select id,external_case_id,title,test_category,priority,passed from test_results where run_id=$1',[run.rows[0].id]);
 let created=0,closed=0;
 for(const r of results.rows){
  if(!r.external_case_id)continue;
  const outcome=await db.withTransaction(async client=>{
   await client.query('select pg_advisory_xact_lock(hashtext($1),hashtext($2))',[String(projectId),String(sessionId)+':'+String(r.external_case_id)]);
   const active=await client.query("select w.id,w.status from work_items w where w.project_id=$1 and w.deleted_at is null and w.status not in ('COMPLETED','CANCELLED') and ((w.session_id=$2 and upper(w.external_case_id)=upper($3)) or exists (select 1 from task_test_case_links l where l.work_item_id=w.id and l.project_id=$1 and l.session_id=$2 and upper(l.external_case_id)=upper($3))) order by w.created_at desc limit 1 for update of w",[projectId,sessionId,r.external_case_id]);
   if(!r.passed&&policy.auto_create_failed_tasks){
    if(active.rowCount)return 'existing';
    const assignee=policy.default_developer||null;
    const canAssign=assignee?await client.query("select 1 from project_members pm join users u on u.id=pm.user_id where pm.project_id=$1 and pm.user_id=$2 and pm.project_role='DEVELOPER' and u.is_active=true",[projectId,assignee]):null;
    const who=canAssign?.rowCount?assignee:null;
    const t=await client.query("insert into work_items(project_id,session_id,run_id,test_result_id,external_case_id,work_type,title,description,priority,assigned_to,created_by,metadata) values($1,$2,$3,$4,$5,'DEFECT_FIX',$6,$7,$8,$9,$10,$11::jsonb) returning id",[projectId,sessionId,run.rows[0].id,r.id,r.external_case_id,'Investigate failed test: '+r.title,'Automatically created by the project workflow after a failed verified execution. Review the test evidence before attributing failure to application code.',priority(r.priority),who,executedBy||null,JSON.stringify({source:'project_workflow',testCategory:r.test_category||null,executionRunId:run.rows[0].id})]);
    await client.query("insert into work_item_history(work_item_id,event_type,new_status,performed_by,comment) values($1,'WORKFLOW_FAILED_TEST','PENDING',$2,$3)",[t.rows[0].id,executedBy||null,'Created from TestNexus execution #'+runNumber]);
    if(who)await client.query("insert into notification_outbox(project_id,user_id,channel,event_type,subject,payload_json,status) values($1,$2,'IN_APP','WORK_ITEM_ASSIGNED',$3,$4::jsonb,'PENDING')",[projectId,who,'Failed test needs review: '+r.title,JSON.stringify({workItemId:t.rows[0].id,runId:run.rows[0].id})]);
    return 'created';
   }
   if(r.passed&&policy.auto_close_verified_retests&&active.rowCount&&active.rows[0].status==='READY_FOR_RETEST'){
    await client.query("update work_items set status='COMPLETED',completed_at=now(),closed_at=now(),closed_by=$1,updated_at=now() where id=$2",[executedBy||null,active.rows[0].id]);
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
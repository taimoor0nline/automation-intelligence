const crypto=require('crypto');
const db=require('../db');
const clean=(v,max=500)=>String(v??'').trim().slice(0,max);
const uuid=v=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v||''));
function normalize(input){
 if(!input||typeof input!=='object')return null;
 const failureSignature=clean(input.failureSignature||input.signature,300);
 const originalSelector=clean(input.originalSelector||input.oldSelector,400);
 const replacementSelector=clean(input.replacementSelector||input.newSelector,400);
 const pagePath=clean(input.pagePath||'/',250);
 if(!failureSignature||!originalSelector||!replacementSelector||originalSelector===replacementSelector)return null;
 if(!pagePath.startsWith('/')||pagePath.startsWith('//'))return null;
 const fingerprint=crypto.createHash('sha256').update(JSON.stringify([failureSignature,originalSelector,pagePath])).digest('hex');
 return {fingerprint,failureSignature,originalSelector,replacementSelector,pagePath};
}
function isVerified(entry){
 return entry?.verified===true||entry?.validationStatus==='PASSED'||entry?.validation?.status==='PASSED';
}
async function captureVerified({client,projectId,session,runId,userId}){
 if(!db.isConfigured()||!uuid(projectId)||!uuid(runId))return 0;
 const entries=[...(Array.isArray(session.validatedRepairMemory)?session.validatedRepairMemory:[]),...(Array.isArray(session.repairLearning?.repairs)?session.repairLearning.repairs:[])];
 if(!entries.length)return 0;
 const outcome=await client.query('select count(*)::int as total,count(*) filter(where passed=true)::int as passed from test_results where run_id=$1',[runId]);
 if(!outcome.rows[0].total||outcome.rows[0].passed!==outcome.rows[0].total)return 0;
 let count=0;const seen=new Set();
 for(const entry of entries){
  if(!isVerified(entry))continue;
  const item=normalize(entry);if(!item||seen.has(item.fingerprint))continue;seen.add(item.fingerprint);
  const sourceRun=clean(entry.validationRunId||entry.runId||entry.validation?.runId,100);
  if(sourceRun!==String(runId)&&sourceRun!==clean(session.executionProgress?.runId,100))continue;
  const row=await client.query(`update ai_repair_memory m
    set status='VERIFIED',verification_source='APPLIED_PASSING_RUN',verification_run_id=$3,verified_at=now(),updated_at=now()
    where m.project_id=$1 and m.fingerprint=$2 and m.status='CANDIDATE'
      and exists(select 1 from ai_repair_reuse_events e where e.memory_id=m.id and e.project_id=$1 and e.run_id=$3 and e.event_type='APPLIED')
    returning m.id`,[projectId,item.fingerprint,runId]);
  if(row.rowCount){
   count++;
   const event=await client.query("insert into ai_repair_reuse_events(memory_id,project_id,run_id,event_type,actor_id) values($1,$2,$3,'SUCCEEDED',$4) on conflict do nothing returning id",[row.rows[0].id,projectId,runId,uuid(userId)?userId:null]);
   if(event.rowCount)await client.query('update ai_repair_memory set success_count=success_count+1,last_used_at=now() where id=$1',[row.rows[0].id]);
  }
 }
 return count;
}
async function propose({projectId,entry,userId}){
 if(!db.isConfigured()||!uuid(projectId))throw Error('Database and project required');
 const item=normalize(entry);if(!item)throw Error('Failure signature and distinct selectors with a valid page path are required');
 const r=await db.query(`insert into ai_repair_memory(project_id,fingerprint,failure_signature,original_selector,replacement_selector,page_path,created_by)
 values($1,$2,$3,$4,$5,$6,$7) on conflict(project_id,fingerprint) do update set updated_at=now()
 returning id,status,failure_signature,original_selector,replacement_selector,page_path`,
 [projectId,item.fingerprint,item.failureSignature,item.originalSelector,item.replacementSelector,item.pagePath,uuid(userId)?userId:null]);
 return r.rows[0];
}
async function verifyApplied({projectId,memoryId,runId,userId}){
 if(!db.isConfigured()||!uuid(projectId)||!uuid(memoryId)||!uuid(runId))throw Error('Valid project, memory and run IDs required');
 return db.withTransaction(async client=>{
  const record=await client.query('select id,status from ai_repair_memory where id=$1 and project_id=$2 for update',[memoryId,projectId]);
  if(!record.rowCount||record.rows[0].status==='REVOKED')throw Error('Repair memory unavailable or revoked');
  const applied=await client.query("select 1 from ai_repair_reuse_events where memory_id=$1 and run_id=$2 and event_type='APPLIED'",[memoryId,runId]);
  if(!applied.rowCount)throw Error('Repair must have an APPLIED event before verification');
  const run=await client.query('select id from test_runs where id=$1 and project_id=$2',[runId,projectId]);
  if(!run.rowCount)throw Error('Run does not belong to project');
  const outcomes=await client.query('select count(*)::int as total,count(*) filter(where passed=true)::int as passed from test_results where run_id=$1',[runId]);
  if(!outcomes.rows[0].total||outcomes.rows[0].passed!==outcomes.rows[0].total)throw Error('Verification requires a completed run with all test results passing');
  await client.query("update ai_repair_memory set status='VERIFIED',verification_source='APPLIED_PASSING_RUN',verification_run_id=$2,verified_at=now(),updated_at=now() where id=$1",[memoryId,runId]);
  const event=await client.query("insert into ai_repair_reuse_events(memory_id,project_id,run_id,event_type,actor_id) values($1,$2,$3,'SUCCEEDED',$4) on conflict do nothing returning id",[memoryId,projectId,runId,uuid(userId)?userId:null]);
  if(event.rowCount)await client.query('update ai_repair_memory set success_count=success_count+1,last_used_at=now() where id=$1',[memoryId]);
  return {verified:true};
 });
}
function recommendation(row){
 const before=String(row.original_selector||'');
 const after=String(row.replacement_selector||'');
 return {
  title:'Use a verified element locator',
  summary:'An earlier execution confirmed an alternative element locator for this page. Review the proposed change before applying it.',
  pagePath:row.page_path,
  previousLocator:before,
  recommendedLocator:after,
  automationPatch:{language:'javascript',engine:'cypress',snippet:'cy.get('+JSON.stringify(after)+')',reviewRequired:true},
 };
}
async function suggestions(projectId,{pagePath,limit=20}={}){
 if(!db.isConfigured()||!uuid(projectId))return [];
 const values=[projectId];let condition='';
 if(pagePath){values.push(clean(pagePath,250));condition='and page_path=$2';}
 const r=await db.query(`select id,failure_signature,original_selector,replacement_selector,page_path,verified_at,success_count,failure_count from ai_repair_memory
 where project_id=$1 and status='VERIFIED' ${condition} order by success_count desc,verified_at desc limit ${Math.min(50,Math.max(1,Number(limit)||20))}`,values);
 return r.rows;
}
async function recordReuse({projectId,memoryId,sessionId,runId,eventType,userId}){
 if(!db.isConfigured()||!uuid(projectId)||!uuid(memoryId)||!['SUGGESTED','APPLIED','SUCCEEDED','FAILED','REVOKED'].includes(eventType))throw Error('Invalid reuse event');
 return db.withTransaction(async client=>{
  const row=await client.query("select id,status from ai_repair_memory where id=$1 and project_id=$2 for update",[memoryId,projectId]);
  if(!row.rowCount)throw Error('Repair memory not found in project');
  if(row.rows[0].status==='REVOKED'&&eventType!=='REVOKED')throw Error('Revoked repairs cannot be reused');
  if(row.rows[0].status!=='VERIFIED'&&!['APPLIED','REVOKED'].includes(eventType))throw Error('Only verified repairs may be suggested or counted as reused');
  if(eventType==='SUCCEEDED')throw Error('Use the verified passing-run endpoint to record success');
  if(eventType==='APPLIED'&&!uuid(runId))throw Error('Applied repairs require a valid run ID');
  if(eventType==='FAILED'&&!uuid(runId))throw Error('Failed repairs require a valid run ID');
  if(eventType==='REVOKED')await client.query("update ai_repair_memory set status='REVOKED',updated_at=now() where id=$1",[memoryId]);
  if(eventType==='SUCCEEDED'||eventType==='FAILED'){
   if(!uuid(runId))throw Error('A completed run ID is required to record a repair outcome');
   const applied=await client.query("select 1 from ai_repair_reuse_events where memory_id=$1 and run_id=$2 and event_type='APPLIED'",[memoryId,runId]);
   if(!applied.rowCount)throw Error('Repair must be applied before recording an outcome');
   const run=await client.query('select id from test_runs where id=$1 and project_id=$2',[runId,projectId]);
   if(!run.rowCount)throw Error('Outcome run does not belong to this project');
  }
  const r=await client.query(`insert into ai_repair_reuse_events(memory_id,project_id,session_id,run_id,event_type,actor_id)
   values($1,$2,$3,$4,$5,$6) on conflict do nothing returning id`,
   [memoryId,projectId,sessionId||null,uuid(runId)?runId:null,eventType,uuid(userId)?userId:null]);
  if(r.rowCount&&(eventType==='SUCCEEDED'||eventType==='FAILED'))await client.query(`update ai_repair_memory set ${eventType==='SUCCEEDED'?'success_count':'failure_count'}=${eventType==='SUCCEEDED'?'success_count':'failure_count'}+1,last_used_at=now(),updated_at=now() where id=$1`,[memoryId]);
  return {recorded:!!r.rowCount};
 });
}
module.exports={normalize,isVerified,captureVerified,propose,verifyApplied,suggestions,recommendation,recordReuse};

'use strict';
/** Real PostgreSQL schema acceptance, run only against a disposable CI database. */
const assert=require('node:assert/strict');
const {Pool}=require('pg');
const dbUrl=process.env.DATABASE_URL;
if(!dbUrl){console.error('DATABASE_URL is required');process.exit(1)}
async function main(){
 const pool=new Pool({connectionString:dbUrl});
 try{
  const tables=['projects','users','work_items','work_item_history','test_sessions','test_cases','test_runs','test_results','notification_outbox','project_environments','project_stories','project_documents','project_workflow_settings','work_item_attachments','test_run_evidence','task_test_case_links'];
  for(const name of tables){
   const result=await pool.query('select to_regclass($1)::text as t',['public.'+name]);
   assert.ok(result.rows[0].t,'Missing table '+name);
  }
  const expected={
   projects:['reference_no','scope_in','scope_out','acceptance_criteria'],
   work_items:['parent_work_item_id','deleted_at','closed_at','closed_by','eta_at'],
   test_sessions:['id','project_id','project_story_id','session_json'],
   task_test_case_links:['project_id','work_item_id','session_id','external_case_id','created_by'],
   test_run_evidence:['run_id','external_case_id','relative_path','mime_type'],
   project_workflow_settings:['auto_create_failed_tasks','auto_close_verified_retests']
  };
  for(const [table,columns] of Object.entries(expected)){
   const result=await pool.query("select column_name from information_schema.columns where table_schema='public' and table_name=$1",[table]);
   const present=new Set(result.rows.map(r=>r.column_name));
   for(const col of columns)assert.ok(present.has(col),table+'.'+col+' missing');
  }
  const fk=await pool.query("select count(*)::int as n from pg_constraint where conrelid='task_test_case_links'::regclass and contype='f'");
  assert.ok(fk.rows[0].n>=3,'Expected link ownership foreign keys');
  const unique=await pool.query("select count(*)::int as n from pg_constraint where conrelid='task_test_case_links'::regclass and contype='u'");
  assert.ok(unique.rows[0].n>=1,'Missing task-case uniqueness');
  console.log('TestNexus PostgreSQL schema acceptance passed: '+tables.length+' tables, columns, foreign keys and uniqueness.');
 }finally{await pool.end()}
}
main().catch(err=>{console.error(err);process.exitCode=1});

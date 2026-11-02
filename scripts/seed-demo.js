'use strict';
// Development-only, rerunnable TestNexus demonstration seed.
// Requires existing database migrations and an explicit opt-in.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../server/db');

const PEOPLE = [
  { name:'Muhammad Abdullah', email:'abdullah@testnexus.io', platform:'MANAGER', project:'PROJECT_MANAGER', team:'Project Management' },
  { name:'Ahmed Farooq', email:'ahmed.farooq@testnexus.io', platform:'MANAGER', project:'PROJECT_MANAGER', team:'Project Management' },
  { name:'Omar Khalid', email:'omar.khalid@testnexus.io', platform:'QA', project:'QA', team:'Quality Assurance' },
  { name:'Yusuf Hamza', email:'yusuf.hamza@testnexus.io', platform:'QA', project:'QA', team:'Quality Assurance' },
  { name:'Bilal Hassan', email:'bilal.hassan@testnexus.io', platform:'QA', project:'QA', team:'Quality Assurance' },
  { name:'Ibrahim Tariq', email:'ibrahim.tariq@testnexus.io', platform:'DEV', project:'DEVELOPER', team:'Development' },
  { name:'Ali Raza', email:'ali.raza@testnexus.io', platform:'DEV', project:'DEVELOPER', team:'Development' },
  { name:'Usman Saeed', email:'usman.saeed@testnexus.io', platform:'DEV', project:'DEVELOPER', team:'Development' },
  { name:'Hassan Nadeem', email:'hassan.nadeem@testnexus.io', platform:'DEV', project:'DEVELOPER', team:'Development' },
  { name:'Zayd Mahmood', email:'zayd.mahmood@testnexus.io', platform:'DEV', project:'VIEWER', team:'Observers' },
];
const PROJECT_REF = 'TN-DEMO-001';
const PROJECT_NAME = 'TestNexus Demo — Web Application Quality';
const STORIES = [
  {ref:'TN-US-001',title:'Sign in with valid credentials',priority:'HIGH',story:'As a registered user, I can sign in to access my project workspace.',acceptance:'Valid credentials authenticate; invalid credentials are rejected; session expires safely.'},
  {ref:'TN-US-002',title:'Manage a project task hierarchy',priority:'HIGH',story:'As a project manager, I can create tasks and subtasks and navigate their parent relationships.',acceptance:'Tasks display correct parent-child relationships and obey project permissions.'},
  {ref:'TN-US-003',title:'Review and execute an approved test',priority:'CRITICAL',story:'As a QA engineer, I can review generated cases and run only selected, automation-ready test cases.',acceptance:'Only reviewed cases execute; results and evidence are retained.'},
];
const WORK = [
  {key:'TN-T-001',title:'Review login test scenarios',type:'TEST_REVIEW',priority:'HIGH',owner:'omar.khalid@testnexus.io',status:'PENDING'},
  {key:'TN-T-002',title:'Implement invalid password error handling',type:'DEFECT_FIX',priority:'HIGH',owner:'ibrahim.tariq@testnexus.io',status:'IN_PROGRESS'},
  {key:'TN-T-003',title:'Verify incorrect password warning',type:'RETEST',priority:'MEDIUM',owner:'yusuf.hamza@testnexus.io',status:'PENDING',parent:'TN-T-002'},
  {key:'TN-T-004',title:'Check project permissions',type:'MANUAL_TEST',priority:'CRITICAL',owner:'bilal.hassan@testnexus.io',status:'PENDING'},
  {key:'TN-T-005',title:'Review evidence retention',type:'INVESTIGATION',priority:'MEDIUM',owner:'ali.raza@testnexus.io',status:'ON_HOLD'},
  {key:'TN-T-006',title:'Verify screenshot and video links',type:'RETEST',priority:'MEDIUM',owner:'omar.khalid@testnexus.io',status:'PENDING',parent:'TN-T-005'},
];

async function main() {
  if (process.env.SEED_DEMO_DATA !== 'true') throw new Error('Set SEED_DEMO_DATA=true to explicitly enable demo seeding.');
  if (process.env.NODE_ENV === 'production') throw new Error('Demo seeding is forbidden when NODE_ENV=production.');
  if (!db.isConfigured()) throw new Error('Configure DATABASE_ENABLED=true and DATABASE_URL before seeding.');
  const password = process.env.TESTNEXUS_SEED_PASSWORD;
  if (!password || password.length < 12) throw new Error('Set TESTNEXUS_SEED_PASSWORD to a password of at least 12 characters.');
  const passwordHash = await bcrypt.hash(password,12);
  const result = await db.withTransaction(async client => {
    const users = new Map();
    for (const person of PEOPLE) {
      const u=await client.query(
        `insert into users(email,display_name,password_hash,role)
         values($1,$2,$3,$4)
         on conflict(email) do update set display_name=excluded.display_name
         returning id,email`,
        [person.email,person.name,passwordHash,person.platform]);
      users.set(person.email,u.rows[0].id);
    }
    const creator=users.get(PEOPLE[0].email);
    const metadata={demo:true,seedKey:PROJECT_REF,teams:[
      {name:'Project Management',role:'PROJECT_MANAGER'},
      {name:'Quality Assurance',role:'QA'},
      {name:'Development',role:'DEVELOPER'},
      {name:'Observers',role:'VIEWER'}
    ]};
    const project=await client.query(
      `insert into projects(name,description,reference_no,created_by,project_metadata,target_url,technology_stack)
       values($1,$2,$3,$4,$5::jsonb,$6,$7)
       on conflict ((lower(reference_no))) where reference_no is not null
       do update set updated_at=now()
       returning id`,
      [PROJECT_NAME,'Demo project with sample users, work items and stories for verifying TestNexus UI.',PROJECT_REF,creator,JSON.stringify(metadata),'http://localhost:4000','Node.js, browser automation, PostgreSQL']);
    const projectId=project.rows[0].id;
    for (const person of PEOPLE) {
      await client.query(
        `insert into project_members(project_id,user_id,role,project_role) values($1,$2,$3,$4)
         on conflict(project_id,user_id) do update set project_role=excluded.project_role,role=excluded.role`,
        [projectId,users.get(person.email),person.platform,person.project]);
    }
    // Materialize the demo teams in the real relational tables, not only project metadata.
    // Existing global teams are reused and links are inserted idempotently.
    const teamIds=new Map();
    for(const entry of metadata.teams){
      const team=await client.query(
        'insert into teams(name,description,created_by) values($1,$2,$3) on conflict ((lower(name))) do update set name=excluded.name returning id',
        [entry.name,'Demo team associated with '+PROJECT_REF,creator]);
      const teamId=team.rows[0].id;
      teamIds.set(entry.name,teamId);
      await client.query('insert into project_teams(project_id,team_id) values($1,$2) on conflict do nothing',[projectId,teamId]);
    }
    for(const person of PEOPLE){
      await client.query('insert into team_members(team_id,user_id) values($1,$2) on conflict do nothing',[teamIds.get(person.team),users.get(person.email)]);
    }
    const env=await client.query(
      `insert into project_environments(project_id,name,base_url,stage_type,is_default,created_by)
       values($1,'Local Demo','http://localhost:4000','QA',true,$2)
       on conflict(project_id,name) do update set updated_at=now()
       returning id`,[projectId,creator]);
    for (const story of STORIES) {
      const existing=await client.query('select id from project_stories where project_id=$1 and reference_no=$2 limit 1',[projectId,story.ref]);
      if (!existing.rowCount) await client.query(
        `insert into project_stories(project_id,environment_id,reference_no,title,story,acceptance_criteria,priority,created_by,updated_by)
         values($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
        [projectId,env.rows[0].id,story.ref,story.title,story.story,story.acceptance,story.priority,creator]);
    }
    const workIds=new Map();
    for (const task of WORK) {
      const existing=await client.query("select id from work_items where project_id=$1 and metadata->>'seedKey'=$2 limit 1",[projectId,task.key]);
      if (existing.rowCount) {workIds.set(task.key,existing.rows[0].id);continue;}
      const newTask=await client.query(
        `insert into work_items(project_id,work_type,title,description,status,priority,assigned_to,assigned_by,created_by,metadata,parent_work_item_id)
         values($1,$2,$3,$4,$5,$6,$7,$8,$8,$9::jsonb,$10) returning id`,
        [projectId,task.type,task.title,'Sample work item for TestNexus demo. No actual test execution is implied.',task.status,task.priority,users.get(task.owner),creator,JSON.stringify({demo:true,seedKey:task.key}),task.parent?workIds.get(task.parent):null]);
      workIds.set(task.key,newTask.rows[0].id);
    }
    return {projectId,users:PEOPLE.length,stories:STORIES.length,tasks:WORK.length,teams:metadata.teams.map(t=>t.name)};
  });
  console.log('[db:seed:demo] complete',JSON.stringify(result,null,2));
}
main().catch(err=>{console.error('[db:seed:demo]',err.message);process.exitCode=1;}).finally(async()=>{const pool=db.getPool();if(pool)await pool.end();});

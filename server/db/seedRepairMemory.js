require('dotenv').config();
const db=require('../db');
const {propose}=require('../services/repairMemoryService');

// Explicit, idempotent development fixture; never creates fake users, projects,
// execution results, or verified learning records.
async function main(){
 if(process.env.NODE_ENV==='production')throw Error('Demo repair seeding is forbidden in production');
 if(process.env.TESTNEXUS_SEED_DEMO!=='YES')throw Error('Set TESTNEXUS_SEED_DEMO=YES to opt into demo repair candidates');
 if(!db.isConfigured())throw Error('DATABASE_ENABLED=true and DATABASE_URL are required');
 let projectId=String(process.env.TESTNEXUS_SEED_PROJECT_ID||'').trim();
 let userId=String(process.env.TESTNEXUS_SEED_USER_ID||'').trim();
 if(!projectId){
  const demo=await db.query("select id,created_by from projects where reference_no=$1 and project_metadata->>'demo'='true' limit 1",['TN-DEMO-001']);
  if(!demo.rowCount)throw Error('Demo project not found. Run db:seed:demo first or supply TESTNEXUS_SEED_PROJECT_ID');
  projectId=String(demo.rows[0].id);
  if(!userId)userId=String(demo.rows[0].created_by||'');
 }
 if(!userId){
  const owner=await db.query('select user_id from project_members where project_id=$1 order by case when project_role=$2 then 0 else 1 end,user_id limit 1',[projectId,'PROJECT_MANAGER']);
  if(!owner.rowCount)throw Error('No existing project member found');
  userId=String(owner.rows[0].user_id);
 }
 const isUuid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
 if(!isUuid(projectId)||!isUuid(userId))throw Error('Provide valid existing project and user UUIDs');
 const project=await db.query('select id from projects where id=$1',[projectId]);
 if(!project.rowCount)throw Error('Existing project ID required');
 const user=await db.query('select id from users where id=$1 and is_active=true',[userId]);
 if(!user.rowCount)throw Error('Existing active user ID required');
 const member=await db.query('select 1 from project_members where project_id=$1 and user_id=$2',[projectId,userId]);
 if(!member.rowCount)throw Error('Seed user must belong to the project');
 const repair=await propose({projectId,userId,entry:{failureSignature:'Demo: login button locator changed',originalSelector:'[data-testid="old-login"]',replacementSelector:'[data-testid="login-submit"]',pagePath:'/login'}});
 console.log('Demo repair candidate available:',repair.id,repair.status);
}
main().catch(err=>{console.error('[seed:repair-memory]',err.message);process.exitCode=1;}).finally(async()=>{const pool=db.getPool();if(pool)await pool.end();});

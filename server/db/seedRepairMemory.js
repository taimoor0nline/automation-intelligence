require('dotenv').config();
const db=require('../db');
const {propose}=require('../services/repairMemoryService');

// Explicit, idempotent development fixture; never creates fake users, projects,
// execution results, or verified learning records.
async function main(){
 if(process.env.TESTNEXUS_SEED_DEMO!=='YES')throw Error('Set TESTNEXUS_SEED_DEMO=YES to opt into demo repair candidates');
 if(!db.isConfigured())throw Error('DATABASE_ENABLED=true and DATABASE_URL are required');
 const projectId=String(process.env.TESTNEXUS_SEED_PROJECT_ID||'');
 const userId=String(process.env.TESTNEXUS_SEED_USER_ID||'');
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

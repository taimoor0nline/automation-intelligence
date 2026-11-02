require('dotenv').config();
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const db=require('./index');

async function main(){
 if(!db.isConfigured())throw new Error('DATABASE_URL is not configured.');
 const pool=db.getPool();
 const client=await pool.connect();
 try{
  await client.query('select pg_advisory_lock($1)',[74021819]);
  await client.query(`create table if not exists schema_migrations (
   filename text primary key, checksum text not null, applied_at timestamptz not null default now()
  )`);
  const files=fs.readdirSync(__dirname).filter(name=>/^\d+.*\.sql$/i.test(name)).sort();
  const baseline=String(process.env.TESTNEXUS_MIGRATION_BASELINE||'').trim();
  if(baseline){
   if(!/^\\d+.*\\.sql$/i.test(baseline)||!files.includes(baseline))throw new Error('Unknown baseline migration: '+baseline);
   if(process.env.TESTNEXUS_CONFIRM_BASELINE!=='I_HAVE_VERIFIED_SCHEMA')throw new Error('Set TESTNEXUS_CONFIRM_BASELINE=I_HAVE_VERIFIED_SCHEMA after verifying existing database schema.');
   const recorded=await client.query('select count(*)::int as total from schema_migrations');
   if(recorded.rows[0].total)throw new Error('Baseline is only allowed before any migrations have been recorded.');
   const existing=await client.query("select to_regclass('public.test_sessions') as sessions,to_regclass('public.test_runs') as runs");
   if(!existing.rows[0].sessions||!existing.rows[0].runs)throw new Error('Baseline requires an existing TestNexus database schema.');
   await client.query('begin');
   try{
    for(const file of files){if(file>baseline)break;const sql=fs.readFileSync(path.join(__dirname,file),'utf8');const checksum=crypto.createHash('sha256').update(sql).digest('hex');await client.query('insert into schema_migrations(filename,checksum) values($1,$2)',[file,checksum]);}
    await client.query('commit');
   }catch(error){await client.query('rollback');throw error;}
   console.log('[db:migrate] existing schema baselined through '+baseline);
  }
  for(const file of files){
   const sql=fs.readFileSync(path.join(__dirname,file),'utf8');
   const checksum=crypto.createHash('sha256').update(sql).digest('hex');
   const previous=await client.query('select checksum from schema_migrations where filename=$1',[file]);
   if(previous.rowCount){
    if(previous.rows[0].checksum!==checksum)throw new Error('Applied migration changed: '+file+'. Create a new migration rather than editing an applied file.');
    console.log('[db:migrate] skipping '+file);
    continue;
   }
   console.log('[db:migrate] applying '+file);
   await client.query('begin');
   try{
    await client.query(sql);
    await client.query('insert into schema_migrations(filename,checksum) values($1,$2)',[file,checksum]);
    await client.query('commit');
   }catch(error){await client.query('rollback');throw error;}
  }
  console.log('[db:migrate] complete');
 }finally{
  try{await client.query('select pg_advisory_unlock($1)',[74021819]);}finally{client.release();await pool.end();}
 }
}
main().catch(error=>{console.error('[db:migrate]',error);process.exitCode=1;});

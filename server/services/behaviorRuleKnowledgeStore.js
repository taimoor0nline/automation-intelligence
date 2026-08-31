const db = require('../db');

const memory = new Map();

function applicationKey(session = {}) {
  if (session.projectId) return `project:${String(session.projectId)}`;
  try {
    const url = new URL(String(session.targetUrl || ''));
    return `target:${url.origin}`.slice(0,320);
  } catch {
    return `target:${String(session.targetUrl || 'default').slice(0,300)}`;
  }
}

function clone(value) { return JSON.parse(JSON.stringify(value ?? null)); }

async function load(session = {}) {
  const key = applicationKey(session);
  const mem = memory.get(key);
  if (!db.isConfigured()) return mem ? clone(mem) : { applicationKey:key, rules:[], conflicts:[] };
  try {
    const [rulesResult, conflictsResult] = await Promise.all([
      db.query('select rule_json from application_behavior_rules where application_key=$1 order by rule_id',[key]),
      db.query('select conflict_json from application_behavior_conflicts where application_key=$1 order by conflict_id',[key]),
    ]);
    const state={applicationKey:key,rules:rulesResult.rows.map(r=>r.rule_json),conflicts:conflictsResult.rows.map(r=>r.conflict_json)};
    memory.set(key,clone(state));
    return state;
  } catch (err) {
    if (mem) return clone(mem);
    return { applicationKey:key, rules:[], conflicts:[], persistenceWarning:err.message };
  }
}

async function save(session = {}, rules = [], conflicts = []) {
  const key=applicationKey(session);
  const state={applicationKey:key,rules:clone(rules||[]),conflicts:clone(conflicts||[])};
  memory.set(key,state);
  if(!db.isConfigured()) return {applicationKey:key,mode:'SESSION_MEMORY'};
  try{
    await db.withTransaction(async client=>{
      await client.query('delete from application_behavior_rules where application_key=$1',[key]);
      for(const rule of rules||[]){
        await client.query('insert into application_behavior_rules(application_key,rule_id,version,rule_json) values($1,$2,$3,$4::jsonb)',[key,rule.ruleId,rule.version||1,JSON.stringify(rule)]);
        await client.query('insert into application_behavior_rule_history(application_key,rule_id,version,snapshot_json) values($1,$2,$3,$4::jsonb) on conflict(application_key,rule_id,version) do nothing',[key,rule.ruleId,rule.version||1,JSON.stringify(rule)]);
      }
      await client.query('delete from application_behavior_conflicts where application_key=$1',[key]);
      for(const conflict of conflicts||[])await client.query('insert into application_behavior_conflicts(application_key,conflict_id,conflict_json) values($1,$2,$3::jsonb)',[key,conflict.conflictId,JSON.stringify(conflict)]);
    });
    return {applicationKey:key,mode:'POSTGRESQL_AND_MEMORY'};
  }catch(err){return {applicationKey:key,mode:'SESSION_MEMORY',persistenceWarning:err.message};}
}

function clearMemory(){memory.clear();}

module.exports={applicationKey,load,save,clearMemory};

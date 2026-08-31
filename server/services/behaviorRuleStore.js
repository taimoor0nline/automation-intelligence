const db = require('../db');

function enabled(){ return db.isConfigured(); }

async function persist(sessionId, rules = [], conflicts = [], testCases = []) {
  if (!enabled()) return false;
  await db.withTransaction(async (client) => {
    const liveRuleIds = new Set();
    for (const rule of rules || []) {
      liveRuleIds.add(rule.ruleId);
      await client.query(
        `insert into behavior_rules(session_id,rule_id,version,scope_type,scope_ref,page_ref,form_ref,element_ref,rule_type,rule_value,trigger_type,expected_state,error_element_ref,source,approved,enabled,notes,updated_at)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,$17,now())
         on conflict(session_id,rule_id) do update set version=excluded.version,scope_type=excluded.scope_type,scope_ref=excluded.scope_ref,page_ref=excluded.page_ref,form_ref=excluded.form_ref,element_ref=excluded.element_ref,rule_type=excluded.rule_type,rule_value=excluded.rule_value,trigger_type=excluded.trigger_type,expected_state=excluded.expected_state,error_element_ref=excluded.error_element_ref,source=excluded.source,approved=excluded.approved,enabled=excluded.enabled,notes=excluded.notes,updated_at=now()`,
        [sessionId,rule.ruleId,rule.version||1,rule.scopeType,rule.scopeRef,rule.pageRef||null,rule.formRef||null,rule.elementRef||null,rule.ruleType,JSON.stringify(rule.value),rule.trigger||'AUTO',rule.expectedState||null,rule.errorElementRef||null,rule.source||'USER_DEFINED',Boolean(rule.approved),rule.enabled!==false,rule.notes||null]
      );
      await client.query(
        `insert into behavior_rule_history(session_id,rule_id,version,snapshot_json) values($1,$2,$3,$4::jsonb) on conflict(session_id,rule_id,version) do nothing`,
        [sessionId,rule.ruleId,rule.version||1,JSON.stringify(rule)]
      );
    }
    if (liveRuleIds.size) await client.query(`delete from behavior_rules where session_id=$1 and not(rule_id = any($2::varchar[]))`,[sessionId,[...liveRuleIds]]);
    else await client.query('delete from behavior_rules where session_id=$1',[sessionId]);

    await client.query('delete from behavior_rule_conflicts where session_id=$1',[sessionId]);
    for (const conflict of conflicts || []) {
      await client.query(
        `insert into behavior_rule_conflicts(session_id,conflict_id,rule_id,status,conflict_json,detected_at,resolved_at) values($1,$2,$3,$4,$5::jsonb,coalesce($6::timestamptz,now()),$7::timestamptz)`,
        [sessionId,conflict.conflictId,conflict.ruleId||null,conflict.status||'REVIEW_REQUIRED',JSON.stringify(conflict),conflict.detectedAt||null,conflict.resolvedAt||null]
      );
    }

    await client.query('delete from test_case_rule_links where session_id=$1',[sessionId]);
    for (const tc of testCases || []) {
      const effectiveById = new Map((tc.effectiveRules||[]).map(r=>[r.ruleId,r]));
      for (const ruleId of tc.ruleRefs || []) {
        const rule=effectiveById.get(ruleId) || (rules||[]).find(r=>r.ruleId===ruleId);
        await client.query(`insert into test_case_rule_links(session_id,external_case_id,rule_id,rule_version) values($1,$2,$3,$4) on conflict do nothing`,[sessionId,tc.id,ruleId,rule?.version||1]);
      }
    }
  });
  return true;
}

async function load(sessionId) {
  if (!enabled()) return null;
  const [rulesResult, conflictsResult] = await Promise.all([
    db.query('select * from behavior_rules where session_id=$1 order by scope_type,scope_ref,rule_type',[sessionId]),
    db.query('select conflict_json from behavior_rule_conflicts where session_id=$1 order by detected_at',[sessionId]),
  ]);
  const rules = rulesResult.rows.map(row=>({
    ruleId:row.rule_id,version:row.version,scopeType:row.scope_type,scopeRef:row.scope_ref,pageRef:row.page_ref,formRef:row.form_ref,elementRef:row.element_ref,ruleType:row.rule_type,value:row.rule_value,trigger:row.trigger_type,expectedState:row.expected_state,errorElementRef:row.error_element_ref,source:row.source,approved:row.approved,enabled:row.enabled,notes:row.notes,updatedAt:row.updated_at?.toISOString?.()||row.updated_at,
  }));
  return { rules, conflicts: conflictsResult.rows.map(row=>row.conflict_json) };
}

module.exports={enabled,persist,load};

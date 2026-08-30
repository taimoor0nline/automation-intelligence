const db = require('../db');

function enabled() { return db.isConfigured(); }

async function persistRegistry(sessionId, registry) {
  if (!enabled() || !registry) return false;
  await db.query(
    `insert into canonical_element_registries(session_id,registry_hash,registry_json,updated_at)
     values($1,$2,$3::jsonb,now())
     on conflict(session_id) do update set registry_hash=excluded.registry_hash,registry_json=excluded.registry_json,updated_at=now()`,
    [sessionId, registry.registryHash || null, JSON.stringify(registry)]
  );
  return true;
}

async function persistPlan(sessionId, plan) {
  if (!enabled() || !plan) return false;
  await db.query(
    `insert into canonical_generation_plans(session_id,plan_json,updated_at)
     values($1,$2::jsonb,now())
     on conflict(session_id) do update set plan_json=excluded.plan_json,updated_at=now()`,
    [sessionId, JSON.stringify(plan)]
  );
  return true;
}

async function persistCaseIr(sessionId, testCase) {
  if (!enabled() || !testCase?.canonicalIr || !testCase?.id) return false;
  await db.query(
    `insert into canonical_test_ir(session_id,external_case_id,planned_id,ir_version,ir_json,validation_json,updated_at)
     values($1,$2,$3,$4,$5::jsonb,$6::jsonb,now())
     on conflict(session_id,external_case_id) do update set
       planned_id=excluded.planned_id,ir_version=excluded.ir_version,ir_json=excluded.ir_json,
       validation_json=excluded.validation_json,updated_at=now()`,
    [
      sessionId,
      testCase.id,
      testCase.canonicalIr.plannedId || null,
      Number(testCase.canonicalIr.version || 1),
      JSON.stringify(testCase.canonicalIr),
      JSON.stringify(testCase.canonicalValidation || {}),
    ]
  );
  return true;
}

async function persistCases(sessionId, testCases = []) {
  if (!enabled()) return false;
  for (const testCase of testCases || []) await persistCaseIr(sessionId, testCase);
  return true;
}

module.exports = { enabled, persistRegistry, persistPlan, persistCaseIr, persistCases };

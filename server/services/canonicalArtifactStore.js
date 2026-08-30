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

async function persistAll(sessionId, session) {
  if (!enabled()) return false;
  await persistRegistry(sessionId, session?.canonicalElementRegistry);
  await persistPlan(sessionId, session?.canonicalGenerationPlan);
  await persistCases(sessionId, session?.testCases || []);
  return true;
}

async function load(sessionId) {
  if (!enabled()) return null;
  const [registry, plan, cases] = await Promise.all([
    db.query('select registry_json from canonical_element_registries where session_id=$1', [sessionId]),
    db.query('select plan_json from canonical_generation_plans where session_id=$1', [sessionId]),
    db.query('select external_case_id,ir_json,validation_json from canonical_test_ir where session_id=$1', [sessionId]),
  ]);
  return {
    registry: registry.rows[0]?.registry_json || null,
    plan: plan.rows[0]?.plan_json || null,
    cases: new Map((cases.rows || []).map((row) => [String(row.external_case_id || '').toUpperCase(), {
      canonicalIr: row.ir_json || null,
      canonicalValidation: row.validation_json || null,
    }])),
  };
}

function applyLoadedArtifacts(session, artifacts) {
  if (!session || !artifacts) return session;
  if (artifacts.registry) session.canonicalElementRegistry = artifacts.registry;
  if (artifacts.plan) session.canonicalGenerationPlan = artifacts.plan;
  if (artifacts.cases?.size && Array.isArray(session.testCases)) {
    session.testCases = session.testCases.map((testCase) => {
      const stored = artifacts.cases.get(String(testCase?.id || '').toUpperCase());
      return stored ? { ...testCase, ...stored } : testCase;
    });
  }
  return session;
}

module.exports = { enabled, persistRegistry, persistPlan, persistCaseIr, persistCases, persistAll, load, applyLoadedArtifacts };

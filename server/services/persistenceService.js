const db = require('../db');

function enabled() { return db.isConfigured(); }

async function persistSession(sessionId, session, context = {}) {
  if (!enabled()) return null;
  const projectId = context.projectId || session.projectId || null;
  const userId = context.userId || session.createdBy || null;
  const repositoryId = context.repositoryId || session.repositoryId || null;
  const safeSession = {
    state: session.state,
    story: session.story,
    targetUrl: session.targetUrl,
    environment: session.environment,
    additionalPaths: session.additionalPaths,
    aiModelTier: session.aiModelTier,
    pageDiscoveries: session.pageDiscoveries,
    testCases: session.testCases,
    automationReadiness: session.automationReadiness,
    readinessValidated: session.readinessValidated,
    approvedIds: session.approvedIds,
    runHistory: session.runHistory,
    failureAnalyses: session.failureAnalyses,
  };
  await db.query(
    `insert into test_sessions(id,project_id,created_by,state,story,target_url,environment,ai_model_tier,repository_id,session_json)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
     on conflict(id) do update set project_id=excluded.project_id, state=excluded.state, story=excluded.story,
       target_url=excluded.target_url, environment=excluded.environment, ai_model_tier=excluded.ai_model_tier,
       repository_id=excluded.repository_id, session_json=excluded.session_json, updated_at=now()`,
    [sessionId, projectId, userId, session.state || 'IDLE', session.story, session.targetUrl, session.environment, session.aiModelTier, repositoryId, JSON.stringify(safeSession)]
  );
  return true;
}

async function persistTestCases(sessionId, testCases = []) {
  if (!enabled()) return;
  await db.withTransaction(async (client) => {
    for (const tc of testCases) {
      await client.query(
        `insert into test_cases(session_id,external_case_id,title,type,priority,source,case_json)
         values($1,$2,$3,$4,$5,$6,$7::jsonb)
         on conflict(session_id,external_case_id) do update set title=excluded.title,type=excluded.type,priority=excluded.priority,source=excluded.source,case_json=excluded.case_json`,
        [sessionId, tc.id, tc.title, tc.type || null, tc.priority || null, tc.source || null, JSON.stringify(tc)]
      );
    }
  });
}

async function persistRun({ sessionId, session, runNumber, summary, approvedIds, userId }) {
  if (!enabled()) return null;
  return db.withTransaction(async (client) => {
    const run = await client.query(
      `insert into test_runs(session_id,project_id,repository_id,run_number,executed_by,approved_ids,total,passed,failed,duration_ms,browser,summary_json,completed_at)
       values($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12::jsonb,now())
       on conflict(session_id,run_number) do update set approved_ids=excluded.approved_ids,total=excluded.total,passed=excluded.passed,failed=excluded.failed,duration_ms=excluded.duration_ms,browser=excluded.browser,summary_json=excluded.summary_json,completed_at=now()
       returning id`,
      [sessionId, session.projectId || null, session.repositoryId || null, runNumber, userId || null, JSON.stringify(approvedIds || []), summary.total || 0, summary.passed || 0, summary.failed || 0, summary.durationMs || null, summary.browser || null, JSON.stringify(summary)]
    );
    const runId = run.rows[0].id;
    await client.query('delete from test_results where run_id=$1', [runId]);
    for (const result of summary.tests || []) {
      const caseId = result.testCaseId || String(result.title || '').match(/TC(?:\d{3}|-H\d{3})/)?.[0] || null;
      await client.query(
        `insert into test_results(run_id,external_case_id,title,passed,duration_ms,error_message,evidence_json)
         values($1,$2,$3,$4,$5,$6,$7::jsonb)`,
        [runId, caseId, result.title || caseId || 'Test', Boolean(result.pass), result.durationMs || null, result.err?.message || null, JSON.stringify(result.evidence || {})]
      );
    }
    return runId;
  });
}

async function persistAnalyses(runId, analyses = []) {
  if (!enabled() || !runId) return;
  await db.withTransaction(async (client) => {
    for (const a of analyses) {
      await client.query(
        `insert into defect_analyses(run_id,external_case_id,classification,severity,confidence,summary,probable_cause,resolution_comment,recommended_fix,recommended_owner,developer_review_area,developer_implementation_hint,developer_example_fix,source_context,verification_steps,regression_checks)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16::jsonb)
         on conflict(run_id,external_case_id) do update set classification=excluded.classification,severity=excluded.severity,confidence=excluded.confidence,summary=excluded.summary,probable_cause=excluded.probable_cause,resolution_comment=excluded.resolution_comment,recommended_fix=excluded.recommended_fix,recommended_owner=excluded.recommended_owner,developer_review_area=excluded.developer_review_area,developer_implementation_hint=excluded.developer_implementation_hint,developer_example_fix=excluded.developer_example_fix,source_context=excluded.source_context,verification_steps=excluded.verification_steps,regression_checks=excluded.regression_checks`,
        [runId, a.testCase || null, a.classification || 'UNKNOWN', a.severity || null, a.confidence ?? null, a.summary || null, a.probableCause || null, a.resolutionComment || null, a.recommendedFix || null, a.recommendedOwner || null, a.developerReviewArea || null, a.developerImplementationHint || null, a.developerExampleFix || null, JSON.stringify(a.sourceContext || {}), JSON.stringify(a.verificationSteps || []), JSON.stringify(a.regressionChecks || [])]
      );
    }
  });
}

async function latestRunId(sessionId, runNumber) {
  if (!enabled()) return null;
  const result = await db.query('select id from test_runs where session_id=$1 and run_number=$2', [sessionId, runNumber]);
  return result.rows[0]?.id || null;
}

async function loadSession(sessionId) {
  if (!enabled()) return null;
  const result = await db.query('select session_json,project_id,repository_id,created_by from test_sessions where id=$1', [sessionId]);
  if (!result.rows[0]) return null;
  return { ...(result.rows[0].session_json || {}), projectId: result.rows[0].project_id, repositoryId: result.rows[0].repository_id, createdBy: result.rows[0].created_by };
}

module.exports = { enabled, persistSession, persistTestCases, persistRun, persistAnalyses, latestRunId, loadSession };

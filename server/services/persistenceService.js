const db = require('../db');
const { normalizeTestCategory } = require('./testCategories');
const { publicActorCatalog } = require('./testActorProfiles');
const { normalizeWorkflowRequirements } = require('./workflowRequirements');
const {
  normalizeSecuritySubcategory,
  normalizeSecuritySeverity,
  inferSecuritySubcategory,
  inferSecuritySeverity,
} = require('./securityTaxonomy');

const SCENARIO_TYPES = new Set(['positive','negative','boundary','functional','custom']);
const PRIORITIES = new Set(['low','medium','high']);

function enabled() { return db.isConfigured(); }

function categoryOf(testCase) {
  return normalizeTestCategory(
    testCase?.testCategory ||
    testCase?.category ||
    testCase?.testData?.__testCategory ||
    'FUNCTIONAL'
  );
}

function scenarioTypeOf(testCase) {
  const value = String(testCase?.type || 'functional').trim().toLowerCase();
  return SCENARIO_TYPES.has(value) ? value : 'functional';
}

function priorityOf(testCase) {
  const value = String(testCase?.priority || 'medium').trim().toLowerCase();
  return PRIORITIES.has(value) ? value : 'medium';
}

function securityOf(testCase) {
  if (categoryOf(testCase) !== 'SECURITY') return { subcategory: null, severity: null };
  return {
    subcategory: normalizeSecuritySubcategory(testCase?.securitySubcategory, inferSecuritySubcategory(testCase)),
    severity: normalizeSecuritySeverity(testCase?.severity || testCase?.securitySeverity, inferSecuritySeverity(testCase)),
  };
}

function buildSafeSessionPayload(session = {}) {
  const targetType = String(session.targetType || 'WEB').toUpperCase() === 'REST' ? 'REST' : 'WEB';
  const apiTargetId = targetType === 'REST' ? (session.apiTargetId || null) : null;
  const apiOperationIds = targetType === 'REST' && Array.isArray(session.apiOperationIds) ? session.apiOperationIds : [];
  return {
    state: session.state,
    targetType,
    story: session.story,
    workflowRequirements: normalizeWorkflowRequirements(session.workflowRequirements),
    targetUrl: session.targetUrl,
    environment: session.environment,
    additionalPaths: session.additionalPaths,
    aiModelTier: session.aiModelTier,
    // Persist only public role metadata. Runtime usernames/passwords stay exclusively
    // in session.actorCredentials and are intentionally excluded from PostgreSQL.
    testActors: publicActorCatalog(session.testActors || []),
    apiTargetId,
    apiOperationIds,
    apiOperations: targetType === 'REST' ? (session.apiOperations || []) : [],
    pageDiscoveries: session.pageDiscoveries,
    testCases: session.testCases,
    automationReadiness: session.automationReadiness,
    readinessValidated: session.readinessValidated,
    approvedIds: session.approvedIds,
    runHistory: session.runHistory,
    failureAnalyses: session.failureAnalyses,
    lastResults: session.lastResults ? {
      summary: session.lastResults.summary || null,
      runNumber: session.lastResults.runNumber || null,
      deterministicFindings: session.lastResults.deterministicFindings || [],
    } : null,
  };
}

async function persistSession(sessionId, session, context = {}) {
  if (!enabled()) return null;
  const projectId = context.projectId || session.projectId || null;
  const userId = context.userId || session.createdBy || null;
  const repositoryId = context.repositoryId || session.repositoryId || null;
  const safeSession = buildSafeSessionPayload(session);
  const targetType = safeSession.targetType;
  const apiTargetId = safeSession.apiTargetId;
  const apiOperationIds = safeSession.apiOperationIds;
  await db.query(
    `insert into test_sessions(id,project_id,created_by,state,story,target_url,environment,ai_model_tier,repository_id,target_type,api_target_id,api_operation_ids,session_json)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb)
     on conflict(id) do update set project_id=excluded.project_id, state=excluded.state, story=excluded.story,
       target_url=excluded.target_url, environment=excluded.environment, ai_model_tier=excluded.ai_model_tier,
       repository_id=excluded.repository_id,target_type=excluded.target_type,api_target_id=excluded.api_target_id,
       api_operation_ids=excluded.api_operation_ids,session_json=excluded.session_json,updated_at=now()`,
    [sessionId, projectId, userId, session.state || 'IDLE', session.story, session.targetUrl, session.environment, session.aiModelTier, repositoryId, targetType, apiTargetId, JSON.stringify(apiOperationIds), JSON.stringify(safeSession)]
  );
  return true;
}

async function persistTestCases(sessionId, testCases = []) {
  if (!enabled()) return;
  await db.withTransaction(async (client) => {
    for (const tc of testCases) {
      const testCategory = categoryOf(tc);
      const scenarioType = scenarioTypeOf(tc);
      const priority = priorityOf(tc);
      const security = securityOf(tc);
      const normalizedCase = {
        ...tc,
        type: scenarioType,
        testCategory,
        priority,
        securitySubcategory: security.subcategory,
        severity: security.severity,
      };
      await client.query(
        `insert into test_cases(session_id,external_case_id,title,type,test_category,priority,security_subcategory,severity,source,case_json)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
         on conflict(session_id,external_case_id) do update set
           title=excluded.title,type=excluded.type,test_category=excluded.test_category,
           priority=excluded.priority,security_subcategory=excluded.security_subcategory,severity=excluded.severity,
           source=excluded.source,case_json=excluded.case_json`,
        [sessionId, tc.id, tc.title, scenarioType, testCategory, priority, security.subcategory, security.severity, tc.source || null, JSON.stringify(normalizedCase)]
      );
    }
  });
}

async function persistRun({ sessionId, session, runNumber, summary, approvedIds, userId }) {
  if (!enabled()) return null;
  return db.withTransaction(async (client) => {
    const targetType = String(session.targetType || 'WEB').toUpperCase() === 'REST' ? 'REST' : 'WEB';
    const run = await client.query(
      `insert into test_runs(
         session_id,project_id,repository_id,run_number,executed_by,executed_by_role,
         approved_ids,total,passed,failed,duration_ms,browser,summary_json,target_type,api_target_id,completed_at)
       values($1,$2,$3,$4,$5,(select role::text from users where id=$5),$6::jsonb,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,now())
       on conflict(session_id,run_number) do update set
         executed_by=excluded.executed_by,executed_by_role=excluded.executed_by_role,
         approved_ids=excluded.approved_ids,total=excluded.total,passed=excluded.passed,failed=excluded.failed,
         duration_ms=excluded.duration_ms,browser=excluded.browser,summary_json=excluded.summary_json,
         target_type=excluded.target_type,api_target_id=excluded.api_target_id,completed_at=now()
       returning id`,
      [
        sessionId,
        session.projectId || null,
        session.repositoryId || null,
        runNumber,
        userId || null,
        JSON.stringify(approvedIds || []),
        summary.total || 0,
        summary.passed || 0,
        summary.failed || 0,
        summary.durationMs || null,
        summary.browser || null,
        JSON.stringify(summary),
        targetType,
        targetType === 'REST' ? (session.apiTargetId || null) : null,
      ]
    );
    const runId = run.rows[0].id;
    const classificationByCaseId = new Map(
      (session.testCases || []).map((testCase) => {
        const security = securityOf(testCase);
        return [String(testCase.id || '').toUpperCase(), {
          category: categoryOf(testCase),
          scenarioType: scenarioTypeOf(testCase),
          priority: priorityOf(testCase),
          securitySubcategory: security.subcategory,
          severity: security.severity,
        }];
      })
    );

    await client.query('delete from test_results where run_id=$1', [runId]);
    for (const result of summary.tests || []) {
      const caseId = result.testCaseId || String(result.title || '').match(/TC(?:\d{3}|-H\d{3})/)?.[0] || null;
      const classification = classificationByCaseId.get(String(caseId || '').toUpperCase()) || {
        category: 'FUNCTIONAL', scenarioType: 'functional', priority: 'medium', securitySubcategory: null, severity: null,
      };
      await client.query(
        `insert into test_results(run_id,external_case_id,title,test_category,scenario_type,priority,security_subcategory,severity,passed,duration_ms,error_message,evidence_json)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
        [runId, caseId, result.title || caseId || 'Test', classification.category, classification.scenarioType, classification.priority, classification.securitySubcategory, classification.severity, Boolean(result.pass), result.durationMs || null, result.err?.message || null, JSON.stringify(result.evidence || {})]
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
        `insert into defect_analyses(
           run_id,external_case_id,classification,severity,confidence,summary,probable_cause,
           resolution_comment,recommended_fix,recommended_owner,developer_review_area,
           developer_implementation_hint,developer_example_fix,source_context,source_guidance_level,
           source_candidate_files,verification_steps,regression_checks)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16::jsonb,$17::jsonb,$18::jsonb)
         on conflict(run_id,external_case_id) do update set
           classification=excluded.classification,severity=excluded.severity,confidence=excluded.confidence,
           summary=excluded.summary,probable_cause=excluded.probable_cause,resolution_comment=excluded.resolution_comment,
           recommended_fix=excluded.recommended_fix,recommended_owner=excluded.recommended_owner,
           developer_review_area=excluded.developer_review_area,developer_implementation_hint=excluded.developer_implementation_hint,
           developer_example_fix=excluded.developer_example_fix,source_context=excluded.source_context,
           source_guidance_level=excluded.source_guidance_level,source_candidate_files=excluded.source_candidate_files,
           verification_steps=excluded.verification_steps,regression_checks=excluded.regression_checks`,
        [
          runId, a.testCase || null, a.classification || 'UNKNOWN', a.severity || null, a.confidence ?? null,
          a.summary || null, a.probableCause || null, a.resolutionComment || null, a.recommendedFix || null,
          a.recommendedOwner || null, a.developerReviewArea || null, a.developerImplementationHint || null,
          a.developerExampleFix || null, JSON.stringify(a.sourceContext || {}), a.sourceGuidanceLevel || 'BLACK_BOX',
          JSON.stringify(a.sourceCandidateFiles || []), JSON.stringify(a.verificationSteps || []), JSON.stringify(a.regressionChecks || [])
        ]
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
  const result = await db.query('select session_json,project_id,repository_id,created_by,target_type,api_target_id,api_operation_ids from test_sessions where id=$1', [sessionId]);
  if (!result.rows[0]) return null;
  const row = result.rows[0];
  return {
    ...(row.session_json || {}),
    projectId: row.project_id,
    repositoryId: row.repository_id,
    createdBy: row.created_by,
    targetType: row.target_type || row.session_json?.targetType || 'WEB',
    apiTargetId: row.api_target_id || row.session_json?.apiTargetId || null,
    apiOperationIds: row.api_operation_ids || row.session_json?.apiOperationIds || [],
  };
}

module.exports = {
  enabled,
  buildSafeSessionPayload,
  persistSession,
  persistTestCases,
  persistRun,
  persistAnalyses,
  latestRunId,
  loadSession,
};

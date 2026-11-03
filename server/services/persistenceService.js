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

function publicActorDirectory(value = []) {
  return (Array.isArray(value) ? value : []).slice(0, 500).map((actor) => ({
    actorRef: String(actor?.actorRef || '').trim().slice(0, 80),
    role: String(actor?.role || '').trim().slice(0, 80),
    displayName: String(actor?.displayName || actor?.role || '').trim().slice(0, 100),
    description: String(actor?.description || '').trim().slice(0, 300) || null,
    enabled: actor?.enabled !== false,
    source: String(actor?.source || '').trim().slice(0, 40) || null,
    sourceRow: Number.isFinite(Number(actor?.sourceRow)) ? Number(actor.sourceRow) : null,
  })).filter((actor) => actor.actorRef && actor.role);
}

function buildSafeSessionPayload(session = {}) {
  const targetType = String(session.targetType || 'WEB').toUpperCase() === 'REST' ? 'REST' : 'WEB';
  const apiTargetId = targetType === 'REST' ? (session.apiTargetId || null) : null;
  const apiOperationIds = targetType === 'REST' && Array.isArray(session.apiOperationIds) ? session.apiOperationIds : [];
  const directory = publicActorDirectory(session.testActorDirectory || []);
  const directoryRefs = new Set(directory.map((actor) => actor.actorRef));
  const activeRefs = [...new Set((Array.isArray(session.testActorActiveRefs) ? session.testActorActiveRefs : [])
    .map(String)
    .filter((ref) => directoryRefs.has(ref)))].slice(0, 12);
  return {
    state: session.state,
    targetType,
    story: session.story,
    // Only source references, never task credentials or private attachment bytes.
    contextSource: session.contextSource ? { type: session.contextSource.type || 'MANUAL', storyId: session.contextSource.storyId || null, taskId: session.contextSource.taskId || null } : null,
    workflowRequirements: normalizeWorkflowRequirements(session.workflowRequirements),
    targetUrl: session.targetUrl,
    environment: session.environment,
    additionalPaths: session.additionalPaths,
    aiModelTier: session.aiModelTier,
    // Persist public actor metadata only. Runtime usernames/passwords stay exclusively
    // in actorCredentials/testActorDirectoryCredentials and are never serialized.
    testActors: publicActorCatalog(session.testActors || []),
    testActorDirectory: directory,
    testActorActiveRefs: activeRefs,
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
    // Version snapshots contain only test contract data; never persist runtime credentials.
    repairLearning: session.repairLearning || {},
    validatedRepairMemory: (session.validatedRepairMemory || []).slice(-200),
    lastResults: session.lastResults ? {
      summary: session.lastResults.summary || null,
      runNumber: session.lastResults.runNumber || null,
      deterministicFindings: session.lastResults.deterministicFindings || [],
    } : null,
  };
}

async function persistSession(sessionId, session, context = {}) {
  if (!enabled()) return null;
  const query = context.client ? context.client.query.bind(context.client) : db.query;
  const projectId = context.projectId || session.projectId || null;
  const userId = context.userId || session.createdBy || null;
  const repositoryId = context.repositoryId || session.repositoryId || null;
  const safeSession = buildSafeSessionPayload(session);
  const targetType = safeSession.targetType;
  const apiTargetId = safeSession.apiTargetId;
  const apiOperationIds = safeSession.apiOperationIds;
  await query(
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

async function persistTestCases(sessionId, testCases = [], client = null) {
  if (!enabled()) return;
  const work = async (connection) => {
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
      await connection.query(
        `insert into test_cases(session_id,external_case_id,title,type,test_category,priority,security_subcategory,severity,source,case_json)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
         on conflict(session_id,external_case_id) do update set
           title=excluded.title,type=excluded.type,test_category=excluded.test_category,
           priority=excluded.priority,security_subcategory=excluded.security_subcategory,severity=excluded.severity,
           source=excluded.source,case_json=excluded.case_json`,
        [sessionId, tc.id, tc.title, scenarioType, testCategory, priority, security.subcategory, security.severity, tc.source || null, JSON.stringify(normalizedCase)]
      );
    }
    if(testCases.length){await connection.query("insert into project_audit_events(project_id,session_id,event_type,metadata) select project_id,$1,'TEST_CASES_SAVED',$2::jsonb from test_sessions where id=$1 and project_id is not null",[sessionId,JSON.stringify({caseCount:testCases.length})]);}
  };
  if (client) await work(client);
  else await db.withTransaction(work);
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
    if(session.projectId)await client.query("insert into project_audit_events(project_id,session_id,actor_id,event_type,metadata) values($1,$2,$3,'TEST_RUN_COMPLETED',$4::jsonb)",[session.projectId,sessionId,userId||null,JSON.stringify({runId,runNumber,total:summary.total||0,passed:summary.passed||0,failed:summary.failed||0})]);
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
    await persistRunReportSnapshots({sessionId,session,runId,userId,client});
    if(session.projectId)await require('./repairMemoryService').captureVerified({client,projectId:session.projectId,session,runId,userId});
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

async function persistReviewedCase(sessionId, session, testCase) {
  // DB disabled is a hard no-op. DB enabled saves session, case and canonical IR
  // in the same transaction before a successful Save/Confirm response.
  if (!enabled()) return false;
  const canonical = require('./canonicalArtifactStore');
  await db.withTransaction(async (client) => {
    await persistSession(sessionId, session, {
      projectId: session.projectId,
      repositoryId: session.repositoryId,
      userId: session.createdBy,
      client,
    });
    await persistTestCases(sessionId, [testCase], client);
    await canonical.persistCaseIr(sessionId, testCase, client);
    if(session.projectId)await client.query("insert into project_audit_events(project_id,session_id,actor_id,event_type,metadata) values($1,$2,$3,'TEST_CASE_REVIEWED',$4::jsonb)",[session.projectId,sessionId,session.createdBy||null,JSON.stringify({caseId:String(testCase.id),status:'SAVED'})]);
    // Persist the reviewed contract, not runtime credentials or raw session state.
    const reviewed={id:testCase.id,title:testCase.title,priority:testCase.priority,type:testCase.type,source:testCase.source,steps:testCase.steps,expectedResult:testCase.expectedResult,automationReadiness:testCase.automationReadiness,reviewedAt:new Date().toISOString()};
    // Serialize revision allocation for a single case across concurrent reviewers.
    await client.query('select pg_advisory_xact_lock(hashtext($1),hashtext($2))',[sessionId,String(testCase.id)]);
    const rev=await client.query("select coalesce(max(revision),0)+1 as next from test_report_snapshots where session_id=$1 and external_case_id=$2 and report_kind='REVIEWED_CASE'",[sessionId,String(testCase.id)]);
    await client.query("insert into test_report_snapshots(project_id,session_id,external_case_id,report_kind,revision,report_json,recorded_by) values($1,$2,$3,'REVIEWED_CASE',$4,$5::jsonb,$6)",[session.projectId||null,sessionId,String(testCase.id),rev.rows[0].next,JSON.stringify(reviewed),session.createdBy||null]);
  });
  return true;
}

async function persistRunReportSnapshots({sessionId,session,runId,userId,client=null}) {
 if(!enabled()||!runId)return false;
 const runNumber=session.lastResults?.runNumber;
 const summary=session.lastResults?.summary||{};
 const learning=session.repairLearning||{};
 const repairs=Array.isArray(learning.repairs)?learning.repairs:[];
 const verifiedRepairs=repairs.filter(x=>x&&typeof x==='object'&&(x.verified===true||x.validationStatus==='PASSED'||x.validation?.status==='PASSED')).map(x=>({
  repairId:String(x.id||x.repairId||'').slice(0,100),
  failureSignature:String(x.failureSignature||x.signature||'').slice(0,300),
  validationStatus:'PASSED',
  validatedAt:x.validatedAt||null,
  confidence:Number.isFinite(Number(x.confidence))?Math.max(0,Math.min(1,Number(x.confidence))):null,
 }));
 const reports=[
  {kind:'EXECUTION',payload:{sessionId,runNumber,summary,approvedIds:session.approvedIds||[],generatedAt:new Date().toISOString()},html:session.reportHtml||null},
  {kind:'AI_LEARNING',payload:{signatureCount:Array.isArray(learning.signatures)?learning.signatures.length:0,repairCount:repairs.length,verifiedRepairCount:verifiedRepairs.length,verifiedRepairs,recordedAt:new Date().toISOString(),source:'session_repair_learning'},html:null}
 ];
 const write=async connection=>{
  for(const report of reports){
   await connection.query(`insert into test_report_snapshots(project_id,session_id,run_id,report_kind,revision,report_json,report_html,recorded_by)
    values($1,$2,$3,$4,1,$5::jsonb,$6,$7)
    on conflict(run_id,report_kind,revision) where run_id is not null
    do update set report_json=excluded.report_json,report_html=excluded.report_html`,
    [session.projectId||null,sessionId,runId,report.kind,JSON.stringify(report.payload),report.html,userId||session.createdBy||null]);
  }
 };
 if(client)await write(client);else await db.withTransaction(write);
 return true;
}

module.exports = {
  enabled,
  buildSafeSessionPayload,
  persistSession,
  persistTestCases,
  persistReviewedCase,
  persistRun,
  persistRunReportSnapshots,
  persistAnalyses,
  latestRunId,
  loadSession,
};

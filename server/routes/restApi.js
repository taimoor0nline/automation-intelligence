const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('../services/authService');
const { getSession } = require('../data/sessionStore');
const { discoverOpenApi, normalizeManualOperation, normalizeBaseUrl } = require('../services/restApiDiscoveryService');
const { generateRestTestCases } = require('../services/restTestCaseAiService');
const { assessRestTestCases, generateRestAutomation, readinessSummary } = require('../services/restAutomationService');
const { executeSingleGeneratedSpec } = require('../services/singleSpecRunner');
const { buildAnalyticsReport } = require('../services/reportGenerator');
const { normalizeProfile } = require('../services/aiModelProfiles');

const TEST_ID = /^TC(?:\d{3}|-H\d{3})$/;
const READY = 'READY';

function clean(value, max = 1000) { return String(value ?? '').trim().slice(0, max); }
function authType(value) {
  const type = String(value || 'NONE').toUpperCase();
  if (!['NONE','BASIC','BEARER','API_KEY_HEADER'].includes(type)) throw new Error('REST auth type must be NONE, BASIC, BEARER, or API_KEY_HEADER.');
  return type;
}
function safeAuthConfig(type, body = {}) {
  if (type === 'API_KEY_HEADER') {
    const headerName = clean(body.headerName, 100);
    if (!headerName) throw new Error('API key header name is required.');
    if (/^(authorization|proxy-authorization)$/i.test(headerName)) throw new Error('Use BEARER or BASIC for Authorization headers.');
    return { headerName };
  }
  return {};
}
function runtimeAuth(input, target) {
  const type = authType(input?.type || target.auth_type || 'NONE');
  const runtime = { type, username: '', secret: '', headerName: '' };
  if (type === 'BASIC') { runtime.username = clean(input?.username, 300); runtime.secret = String(input?.secret || ''); }
  if (type === 'BEARER') runtime.secret = String(input?.secret || '');
  if (type === 'API_KEY_HEADER') { runtime.headerName = clean(input?.headerName || target.auth_config?.headerName, 100); runtime.secret = String(input?.secret || ''); }
  if (type !== 'NONE' && !runtime.secret) throw new Error('REST authentication secret is required for this run and is kept only in runtime memory.');
  if (type === 'BASIC' && !runtime.username) throw new Error('REST basic-auth username is required.');
  if (type === 'API_KEY_HEADER' && !runtime.headerName) throw new Error('REST API-key header name is required.');
  return runtime;
}

async function assertProjectAccess(req, projectId, allowedRoles = ['QA','MANAGER']) {
  const role = String(req.user?.role || '').toUpperCase();
  if (allowedRoles.includes(role) || role === 'MANAGER') return;
  const membership = await db.query('select 1 from project_members where project_id=$1 and user_id=$2', [projectId, req.user.sub]);
  if (!membership.rowCount) { const err = new Error('You do not have access to this project.'); err.statusCode = 403; throw err; }
}

async function insertOperations(client, targetId, operations, replaceOpenApi = false) {
  if (replaceOpenApi) await client.query(`delete from api_operations where api_target_id=$1 and source='OPENAPI'`, [targetId]);
  for (const op of operations) {
    await client.query(
      `insert into api_operations(api_target_id,source,operation_key,operation_id,method,path,summary,description,parameters,request_schema,request_example,responses,content_types)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb)
       on conflict(api_target_id,operation_key) do update set source=excluded.source,operation_id=excluded.operation_id,method=excluded.method,path=excluded.path,summary=excluded.summary,description=excluded.description,parameters=excluded.parameters,request_schema=excluded.request_schema,request_example=excluded.request_example,responses=excluded.responses,content_types=excluded.content_types,enabled=true,updated_at=now()`,
      [targetId, op.source, op.operationKey, op.operationId, op.method, op.path, op.summary, op.description, JSON.stringify(op.parameters || []), JSON.stringify(op.requestSchema || {}), op.requestExample === undefined ? null : JSON.stringify(op.requestExample), JSON.stringify(op.responses || {}), JSON.stringify(op.contentTypes || [])]
    );
  }
}

router.get('/api/projects/:projectId/rest-targets', requireAuth, async (req, res) => {
  try {
    await assertProjectAccess(req, req.params.projectId, ['QA','MANAGER']);
    const result = await db.query(`select t.*, (select count(*)::int from api_operations o where o.api_target_id=t.id and o.enabled=true) as operation_count from api_targets t where t.project_id=$1 order by t.created_at desc`, [req.params.projectId]);
    res.json({ ok: true, targets: result.rows });
  } catch (err) { res.status(err.statusCode || 500).json({ reply: err.message }); }
});

router.post('/api/projects/:projectId/rest-targets', requireAuth, requireRole('QA','MANAGER'), async (req, res) => {
  try {
    const mode = String(req.body?.discoveryMode || req.body?.mode || 'MANUAL').toUpperCase();
    if (!['MANUAL','OPENAPI'].includes(mode)) return res.status(400).json({ reply: 'discoveryMode must be MANUAL or OPENAPI.' });
    const type = authType(req.body?.authType || 'NONE');
    const config = safeAuthConfig(type, req.body?.authConfig || {});
    let imported = null;
    let baseUrl = clean(req.body?.baseUrl, 2000);
    let name = clean(req.body?.name, 200) || 'REST API';
    let specificationUrl = null;
    let operations = [];
    if (mode === 'OPENAPI') {
      specificationUrl = clean(req.body?.specificationUrl || req.body?.swaggerUrl, 3000);
      if (!specificationUrl) return res.status(400).json({ reply: 'Swagger/OpenAPI URL is required.' });
      imported = await discoverOpenApi(specificationUrl);
      baseUrl = clean(req.body?.baseUrl, 2000) || imported.baseUrl;
      name = clean(req.body?.name, 200) || imported.title;
      specificationUrl = imported.specificationUrl;
      operations = imported.operations;
    } else {
      if (!baseUrl) return res.status(400).json({ reply: 'Base URL is required for a manual REST target.' });
      if (req.body?.operation) operations = [normalizeManualOperation(req.body.operation)];
    }
    baseUrl = normalizeBaseUrl(baseUrl);
    const target = await db.withTransaction(async (client) => {
      const inserted = await client.query(
        `insert into api_targets(project_id,name,discovery_mode,base_url,specification_url,auth_type,auth_config,created_by) values($1,$2,$3,$4,$5,$6,$7::jsonb,$8) returning *`,
        [req.params.projectId, name, mode, baseUrl, specificationUrl, type, JSON.stringify(config), req.user.sub]
      );
      if (operations.length) await insertOperations(client, inserted.rows[0].id, operations);
      return inserted.rows[0];
    });
    res.status(201).json({ ok: true, target, imported: imported ? { format: imported.format, version: imported.version, operationCount: operations.length } : null });
  } catch (err) { res.status(400).json({ reply: err.message }); }
});

router.post('/api/rest-targets/:targetId/refresh', requireAuth, requireRole('QA','MANAGER'), async (req, res) => {
  try {
    const found = await db.query('select * from api_targets where id=$1', [req.params.targetId]);
    const target = found.rows[0];
    if (!target) return res.status(404).json({ reply: 'REST target not found.' });
    if (target.discovery_mode !== 'OPENAPI' || !target.specification_url) return res.status(409).json({ reply: 'Only OpenAPI/Swagger targets can be refreshed.' });
    const imported = await discoverOpenApi(target.specification_url);
    await db.withTransaction(async (client) => {
      await client.query('update api_targets set base_url=$1,updated_at=now() where id=$2', [imported.baseUrl, target.id]);
      await insertOperations(client, target.id, imported.operations, true);
    });
    res.json({ ok: true, format: imported.format, operationCount: imported.operations.length, baseUrl: imported.baseUrl });
  } catch (err) { res.status(400).json({ reply: err.message }); }
});

router.get('/api/rest-targets/:targetId/operations', requireAuth, async (req, res) => {
  try {
    const result = await db.query(`select * from api_operations where api_target_id=$1 and enabled=true order by path,method`, [req.params.targetId]);
    res.json({ ok: true, operations: result.rows });
  } catch (err) { res.status(500).json({ reply: err.message }); }
});

router.post('/api/rest-targets/:targetId/operations', requireAuth, requireRole('QA','MANAGER'), async (req, res) => {
  try {
    const target = await db.query('select id,discovery_mode from api_targets where id=$1', [req.params.targetId]);
    if (!target.rowCount) return res.status(404).json({ reply: 'REST target not found.' });
    const operation = normalizeManualOperation(req.body || {});
    await db.withTransaction(async (client) => insertOperations(client, req.params.targetId, [operation]));
    const saved = await db.query('select * from api_operations where api_target_id=$1 and operation_key=$2', [req.params.targetId, operation.operationKey]);
    res.status(201).json({ ok: true, operation: saved.rows[0] });
  } catch (err) { res.status(400).json({ reply: err.message }); }
});

function normalizeReviewedRestCases(input, fallback) {
  if (!Array.isArray(input)) return fallback;
  const seen = new Set();
  return input.slice(0, 50).map((raw, index) => {
    let id = clean(raw?.id, 20).toUpperCase();
    if (!TEST_ID.test(id) || seen.has(id)) id = `TC-H${String(index + 1).padStart(3, '0')}`;
    seen.add(id);
    return {
      id,
      title: clean(raw?.title, 300),
      type: ['positive','negative','boundary','functional','custom'].includes(String(raw?.type || '').toLowerCase()) ? String(raw.type).toLowerCase() : 'functional',
      priority: ['low','medium','high'].includes(String(raw?.priority || '').toLowerCase()) ? String(raw.priority).toLowerCase() : 'medium',
      preconditions: Array.isArray(raw?.preconditions) ? raw.preconditions.slice(0, 20).map((x) => clean(x, 500)) : [],
      testData: raw?.testData && typeof raw.testData === 'object' ? raw.testData : {},
      steps: Array.isArray(raw?.steps) ? raw.steps.slice(0, 30).map((step) => ({ action: clean(step?.action ?? step, 500), target: clean(step?.target, 500), value: step?.value ?? null })) : [],
      expectedResults: Array.isArray(raw?.expectedResults) ? raw.expectedResults.slice(0, 20).map((x) => clean(x, 700)) : [],
      apiRequest: raw?.apiRequest && typeof raw.apiRequest === 'object' ? raw.apiRequest : null,
      apiAssertions: Array.isArray(raw?.apiAssertions) ? raw.apiAssertions.slice(0, 30) : [],
      source: raw?.source || 'ai-reviewed',
    };
  }).filter((tc) => tc.title && tc.apiRequest);
}

async function loadRestTarget(targetId, operationIds) {
  const targetResult = await db.query('select * from api_targets where id=$1', [targetId]);
  const target = targetResult.rows[0];
  if (!target) throw new Error('REST target not found.');
  const ids = Array.isArray(operationIds) ? operationIds.filter(Boolean).slice(0, 100) : [];
  const operationsResult = ids.length
    ? await db.query('select * from api_operations where api_target_id=$1 and enabled=true and id=any($2::uuid[]) order by path,method', [targetId, ids])
    : await db.query('select * from api_operations where api_target_id=$1 and enabled=true order by path,method', [targetId]);
  if (!operationsResult.rows.length) throw new Error('Select at least one REST operation.');
  return { target, operations: operationsResult.rows };
}

router.post('/api/rest/sessions/:sessionId/generate', requireAuth, requireRole('QA','MANAGER'), async (req, res) => {
  try {
    const story = clean(req.body?.story, 12000);
    if (!story) return res.status(400).json({ reply: 'Business/API requirement is required.' });
    const { target, operations } = await loadRestTarget(req.body?.apiTargetId, req.body?.operationIds);
    const repositoryId = clean(req.body?.repositoryId, 100) || null;
    if (repositoryId) {
      const repo = await db.query('select id from source_repositories where id=$1 and project_id=$2 and source_enabled=true', [repositoryId, target.project_id]);
      if (!repo.rowCount) return res.status(400).json({ reply: 'Source repository does not belong to the REST target project.' });
    }
    const modelTier = normalizeProfile(req.body?.aiModelTier || process.env.AI_MODEL_DEFAULT || 'strong');
    const generated = await generateRestTestCases({ story, operations, modelTier });
    const session = getSession(req.params.sessionId);
    session.state = 'AWAITING_APPROVAL';
    session.targetType = 'REST';
    session.story = story;
    session.targetUrl = target.base_url;
    session.environment = clean(req.body?.environment, 100) || 'Test';
    session.projectId = target.project_id;
    session.repositoryId = repositoryId;
    session.apiTargetId = target.id;
    session.apiOperationIds = operations.map((op) => op.id);
    session.apiOperations = operations;
    session.apiAuth = runtimeAuth(req.body?.apiAuth || { type: target.auth_type }, target);
    session.aiModelTier = modelTier;
    session.pageDiscoveries = [];
    session.testCases = assessRestTestCases(generated.testCases.map((tc) => ({ ...tc, source: 'ai' })), operations);
    session.automationReadiness = readinessSummary(session.testCases);
    session.readinessValidated = true;
    session.failureAnalyses = [];
    res.json({ ok: true, feature: generated.feature || target.name, targetType: 'REST', target: { id: target.id, name: target.name, baseUrl: target.base_url, discoveryMode: target.discovery_mode }, operationCount: operations.length, testCases: session.testCases, automationReadiness: session.automationReadiness, readinessPending: false });
  } catch (err) { res.status(400).json({ reply: err.message }); }
});

router.post('/api/rest/sessions/:sessionId/run', requireAuth, requireRole('QA','MANAGER'), async (req, res) => {
  const session = getSession(req.params.sessionId);
  try {
    if (session.targetType !== 'REST') return res.status(409).json({ reply: 'This session is not a REST API test session.' });
    const operations = Array.isArray(session.apiOperations) && session.apiOperations.length ? session.apiOperations : (await loadRestTarget(session.apiTargetId, session.apiOperationIds)).operations;
    if (req.body?.apiAuth) {
      const target = (await loadRestTarget(session.apiTargetId, session.apiOperationIds)).target;
      session.apiAuth = runtimeAuth(req.body.apiAuth, target);
    }
    session.testCases = assessRestTestCases(normalizeReviewedRestCases(req.body?.reviewedTestCases, session.testCases), operations);
    session.automationReadiness = readinessSummary(session.testCases);
    session.readinessValidated = true;
    const allIds = session.testCases.map((tc) => tc.id);
    const approved = (Array.isArray(req.body?.approvedIds) ? req.body.approvedIds : []).map((x) => String(x).toUpperCase()).filter((id) => allIds.includes(id));
    if (!approved.length) return res.status(400).json({ reply: 'Select at least one reviewed REST test case.' });
    const selected = session.testCases.filter((tc) => approved.includes(tc.id));
    const blocked = selected.filter((tc) => tc.automationReadiness?.status !== READY);
    if (blocked.length) return res.status(422).json({ reply: 'One or more selected REST tests are not Automation Ready.', unsupportedTestCases: blocked, automationReadiness: session.automationReadiness });
    const generated = generateRestAutomation(selected);
    session.generatedScript = [{ ...generated, testCaseIds: approved }];
    session.approvedIds = approved;
    session.failureAnalyses = [];
    session.state = 'RUNNING';
    const execResult = await executeSingleGeneratedSpec(generated, { targetType: 'REST', baseUrl: session.targetUrl, apiAuth: session.apiAuth || { type: 'NONE' } });
    if (!execResult.ok || !execResult.summary) { session.state = 'AWAITING_APPROVAL'; return res.status(500).json({ reply: `REST automation execution could not complete: ${execResult.error || 'unknown error'}` }); }
    const summary = execResult.summary;
    const runNumber = (session.runHistory?.length || 0) + 1;
    const completedAt = new Date().toISOString();
    const deterministicFindings = (summary.tests || []).filter((test) => test.fail).map((test) => ({ testCase: test.testCaseId, category: 'API_RESPONSE_MISMATCH', expected: (session.testCases.find((tc) => tc.id === test.testCaseId)?.expectedResults || []).join('; '), observed: test.err?.message || 'REST assertion failed.', aiRecommended: true }));
    const historyEntry = { runNumber, completedAt, approvedIds: [...approved], summary, deterministicFindings, analysisStatus: summary.failed > 0 ? 'PENDING' : 'NOT_REQUIRED', failureAnalyses: [] };
    session.runHistory = [...(session.runHistory || []), historyEntry].slice(-20);
    session.lastResults = { execResult, summary, runNumber, deterministicFindings };
    session.artifacts = null;
    session.reportHtml = buildAnalyticsReport({ sessionId: req.params.sessionId, story: session.story, targetUrl: session.targetUrl, environment: session.environment, summary, analyses: [], model: session.aiModelTier || 'strong' });
    session.state = 'DONE';
    res.json({ ok: true, reply: `REST run #${runNumber} complete: ${summary.total} tests, ${summary.passed} passed, ${summary.failed} failed.`, targetType: 'REST', runNumber, canRunAgain: true, summary, deterministicFindings, failureAnalyses: [], analysisPending: summary.failed > 0, analysisUrl: summary.failed > 0 ? '/api/test-results/analyze' : null, automationReadiness: session.automationReadiness, runtimePreflight: { status: 'PASSED', generationMode: generated.generationMode }, reportUrl: `/api/reports/${encodeURIComponent(req.params.sessionId)}`, generatedFile: generated.fileName });
  } catch (err) {
    session.state = session.state === 'RUNNING' ? 'AWAITING_APPROVAL' : session.state;
    res.status(500).json({ reply: err.message });
  }
});

module.exports = router;

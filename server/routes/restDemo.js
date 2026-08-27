const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');
const db = require('../db');
const { getSession } = require('../data/sessionStore');
const { discoverOpenApi, normalizeManualOperation, normalizeBaseUrl } = require('../services/restApiDiscoveryService');
const { generateRestTestCases } = require('../services/restTestCaseAiService');
const { assessRestTestCases, generateRestAutomation, readinessSummary } = require('../services/restAutomationService');
const { executeSingleGeneratedSpec } = require('../services/singleSpecRunner');
const { buildAnalyticsReport } = require('../services/reportGenerator');
const { normalizeProfile } = require('../services/aiModelProfiles');

const TEST_ID = /^TC(?:\d{3}|-H\d{3})$/;
const READY = 'READY';

function clean(value, max = 1000) {
  return String(value ?? '').trim().slice(0, max);
}

function demoModeOnly(res) {
  if (db.isConfigured()) {
    res.status(409).json({ reply: 'Database-free REST demo mode is disabled while PostgreSQL is configured. Use the normal REST workspace instead.' });
    return false;
  }
  return true;
}

function authType(value) {
  const type = String(value || 'NONE').toUpperCase();
  if (!['NONE', 'BASIC', 'BEARER', 'API_KEY_HEADER'].includes(type)) {
    throw new Error('REST auth type must be NONE, BASIC, BEARER, or API_KEY_HEADER.');
  }
  return type;
}

function safeAuthConfig(type, input = {}) {
  if (type !== 'API_KEY_HEADER') return {};
  const headerName = clean(input.headerName, 100);
  if (!headerName) throw new Error('API key header name is required.');
  if (/^(authorization|proxy-authorization)$/i.test(headerName)) {
    throw new Error('Use BEARER or BASIC for Authorization headers.');
  }
  return { headerName };
}

function normalizeTarget(raw = {}) {
  const type = authType(raw.authType || raw.auth_type || 'NONE');
  const config = safeAuthConfig(type, raw.authConfig || raw.auth_config || {});
  const baseUrl = normalizeBaseUrl(raw.baseUrl || raw.base_url || '');
  return {
    id: clean(raw.id, 100) || 'demo-target',
    name: clean(raw.name, 200) || 'REST API',
    discoveryMode: String(raw.discoveryMode || raw.discovery_mode || 'MANUAL').toUpperCase(),
    baseUrl,
    base_url: baseUrl,
    specificationUrl: clean(raw.specificationUrl || raw.specification_url, 3000) || null,
    specification_url: clean(raw.specificationUrl || raw.specification_url, 3000) || null,
    authType: type,
    auth_type: type,
    authConfig: config,
    auth_config: config,
  };
}

function runtimeAuth(input, target, { requireSecret = true } = {}) {
  const type = authType(input?.type || target?.authType || target?.auth_type || 'NONE');
  const runtime = { type, username: '', secret: '', headerName: '' };
  if (type === 'BASIC') {
    runtime.username = clean(input?.username, 300);
    runtime.secret = String(input?.secret || '');
  } else if (type === 'BEARER') {
    runtime.secret = String(input?.secret || '');
  } else if (type === 'API_KEY_HEADER') {
    runtime.headerName = clean(input?.headerName || target?.authConfig?.headerName || target?.auth_config?.headerName, 100);
    runtime.secret = String(input?.secret || '');
  }
  if (requireSecret && type !== 'NONE' && !runtime.secret) {
    throw new Error('REST authentication secret is required for execution and is kept only in runtime memory.');
  }
  if (requireSecret && type === 'BASIC' && !runtime.username) {
    throw new Error('REST basic-auth username is required for execution.');
  }
  if (type === 'API_KEY_HEADER' && !runtime.headerName) {
    throw new Error('REST API-key header name is required.');
  }
  return runtime;
}

function withDemoIds(operations = []) {
  return operations.slice(0, 100).map((operation, index) => ({
    ...operation,
    id: operation.id || `demo-op-${String(index + 1).padStart(3, '0')}`,
  }));
}

function normalizeReviewedRestCases(input, fallback = []) {
  if (!Array.isArray(input)) return fallback;
  const seen = new Set();
  return input.slice(0, 50).map((raw, index) => {
    let id = clean(raw?.id, 20).toUpperCase();
    if (!TEST_ID.test(id) || seen.has(id)) id = `TC-H${String(index + 1).padStart(3, '0')}`;
    seen.add(id);
    return {
      id,
      title: clean(raw?.title, 300),
      type: ['positive', 'negative', 'boundary', 'functional', 'custom'].includes(String(raw?.type || '').toLowerCase()) ? String(raw.type).toLowerCase() : 'functional',
      priority: ['low', 'medium', 'high'].includes(String(raw?.priority || '').toLowerCase()) ? String(raw.priority).toLowerCase() : 'medium',
      preconditions: Array.isArray(raw?.preconditions) ? raw.preconditions.slice(0, 20).map((x) => clean(x, 500)) : [],
      testData: raw?.testData && typeof raw.testData === 'object' ? raw.testData : {},
      steps: Array.isArray(raw?.steps) ? raw.steps.slice(0, 30).map((step) => ({
        action: clean(step?.action ?? step, 500),
        target: clean(step?.target, 500),
        value: step?.value ?? null,
      })) : [],
      expectedResults: Array.isArray(raw?.expectedResults) ? raw.expectedResults.slice(0, 20).map((x) => clean(x, 700)) : [],
      apiRequest: raw?.apiRequest && typeof raw.apiRequest === 'object' ? raw.apiRequest : null,
      apiAssertions: Array.isArray(raw?.apiAssertions) ? raw.apiAssertions.slice(0, 30) : [],
      source: raw?.source || 'ai-reviewed',
    };
  }).filter((testCase) => testCase.title && testCase.apiRequest);
}

router.get('/api/rest-demo/status', (_req, res) => {
  res.json({ ok: true, demoMode: !db.isConfigured(), databaseConfigured: db.isConfigured() });
});

router.post('/api/rest-demo/discover', async (req, res) => {
  if (!demoModeOnly(res)) return;
  try {
    const mode = String(req.body?.discoveryMode || req.body?.mode || 'MANUAL').toUpperCase();
    if (!['MANUAL', 'OPENAPI'].includes(mode)) throw new Error('discoveryMode must be MANUAL or OPENAPI.');
    const type = authType(req.body?.authType || 'NONE');
    const config = safeAuthConfig(type, req.body?.authConfig || {});
    let imported = null;
    let baseUrl = clean(req.body?.baseUrl, 2000);
    let name = clean(req.body?.name, 200) || 'REST API';
    let specificationUrl = null;
    let operations = [];

    if (mode === 'OPENAPI') {
      specificationUrl = clean(req.body?.specificationUrl || req.body?.swaggerUrl, 3000);
      if (!specificationUrl) throw new Error('Swagger/OpenAPI URL is required.');
      imported = await discoverOpenApi(specificationUrl);
      baseUrl = clean(req.body?.baseUrl, 2000) || imported.baseUrl;
      name = clean(req.body?.name, 200) || imported.title;
      specificationUrl = imported.specificationUrl;
      operations = withDemoIds(imported.operations);
    } else {
      if (!baseUrl) throw new Error('Base URL is required for a manual REST target.');
      if (req.body?.operation) operations = withDemoIds([normalizeManualOperation(req.body.operation)]);
    }

    const target = normalizeTarget({
      id: 'demo-target',
      name,
      discoveryMode: mode,
      baseUrl,
      specificationUrl,
      authType: type,
      authConfig: config,
    });

    res.json({
      ok: true,
      demoMode: true,
      target,
      operations,
      imported: imported ? { format: imported.format, version: imported.version, operationCount: operations.length } : null,
    });
  } catch (err) {
    res.status(400).json({ reply: err.message });
  }
});

router.post('/api/rest-demo/normalize-operation', (req, res) => {
  if (!demoModeOnly(res)) return;
  try {
    const operation = normalizeManualOperation(req.body || {});
    res.status(201).json({ ok: true, operation: { ...operation, id: `demo-op-${randomUUID()}` } });
  } catch (err) {
    res.status(400).json({ reply: err.message });
  }
});

router.post('/api/rest-demo/sessions/:sessionId/generate', async (req, res) => {
  if (!demoModeOnly(res)) return;
  try {
    const story = clean(req.body?.story, 12000);
    if (!story) throw new Error('Business/API requirement is required.');
    const target = normalizeTarget(req.body?.target || {});
    const operations = withDemoIds(Array.isArray(req.body?.operations) ? req.body.operations : []);
    if (!operations.length) throw new Error('Select at least one REST operation.');

    const modelTier = normalizeProfile(req.body?.aiModelTier || process.env.AI_MODEL_DEFAULT || 'strong');
    const generated = await generateRestTestCases({ story, operations, modelTier });
    const session = getSession(req.params.sessionId);
    session.state = 'AWAITING_APPROVAL';
    session.targetType = 'REST';
    session.story = story;
    session.targetUrl = target.baseUrl;
    session.environment = clean(req.body?.environment, 100) || 'Test';
    session.projectId = null;
    session.repositoryId = null;
    session.apiTargetId = target.id;
    session.apiTarget = target;
    session.apiOperationIds = operations.map((operation) => operation.id);
    session.apiOperations = operations;
    session.apiAuth = runtimeAuth(req.body?.apiAuth || { type: target.authType }, target, { requireSecret: false });
    session.aiModelTier = modelTier;
    session.pageDiscoveries = [];
    session.testCases = assessRestTestCases(generated.testCases.map((testCase) => ({ ...testCase, source: 'ai' })), operations);
    session.automationReadiness = readinessSummary(session.testCases);
    session.readinessValidated = true;
    session.failureAnalyses = [];

    res.json({
      ok: true,
      demoMode: true,
      feature: generated.feature || target.name,
      targetType: 'REST',
      target,
      operationCount: operations.length,
      testCases: session.testCases,
      automationReadiness: session.automationReadiness,
      readinessPending: false,
    });
  } catch (err) {
    res.status(400).json({ reply: err.message });
  }
});

router.post('/api/rest-demo/sessions/:sessionId/run', async (req, res) => {
  if (!demoModeOnly(res)) return;
  const session = getSession(req.params.sessionId);
  try {
    if (session.targetType !== 'REST') return res.status(409).json({ reply: 'This session is not a REST API test session.' });
    const target = normalizeTarget(session.apiTarget || { baseUrl: session.targetUrl, authType: session.apiAuth?.type || 'NONE' });
    const operations = Array.isArray(session.apiOperations) ? session.apiOperations : [];
    if (!operations.length) throw new Error('REST operation evidence is missing from this demo session. Regenerate the REST tests.');

    session.apiAuth = runtimeAuth(req.body?.apiAuth || session.apiAuth || { type: target.authType }, target, { requireSecret: true });
    session.testCases = assessRestTestCases(normalizeReviewedRestCases(req.body?.reviewedTestCases, session.testCases), operations);
    session.automationReadiness = readinessSummary(session.testCases);
    session.readinessValidated = true;

    const allIds = session.testCases.map((testCase) => testCase.id);
    const approved = (Array.isArray(req.body?.approvedIds) ? req.body.approvedIds : [])
      .map((value) => String(value).toUpperCase())
      .filter((id) => allIds.includes(id));
    if (!approved.length) return res.status(400).json({ reply: 'Select at least one reviewed REST test case.' });

    const selected = session.testCases.filter((testCase) => approved.includes(testCase.id));
    const blocked = selected.filter((testCase) => testCase.automationReadiness?.status !== READY);
    if (blocked.length) {
      return res.status(422).json({
        reply: 'One or more selected REST tests are not Automation Ready.',
        unsupportedTestCases: blocked,
        automationReadiness: session.automationReadiness,
      });
    }

    const generated = generateRestAutomation(selected);
    session.generatedScript = [{ ...generated, testCaseIds: approved }];
    session.approvedIds = approved;
    session.failureAnalyses = [];
    session.state = 'RUNNING';

    const execResult = await executeSingleGeneratedSpec(generated, {
      targetType: 'REST',
      baseUrl: session.targetUrl,
      apiAuth: session.apiAuth,
    });
    if (!execResult.ok || !execResult.summary) {
      session.state = 'AWAITING_APPROVAL';
      return res.status(500).json({ reply: `REST automation execution could not complete: ${execResult.error || 'unknown error'}` });
    }

    const summary = execResult.summary;
    const runNumber = (session.runHistory?.length || 0) + 1;
    const completedAt = new Date().toISOString();
    const deterministicFindings = (summary.tests || []).filter((test) => test.fail).map((test) => ({
      testCase: test.testCaseId,
      category: 'API_RESPONSE_MISMATCH',
      expected: (session.testCases.find((candidate) => candidate.id === test.testCaseId)?.expectedResults || []).join('; '),
      observed: test.err?.message || 'REST assertion failed.',
      aiRecommended: true,
    }));
    const historyEntry = {
      runNumber,
      completedAt,
      approvedIds: [...approved],
      summary,
      deterministicFindings,
      analysisStatus: summary.failed > 0 ? 'PENDING' : 'NOT_REQUIRED',
      failureAnalyses: [],
    };
    session.runHistory = [...(session.runHistory || []), historyEntry].slice(-20);
    session.lastResults = { execResult, summary, runNumber, deterministicFindings };
    session.artifacts = null;
    session.reportHtml = buildAnalyticsReport({
      sessionId: req.params.sessionId,
      story: session.story,
      targetUrl: session.targetUrl,
      environment: session.environment,
      summary,
      analyses: [],
      model: session.aiModelTier || 'strong',
    });
    session.state = 'DONE';

    res.json({
      ok: true,
      demoMode: true,
      reply: `REST run #${runNumber} complete: ${summary.total} tests, ${summary.passed} passed, ${summary.failed} failed.`,
      targetType: 'REST',
      runNumber,
      canRunAgain: true,
      summary,
      deterministicFindings,
      failureAnalyses: [],
      analysisPending: summary.failed > 0,
      analysisUrl: summary.failed > 0 ? '/api/test-results/analyze' : null,
      automationReadiness: session.automationReadiness,
      runtimePreflight: { status: 'PASSED', generationMode: generated.generationMode },
      reportUrl: `/api/reports/${encodeURIComponent(req.params.sessionId)}`,
      generatedFile: generated.fileName,
    });
  } catch (err) {
    session.state = session.state === 'RUNNING' ? 'AWAITING_APPROVAL' : session.state;
    res.status(500).json({ reply: err.message });
  }
});

module.exports = router;

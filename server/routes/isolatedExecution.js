const express = require('express');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const router = express.Router();

const { getSession } = require('../data/sessionStore');
const { READY } = require('../services/testCaseFeasibility');
const { validateGroundedScript } = require('../services/scriptValidator');
const { executeIsolatedSuite } = require('../services/isolatedSuiteRunner');
const { buildAnalyticsReport } = require('../services/reportGenerator');
const { publishExecutionEvent, subscribeExecutionEvents } = require('../services/executionEventBus');
const { assessRestTestCases, generateRestAutomation, readinessSummary: restReadinessSummary } = require('../services/restAutomationService');
const persistence = require('../services/persistenceService');

const TEST_ID_REGEX = /TC(?:\d{3}|-H\d{3})/i;
const TEST_ID_STRICT = /^TC(?:\d{3}|-H\d{3})$/;
const RUNNABLE_STATES = new Set(['AWAITING_APPROVAL', 'DONE']);
const AUTH_REQUIRED = String(process.env.AUTH_REQUIRED || 'false').toLowerCase() === 'true';
const ARTIFACT_ROOT = path.resolve(__dirname, '..', '..', 'automation-system', 'artifacts');

function qaManagerOnly(req, res, next) {
  if (!AUTH_REQUIRED) return next();
  const role = String(req.user?.role || '').toUpperCase();
  if (!req.user) return res.status(401).json({ reply: 'Authentication is required for test execution.' });
  if (!['QA', 'MANAGER'].includes(role)) return res.status(403).json({ reply: 'QA or MANAGER role is required for test execution.' });
  next();
}

function safeRunId(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80);
}

function clean(value, max = 1000) {
  return String(value ?? '').trim().slice(0, max);
}

function selectorFor(item) {
  if (!item) return '';
  if (item.selector) return String(item.selector);
  if (item.testId) return `[data-testid="${item.testId}"]`;
  if (item.id) return `#${item.id}`;
  if (item.name) return `[name="${item.name}"]`;
  return '';
}

function pagePath(page) {
  try {
    const url = new URL(page?.finalUrl || page?.url || '/');
    return `${url.pathname}${url.search}` || '/';
  } catch {
    return '/';
  }
}

function resolveLoginRuntime(pageDiscoveries = []) {
  const entries = [];
  for (const page of pageDiscoveries || []) {
    for (const item of page?.elements || []) entries.push({ page, item });
  }

  const byIdentity = (names) => entries.find(({ item }) =>
    names.includes(String(item?.testId || '').toLowerCase()) ||
    names.includes(String(item?.id || '').toLowerCase()) ||
    names.includes(String(item?.name || '').toLowerCase())
  );

  const usernameEntry = byIdentity(['username', 'user-name', 'login-username', 'email']) ||
    entries.find(({ item }) => /user.?name|email/i.test(String(item?.label || '')) && String(item?.type || '').toLowerCase() !== 'password');
  const passwordEntry = byIdentity(['password', 'login-password']) ||
    entries.find(({ item }) => String(item?.type || '').toLowerCase() === 'password');
  const submitEntry = byIdentity(['login-button', 'signin-button', 'sign-in-button', 'submit-login']) ||
    entries.find(({ item }) => /sign\s*in|log\s*in|login/i.test(String(item?.label || item?.text || '')) && ['button', 'submit'].includes(String(item?.type || '').toLowerCase()));

  const loginPage = usernameEntry?.page || passwordEntry?.page || submitEntry?.page || pageDiscoveries?.[0] || null;
  return {
    path: pagePath(loginPage),
    selectors: {
      username: selectorFor(usernameEntry?.item),
      password: selectorFor(passwordEntry?.item),
      submit: selectorFor(submitEntry?.item),
    },
  };
}

function normalizeReviewedRestCases(input, fallback = []) {
  if (!Array.isArray(input)) return fallback;
  const seen = new Set();
  return input.slice(0, 50).map((raw, index) => {
    let id = clean(raw?.id, 20).toUpperCase();
    if (!TEST_ID_STRICT.test(id) || seen.has(id)) id = `TC-H${String(index + 1).padStart(3, '0')}`;
    seen.add(id);
    return {
      ...raw,
      id,
      title: clean(raw?.title, 300),
      type: ['positive','negative','boundary','functional','custom'].includes(String(raw?.type || '').toLowerCase()) ? String(raw.type).toLowerCase() : 'functional',
      priority: ['low','medium','high'].includes(String(raw?.priority || '').toLowerCase()) ? String(raw.priority).toLowerCase() : 'medium',
      preconditions: Array.isArray(raw?.preconditions) ? raw.preconditions.slice(0, 20).map((value) => clean(value, 500)) : [],
      testData: raw?.testData && typeof raw.testData === 'object' && !Array.isArray(raw.testData) ? raw.testData : {},
      steps: Array.isArray(raw?.steps) ? raw.steps.slice(0, 30) : [],
      expectedResults: Array.isArray(raw?.expectedResults) ? raw.expectedResults.slice(0, 20).map((value) => clean(value, 700)) : [],
      apiRequest: raw?.apiRequest && typeof raw.apiRequest === 'object' ? raw.apiRequest : null,
      apiAssertions: Array.isArray(raw?.apiAssertions) ? raw.apiAssertions.slice(0, 30) : [],
      source: raw?.source || 'ai-reviewed',
    };
  }).filter((testCase) => testCase.title && testCase.apiRequest);
}

function normalizeRuntimeRestAuth(input = {}, fallback = {}) {
  const type = String(input?.type || fallback?.type || 'NONE').toUpperCase();
  if (!['NONE','BASIC','BEARER','API_KEY_HEADER'].includes(type)) throw new Error(`Unsupported REST authentication type: ${type}.`);
  const auth = {
    type,
    username: type === 'BASIC' ? String(input?.username ?? fallback?.username ?? '') : '',
    secret: type === 'NONE' ? '' : String(input?.secret ?? fallback?.secret ?? ''),
    headerName: type === 'API_KEY_HEADER' ? String(input?.headerName ?? fallback?.headerName ?? '') : '',
  };
  if (type !== 'NONE' && !auth.secret) throw new Error('REST authentication secret is required for execution.');
  if (type === 'BASIC' && !auth.username) throw new Error('REST basic-auth username is required for execution.');
  if (type === 'API_KEY_HEADER' && !auth.headerName) throw new Error('REST API-key header name is required for execution.');
  return auth;
}

function evidenceUrls(summary, sessionId, artifacts) {
  const encodedSession = encodeURIComponent(sessionId);
  return {
    ...summary,
    tests: (summary?.tests || []).map((test) => {
      const testCaseId = test.testCaseId || String(test.title || '').match(TEST_ID_REGEX)?.[0] || null;
      const hasScreenshot = Boolean(testCaseId && artifacts?.screenshotsByTestCase?.[testCaseId]);
      const hasVideo = Boolean(testCaseId && artifacts?.videosByTestCase?.[testCaseId]);
      return {
        ...test,
        evidence: {
          ...(test.evidence || {}),
          screenshotAvailable: hasScreenshot,
          videoAvailable: hasVideo,
          screenshotUrl: hasScreenshot ? `/api/artifacts/${encodedSession}/screenshot/${encodeURIComponent(testCaseId)}` : null,
          videoUrl: hasVideo ? `/api/artifacts/${encodedSession}/video/${encodeURIComponent(testCaseId)}` : null,
        },
      };
    }),
  };
}

function deterministicFindings(session, summary) {
  const rest = String(session.targetType || 'WEB').toUpperCase() === 'REST';
  return (summary.tests || [])
    .filter((test) => test.fail)
    .map((test) => {
      const testCaseId = test.testCaseId || String(test.title || '').match(TEST_ID_REGEX)?.[0] || null;
      const testCase = (session.testCases || []).find((item) => item.id === testCaseId) || null;
      return {
        testCase: testCaseId,
        category: rest ? 'API_RESPONSE_MISMATCH' : 'ASSERTION_FAILURE',
        expected: Array.isArray(testCase?.expectedResults) ? testCase.expectedResults.join('; ') : '',
        observed: test.err?.message || (rest ? 'The deterministic REST assertion failed.' : 'The deterministic browser test failed.'),
        failedAssertion: null,
        aiRecommended: true,
      };
    });
}

function safeArtifactPath(candidate) {
  if (!candidate) return null;
  const resolved = path.resolve(candidate);
  if (resolved !== ARTIFACT_ROOT && !resolved.startsWith(`${ARTIFACT_ROOT}${path.sep}`)) return null;
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return null;
  return resolved;
}

function sendEvidence(kind) {
  return (req, res) => {
    const session = getSession(req.params.sessionId || 'default');
    const testCaseId = String(req.params.testCaseId || '').toUpperCase();
    const map = kind === 'video' ? session.artifacts?.videosByTestCase : session.artifacts?.screenshotsByTestCase;
    const filePath = safeArtifactPath(map?.[testCaseId]);
    if (!filePath) return res.status(404).json({ reply: `${kind === 'video' ? 'Video' : 'Screenshot'} evidence is not available for ${testCaseId}.` });
    return res.sendFile(filePath);
  };
}

async function persistCompletedRun(sessionId, session, userId) {
  if (!persistence.enabled()) return;
  try {
    await persistence.persistSession(sessionId, session, {
      projectId: session.projectId,
      repositoryId: session.repositoryId,
      userId: userId || session.createdBy || null,
    });
    await persistence.persistTestCases(sessionId, session.testCases || []);
    await persistence.persistRun({
      sessionId,
      session,
      runNumber: session.lastResults?.runNumber,
      summary: session.lastResults?.summary,
      approvedIds: session.approvedIds || [],
      userId: userId || session.createdBy || null,
    });
  } catch (err) {
    console.error('[isolated-execution] persistence failed', err);
  }
}

function publishProgress(sessionId, session, type, payload = {}) {
  const event = publishExecutionEvent(sessionId, type, payload);
  session.executionProgress = {
    ...(session.executionProgress || {}),
    ...payload,
    type,
    at: event.at,
  };
  return event;
}

router.get('/api/artifacts/:sessionId/screenshot/:testCaseId', qaManagerOnly, sendEvidence('screenshot'));
router.get('/api/artifacts/:sessionId/video/:testCaseId', qaManagerOnly, sendEvidence('video'));

router.get('/api/test-runs/events/:sessionId', qaManagerOnly, (req, res) => {
  const sessionId = String(req.params.sessionId || 'default');
  const session = getSession(sessionId);

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.write('retry: 5000\n\n');

  const send = (event) => {
    if (res.writableEnded) return;
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    if (event.type === 'RUN_COMPLETED' || event.type === 'RUN_FAILED') {
      setTimeout(() => {
        if (!res.writableEnded) res.end();
      }, 150);
    }
  };

  send({
    type: 'SNAPSHOT',
    at: new Date().toISOString(),
    ...(session.executionProgress || {
      status: session.state === 'RUNNING' ? 'RUNNING' : 'IDLE',
      total: 0,
      completed: 0,
      passed: 0,
      failed: 0,
      tests: [],
    }),
  });

  const unsubscribe = subscribeExecutionEvents(sessionId, send);
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(`: heartbeat ${Date.now()}\n\n`);
  }, 15000);

  const close = () => {
    clearInterval(heartbeat);
    unsubscribe();
  };
  req.on('close', close);
  res.on('close', close);
});

router.post('/api/test-runs/start', qaManagerOnly, async (req, res) => {
  const {
    sessionId = 'default',
    approvedIds = [],
    reviewedTestCases = null,
    apiAuth = null,
  } = req.body || {};
  const session = getSession(sessionId);
  const userId = req.user?.sub || session.createdBy || null;

  try {
    if (!RUNNABLE_STATES.has(session.state)) {
      throw new Error(session.state === 'RUNNING'
        ? 'Automation is already running for this session.'
        : 'Generate and review test cases before starting execution.');
    }
    if (!session.readinessValidated) {
      return res.status(409).json({
        reply: 'Automation readiness is still being checked. Run Approved Tests is locked until readiness validation completes.',
        readinessPending: true,
      });
    }

    const targetType = String(session.targetType || 'WEB').toUpperCase() === 'REST' ? 'REST' : 'WEB';
    if (targetType === 'REST') {
      const operations = Array.isArray(session.apiOperations) ? session.apiOperations : [];
      if (!operations.length) throw new Error('REST session has no grounded API operations.');
      session.testCases = assessRestTestCases(normalizeReviewedRestCases(reviewedTestCases, session.testCases), operations);
      session.automationReadiness = restReadinessSummary(session.testCases);
      session.readinessValidated = true;
      session.apiAuth = normalizeRuntimeRestAuth(apiAuth || {}, session.apiAuth || {});
    }

    const approvedSet = new Set((Array.isArray(approvedIds) ? approvedIds : []).map((id) => String(id).toUpperCase()));
    const approvedTestCases = (session.testCases || []).filter((testCase) => approvedSet.has(String(testCase.id).toUpperCase()));
    if (!approvedTestCases.length) throw new Error('Select at least one reviewed test case to execute.');

    const blocked = approvedTestCases.filter((testCase) => testCase.automationReadiness?.status !== READY);
    if (blocked.length) {
      return res.status(422).json({
        reply: 'One or more selected test cases are not Automation Ready.',
        unsupportedTestCases: blocked.map((testCase) => ({
          id: testCase.id,
          title: testCase.title,
          automationReadiness: testCase.automationReadiness,
        })),
      });
    }

    let executionContext;
    let generateAutomation = null;
    let validateGenerated = null;
    let runnerOptions = null;

    if (targetType === 'REST') {
      executionContext = {
        targetType: 'REST',
        baseUrl: session.targetUrl,
        apiAuth: session.apiAuth,
      };
      generateAutomation = (testCase) => generateRestAutomation([testCase]);
      runnerOptions = {
        headed: false,
        demoStepDelayMs: 0,
        screenshotEachTest: false,
        screenshotOnRunFailure: false,
        completionPauseMs: 0,
        video: false,
      };
    } else {
      const base = new URL(session.targetUrl);
      const hasCredentials = Boolean(session.credentials?.username && session.credentials?.password);
      const loginRuntime = resolveLoginRuntime(session.pageDiscoveries || []);
      executionContext = {
        baseUrl: `${base.protocol}//${base.host}`,
        hasCredentials,
        credentials: session.credentials,
        loginPath: loginRuntime.path,
        loginSelectors: loginRuntime.selectors,
      };
      validateGenerated = (generated, testCase) => validateGroundedScript(generated.script, {
        approvedTestCases: [testCase],
        pageDiscoveries: session.pageDiscoveries || [],
        hasCredentials,
        loginSelectors: loginRuntime.selectors,
        frameworkOwnedSelectors: ['body'],
      });
    }

    const runNumber = (session.runHistory?.length || 0) + 1;
    const suiteRunId = safeRunId(`suite-${runNumber}-${Date.now()}-${randomUUID().slice(0, 6)}`);
    session.approvedIds = approvedTestCases.map((testCase) => testCase.id);
    session.failureAnalyses = [];
    session.state = 'RUNNING';
    const screenshotEachTest = targetType === 'WEB' && String(process.env.AUTOMATION_SCREENSHOT_EACH_TEST ?? 'true').toLowerCase() !== 'false';
    const completionPauseMs = targetType === 'WEB'
      ? Math.max(0, Math.min(Number(process.env.AUTOMATION_TEST_COMPLETION_PAUSE_MS || 5000), 30000))
      : 0;
    session.executionProgress = {
      runId: suiteRunId,
      runNumber,
      status: 'STARTING',
      targetType,
      total: approvedTestCases.length,
      completed: 0,
      passed: 0,
      failed: 0,
      tests: [],
      executionMode: 'isolated-per-test',
      screenshotEachTest,
      completionPauseMs,
    };

    res.status(202).json({
      ok: true,
      accepted: true,
      runId: suiteRunId,
      runNumber,
      targetType,
      total: approvedTestCases.length,
      executionMode: 'isolated-per-test',
      eventUrl: `/api/test-runs/events/${encodeURIComponent(sessionId)}`,
      completionPauseMs,
      screenshotEachTest,
    });

    setImmediate(async () => {
      try {
        const result = await executeIsolatedSuite({
          testCases: approvedTestCases,
          executionContext,
          suiteRunId,
          generateAutomation,
          validateGenerated,
          runnerOptions,
          onEvent: (type, payload) => {
            if (type === 'RUN_COMPLETED') {
              session.executionProgress = {
                ...(session.executionProgress || {}),
                ...payload,
                targetType,
                status: 'FINALIZING',
                type: 'RUN_FINALIZING',
              };
              publishExecutionEvent(sessionId, 'RUN_FINALIZING', session.executionProgress);
              return;
            }
            publishProgress(sessionId, session, type, { ...payload, targetType });
          },
        });

        session.artifacts = result.artifacts || null;
        const summary = evidenceUrls({ ...result.summary, targetType }, sessionId, session.artifacts);
        const findings = deterministicFindings(session, summary);
        const completedAt = new Date().toISOString();
        const historyEntry = {
          runNumber,
          completedAt,
          approvedIds: [...session.approvedIds],
          summary,
          deterministicFindings: findings,
          analysisStatus: summary.failed > 0 ? 'PENDING' : 'NOT_REQUIRED',
          failureAnalyses: [],
        };

        session.runHistory = [...(session.runHistory || []), historyEntry].slice(-20);
        session.lastResults = {
          execResult: result,
          summary,
          runNumber,
          deterministicFindings: findings,
        };
        session.reportHtml = buildAnalyticsReport({
          sessionId,
          story: session.story,
          targetUrl: session.targetUrl,
          environment: session.environment,
          summary,
          analyses: [],
          model: session.aiModelTier || 'strong',
        });
        session.state = 'DONE';
        session.executionProgress = {
          ...(session.executionProgress || {}),
          runId: suiteRunId,
          runNumber,
          targetType,
          status: 'DONE',
          total: summary.total,
          completed: summary.total,
          passed: summary.passed,
          failed: summary.failed,
          tests: summary.tests,
          complete: true,
          reportUrl: `/api/reports/${encodeURIComponent(sessionId)}`,
          finalCleanup: result.finalCleanup,
        };

        await persistCompletedRun(sessionId, session, userId);
        publishExecutionEvent(sessionId, 'RUN_COMPLETED', session.executionProgress);
        console.log(`[isolated-execution] ${targetType} run #${runNumber} completed: ${summary.passed} passed, ${summary.failed} failed; owned Chromium cleanup=${result.finalCleanup?.verifiedGone ? 'verified' : 'warning'}.`);
      } catch (err) {
        session.state = 'AWAITING_APPROVAL';
        session.executionProgress = {
          ...(session.executionProgress || {}),
          targetType,
          status: 'FAILED',
          complete: true,
          error: err.message || String(err),
        };
        publishExecutionEvent(sessionId, 'RUN_FAILED', session.executionProgress);
        console.error('[isolated-execution]', err);
      }
    });
  } catch (err) {
    return res.status(422).json({ ok: false, reply: err.message });
  }
});

router.get('/api/test-runs/result/:sessionId', qaManagerOnly, (req, res) => {
  const session = getSession(req.params.sessionId || 'default');
  if (!session.lastResults?.summary) {
    return res.status(404).json({ ok: false, reply: 'No completed run result is available for this session.' });
  }
  return res.json({
    ok: true,
    runNumber: session.lastResults.runNumber,
    summary: session.lastResults.summary,
    deterministicFindings: session.lastResults.deterministicFindings || [],
    failureAnalyses: session.failureAnalyses || [],
    analysisPending: Number(session.lastResults.summary.failed || 0) > 0,
    reportUrl: `/api/reports/${encodeURIComponent(req.params.sessionId || 'default')}`,
    executionMode: session.lastResults.summary.executionMode || 'isolated-per-test',
    targetType: String(session.targetType || 'WEB').toUpperCase() === 'REST' ? 'REST' : 'WEB',
  });
});

module.exports = router;

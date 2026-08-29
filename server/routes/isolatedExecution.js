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
const persistence = require('../services/persistenceService');

const TEST_ID_REGEX = /TC(?:\d{3}|-H\d{3})/i;
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
  return (summary.tests || [])
    .filter((test) => test.fail)
    .map((test) => {
      const testCaseId = test.testCaseId || String(test.title || '').match(TEST_ID_REGEX)?.[0] || null;
      const testCase = (session.testCases || []).find((item) => item.id === testCaseId) || null;
      return {
        testCase: testCaseId,
        category: 'ASSERTION_FAILURE',
        expected: Array.isArray(testCase?.expectedResults) ? testCase.expectedResults.join('; ') : '',
        observed: test.err?.message || 'The deterministic browser test failed.',
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

    const base = new URL(session.targetUrl);
    const hasCredentials = Boolean(session.credentials?.username && session.credentials?.password);
    const loginRuntime = resolveLoginRuntime(session.pageDiscoveries || []);
    const executionContext = {
      baseUrl: `${base.protocol}//${base.host}`,
      hasCredentials,
      credentials: session.credentials,
      loginPath: loginRuntime.path,
      loginSelectors: loginRuntime.selectors,
    };

    const runNumber = (session.runHistory?.length || 0) + 1;
    const suiteRunId = safeRunId(`suite-${runNumber}-${Date.now()}-${randomUUID().slice(0, 6)}`);
    session.approvedIds = approvedTestCases.map((testCase) => testCase.id);
    session.failureAnalyses = [];
    session.state = 'RUNNING';
    session.executionProgress = {
      runId: suiteRunId,
      runNumber,
      status: 'STARTING',
      total: approvedTestCases.length,
      completed: 0,
      passed: 0,
      failed: 0,
      tests: [],
      executionMode: 'isolated-per-test',
      screenshotEachTest: String(process.env.AUTOMATION_SCREENSHOT_EACH_TEST ?? 'true').toLowerCase() !== 'false',
      completionPauseMs: Math.max(0, Math.min(Number(process.env.AUTOMATION_TEST_COMPLETION_PAUSE_MS || 5000), 30000)),
    };

    res.status(202).json({
      ok: true,
      accepted: true,
      runId: suiteRunId,
      runNumber,
      total: approvedTestCases.length,
      executionMode: 'isolated-per-test',
      eventUrl: `/api/test-runs/events/${encodeURIComponent(sessionId)}`,
      completionPauseMs: session.executionProgress.completionPauseMs,
    });

    setImmediate(async () => {
      try {
        const result = await executeIsolatedSuite({
          testCases: approvedTestCases,
          executionContext,
          suiteRunId,
          validateGenerated: (generated, testCase) => validateGroundedScript(generated.script, {
            approvedTestCases: [testCase],
            pageDiscoveries: session.pageDiscoveries || [],
            hasCredentials,
            loginSelectors: loginRuntime.selectors,
            frameworkOwnedSelectors: ['body'],
          }),
          onEvent: (type, payload) => {
            if (type === 'RUN_COMPLETED') {
              session.executionProgress = {
                ...(session.executionProgress || {}),
                ...payload,
                status: 'FINALIZING',
                type: 'RUN_FINALIZING',
              };
              publishExecutionEvent(sessionId, 'RUN_FINALIZING', session.executionProgress);
              return;
            }
            publishProgress(sessionId, session, type, payload);
          },
        });

        session.artifacts = result.artifacts || null;
        const summary = evidenceUrls(result.summary, sessionId, session.artifacts);
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
        console.log(`[isolated-execution] Run #${runNumber} completed: ${summary.passed} passed, ${summary.failed} failed; final Chromium cleanup=${result.finalCleanup?.verifiedGone ? 'verified' : 'warning'}.`);
      } catch (err) {
        session.state = 'AWAITING_APPROVAL';
        session.executionProgress = {
          ...(session.executionProgress || {}),
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
  });
});

module.exports = router;

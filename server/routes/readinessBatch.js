const express = require('express');
const router = express.Router();

const { getSession } = require('../data/sessionStore');
const { assessTestCases, readinessSummary } = require('../services/testCaseFeasibility');
const { normalizeTestCategory } = require('../services/testCategories');

const DEFAULT_BATCH_SIZE = 2;
const MAX_BATCH_SIZE = 50;

function cleanString(value, max = 1000) {
  return String(value ?? '').trim().slice(0, max);
}

function normalizeBatchSize(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_BATCH_SIZE;
  return Math.max(1, Math.min(MAX_BATCH_SIZE, parsed));
}

function cookieValue(req, name) {
  const raw = String(req.headers.cookie || '');
  for (const part of raw.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function requestedBatchSize(req) {
  return normalizeBatchSize(
    req.body?.batchSize ??
    cookieValue(req, 'aiTestPilotReadinessBatchSize') ??
    process.env.READINESS_BATCH_SIZE ??
    DEFAULT_BATCH_SIZE
  );
}

function normalizeTestCase(raw, fallbackId = 'TC-H001') {
  const testCase = raw && typeof raw === 'object' ? raw : {};
  const rawId = cleanString(testCase.id, 20);
  const id = /^TC(?:\d{3}|-H\d{3})$/i.test(rawId) ? rawId.toUpperCase() : fallbackId;
  const type = cleanString(testCase.type, 30).toLowerCase();
  const priority = cleanString(testCase.priority, 30).toLowerCase();

  return {
    id,
    title: cleanString(testCase.title, 300),
    type: ['positive', 'negative', 'boundary', 'functional', 'custom'].includes(type) ? type : 'functional',
    testCategory: normalizeTestCategory(testCase.testCategory || testCase.category),
    priority: ['low', 'medium', 'high'].includes(priority) ? priority : 'medium',
    preconditions: Array.isArray(testCase.preconditions)
      ? testCase.preconditions.map((value) => cleanString(value, 500)).filter(Boolean).slice(0, 20)
      : [],
    testData: testCase.testData && typeof testCase.testData === 'object' && !Array.isArray(testCase.testData)
      ? testCase.testData
      : {},
    steps: Array.isArray(testCase.steps)
      ? testCase.steps.map((step) => ({
          action: cleanString(step?.action ?? step, 500),
          target: typeof step === 'object' ? cleanString(step?.target, 300) : '',
          value: typeof step === 'object' && step?.value !== null && step?.value !== undefined
            ? cleanString(step.value, 300)
            : null,
        })).filter((step) => step.action || step.target).slice(0, 30)
      : [],
    expectedResults: Array.isArray(testCase.expectedResults)
      ? testCase.expectedResults.map((value) => cleanString(value, 600)).filter(Boolean).slice(0, 20)
      : [],
    source: cleanString(testCase.source, 40) || 'human',
    createdBy: cleanString(testCase.createdBy, 40) || null,
    repairHistory: Array.isArray(testCase.repairHistory) ? testCase.repairHistory.slice(-10) : [],
  };
}

function updateCredentials(session, credentials) {
  if (!credentials || typeof credentials !== 'object') return;
  session.credentials = {
    username: String(credentials.username || ''),
    password: String(credentials.password || ''),
  };
}

function context(session) {
  return {
    pageDiscoveries: session.pageDiscoveries || [],
    hasCredentials: Boolean(session.credentials?.username && session.credentials?.password),
  };
}

function mergeAssessedCases(sessionCases = [], assessed = []) {
  const byId = new Map(assessed.map((tc) => [String(tc?.id || '').toUpperCase(), tc]));
  return (sessionCases || []).map((current) => {
    const replacement = byId.get(String(current?.id || '').toUpperCase());
    return replacement
      ? { ...current, ...replacement, automationReadiness: replacement.automationReadiness }
      : current;
  });
}

function yieldToEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

router.post('/api/test-cases/revalidate', async (req, res) => {
  const {
    sessionId = 'default',
    testCases = null,
    credentials = null,
  } = req.body || {};

  const session = getSession(sessionId);

  try {
    if (session.state === 'IDLE' || !session.story) {
      throw new Error('Generate the initial story-driven test cases before readiness validation.');
    }

    updateCredentials(session, credentials);
    session.readinessValidated = false;

    const sourceCases = Array.isArray(testCases) ? testCases : session.testCases;
    if (!Array.isArray(sourceCases) || !sourceCases.length) {
      throw new Error('At least one test case is required for readiness validation.');
    }

    const normalized = sourceCases.map((tc, index) =>
      normalizeTestCase(tc, `TC-H${String(index + 1).padStart(3, '0')}`)
    );

    const batchSize = requestedBatchSize(req);
    const batchCount = Math.ceil(normalized.length / batchSize);
    const assessedAll = [];

    for (let index = 0; index < batchCount; index += 1) {
      const start = index * batchSize;
      const batch = normalized.slice(start, start + batchSize);
      const assessed = assessTestCases(batch, context(session));
      assessedAll.push(...assessed);

      session.testCases = mergeAssessedCases(session.testCases || [], assessed);
      session.automationReadiness = readinessSummary(session.testCases);

      console.log(
        `[readiness-batch] session=${sessionId} batch=${index + 1}/${batchCount} size=${batch.length} ` +
        `ready=${session.automationReadiness.ready}/${session.automationReadiness.total}`
      );

      if (index + 1 < batchCount) await yieldToEventLoop();
    }

    session.readinessValidated = session.testCases.length > 0 &&
      session.testCases.every((tc) => Boolean(tc?.automationReadiness));

    console.log(
      `[readiness] validated ${assessedAll.length} case(s) in ${batchCount} batch(es) of up to ${batchSize}; ` +
      `complete=${session.readinessValidated ? 'yes' : 'no'} ` +
      `ready=${session.automationReadiness.ready}/${session.automationReadiness.total}`
    );

    return res.json({
      ok: true,
      testCases: assessedAll,
      automationReadiness: session.automationReadiness,
      readinessPending: !session.readinessValidated,
      batching: {
        batchSize,
        batchCount,
        total: assessedAll.length,
      },
    });
  } catch (err) {
    session.readinessValidated = false;
    return res.status(422).json({
      ok: false,
      reply: err.message,
      readinessPending: true,
    });
  }
});

module.exports = router;

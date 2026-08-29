const express = require('express');
const router = express.Router();

const { getSession } = require('../data/sessionStore');
const { assessTestCases, readinessSummary } = require('../services/testCaseFeasibility');
const { normalizeTestCategory } = require('../services/testCategories');

function cleanString(value, max = 1000) {
  return String(value ?? '').trim().slice(0, max);
}

function normalizePositiveInt(value, fallback = 1, max = 10000) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(max, parsed);
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
  const seen = new Set();
  const merged = (sessionCases || []).map((current) => {
    const id = String(current?.id || '').toUpperCase();
    const replacement = byId.get(id);
    if (!replacement) return current;
    seen.add(id);
    return { ...current, ...replacement, automationReadiness: replacement.automationReadiness };
  });

  for (const candidate of assessed) {
    const id = String(candidate?.id || '').toUpperCase();
    if (!seen.has(id) && !merged.some((item) => String(item?.id || '').toUpperCase() === id)) merged.push(candidate);
  }
  return merged;
}

router.post('/api/test-cases/revalidate', async (req, res) => {
  const {
    sessionId = 'default',
    testCases = null,
    credentials = null,
    batchIndex = 1,
    batchCount = 1,
    totalCases = null,
  } = req.body || {};

  const session = getSession(sessionId);

  try {
    if (session.state === 'IDLE' || !session.story) {
      throw new Error('Generate the initial story-driven test cases before readiness validation.');
    }

    updateCredentials(session, credentials);
    session.readinessValidated = false;

    if (!Array.isArray(testCases) || !testCases.length) {
      throw new Error('At least one test case is required for this readiness batch.');
    }

    const normalized = testCases.map((tc, index) =>
      normalizeTestCase(tc, `TC-H${String(index + 1).padStart(3, '0')}`)
    );
    const assessed = assessTestCases(normalized, context(session));

    session.testCases = mergeAssessedCases(session.testCases || [], assessed);
    session.automationReadiness = readinessSummary(session.testCases);

    const normalizedBatchIndex = normalizePositiveInt(batchIndex, 1);
    const normalizedBatchCount = Math.max(normalizedBatchIndex, normalizePositiveInt(batchCount, 1));
    const expectedTotal = normalizePositiveInt(totalCases, session.testCases.length || assessed.length);
    const isFinalBatch = normalizedBatchIndex >= normalizedBatchCount;
    const allHaveReadiness = session.testCases.length >= expectedTotal &&
      session.testCases.slice(0, expectedTotal).every((tc) => Boolean(tc?.automationReadiness));

    session.readinessValidated = isFinalBatch && allHaveReadiness;

    console.log(
      `[readiness-batch] session=${sessionId} batch=${normalizedBatchIndex}/${normalizedBatchCount} ` +
      `size=${assessed.length} ready=${session.automationReadiness.ready}/${session.automationReadiness.total} ` +
      `complete=${session.readinessValidated ? 'yes' : 'no'}`
    );

    return res.json({
      ok: true,
      testCases: assessed,
      automationReadiness: session.automationReadiness,
      readinessPending: !session.readinessValidated,
      batching: {
        batchIndex: normalizedBatchIndex,
        batchCount: normalizedBatchCount,
        batchSize: assessed.length,
        totalCases: expectedTotal,
        complete: session.readinessValidated,
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

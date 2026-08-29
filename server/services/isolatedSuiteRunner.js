const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const { executeSingleGeneratedSpec } = require('./singleSpecRunner');
const { cleanupAutomationBrowsers } = require('./browserProcessCleanup');
const { generateDeterministicAutomation } = require('./deterministicAutomationGenerator');

const ARTIFACT_DIR = path.join(__dirname, '..', '..', 'automation-system', 'artifacts');
const ISOLATED_EVIDENCE_DIR = path.join(ARTIFACT_DIR, 'isolated');

function safeToken(value, fallback = 'item') {
  const safe = String(value || '')
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return safe || fallback;
}

function copyEvidence(sourcePath, destinationPath) {
  if (!sourcePath || !fs.existsSync(sourcePath)) return null;
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.copyFileSync(sourcePath, destinationPath);
  return path.resolve(destinationPath);
}

function syntheticFailure(testCase, message, durationMs) {
  return {
    title: `${testCase.id} — ${testCase.title}`,
    testCaseId: testCase.id,
    pass: false,
    fail: true,
    state: 'failed',
    durationMs,
    err: { message: String(message || 'Automation execution failed before a result was produced.') },
    evidence: {},
  };
}

async function executeIsolatedSuite({
  testCases = [],
  executionContext = {},
  validateGenerated = null,
  onEvent = null,
  suiteRunId = null,
} = {}) {
  if (!Array.isArray(testCases) || !testCases.length) {
    throw new Error('At least one Automation Ready test case is required for isolated execution.');
  }

  const runId = safeToken(suiteRunId || `suite-${Date.now()}-${randomUUID().slice(0, 8)}`, 'suite');
  const evidenceDir = path.join(ISOLATED_EVIDENCE_DIR, runId);
  fs.rmSync(evidenceDir, { recursive: true, force: true });
  fs.mkdirSync(evidenceDir, { recursive: true });

  const suiteStartedAt = Date.now();
  const tests = [];
  const screenshotsByTestCase = {};
  const videosByTestCase = {};
  const ownedRunIds = [];
  const cleanupResults = [];
  let browser = process.env.AUTOMATION_BROWSER || 'chrome';

  const emit = (type, payload = {}) => {
    if (typeof onEvent === 'function') {
      onEvent(type, {
        runId,
        total: testCases.length,
        completed: tests.length,
        passed: tests.filter((test) => test.pass).length,
        failed: tests.filter((test) => test.fail).length,
        tests: [...tests],
        ...payload,
      });
    }
  };

  emit('RUN_STARTED', {
    status: 'RUNNING',
    currentIndex: 0,
    currentTestCaseId: null,
  });

  for (let index = 0; index < testCases.length; index += 1) {
    const testCase = testCases[index];
    const testStartedAt = Date.now();
    const generated = generateDeterministicAutomation([testCase]);

    if (typeof validateGenerated === 'function') {
      const validation = validateGenerated(generated, testCase);
      if (!validation?.valid) {
        const result = syntheticFailure(
          testCase,
          `Deterministic compiler validation failed: ${(validation?.errors || []).join(' | ')}`,
          Date.now() - testStartedAt
        );
        tests.push(result);
        emit('TEST_COMPLETED', {
          status: 'RUNNING',
          currentIndex: index + 1,
          currentTestCaseId: testCase.id,
          result,
          browserCleanup: { verifiedGone: true, skipped: true },
        });
        continue;
      }
    }

    emit('TEST_STARTED', {
      status: 'RUNNING',
      currentIndex: index + 1,
      currentTestCaseId: testCase.id,
      title: testCase.title,
    });

    const execResult = await executeSingleGeneratedSpec(generated, executionContext, {
      approvedIds: [testCase.id],
    });
    if (execResult?.runId) ownedRunIds.push(execResult.runId);

    browser = execResult?.summary?.browser || browser;
    let result = execResult?.summary?.tests?.[0] || null;
    if (!execResult?.ok || !result) {
      result = syntheticFailure(testCase, execResult?.error || 'Automation execution produced no test result.', Date.now() - testStartedAt);
    }

    const sourceScreenshot = execResult?.artifacts?.screenshotsByTestCase?.[testCase.id] || null;
    const copiedScreenshot = copyEvidence(
      sourceScreenshot,
      path.join(evidenceDir, `${safeToken(testCase.id, `TC-${index + 1}`)}.png`)
    );
    if (copiedScreenshot) {
      screenshotsByTestCase[testCase.id] = copiedScreenshot;
      result.evidence = {
        ...(result.evidence || {}),
        screenshotAvailable: true,
      };
    }

    const sourceVideo = execResult?.artifacts?.videosByTestCase?.[testCase.id] || null;
    if (sourceVideo && fs.existsSync(sourceVideo)) {
      const ext = path.extname(sourceVideo) || '.mp4';
      const copiedVideo = copyEvidence(sourceVideo, path.join(evidenceDir, `${safeToken(testCase.id)}${ext}`));
      if (copiedVideo) videosByTestCase[testCase.id] = copiedVideo;
    }

    const browserCleanup = execResult?.runId
      ? await cleanupAutomationBrowsers({
          runId: execResult.runId,
          reason: `post-test verification ${testCase.id}`,
          log: true,
          attempts: 4,
          verifyDelayMs: 350,
        })
      : { verifiedGone: true, skipped: true };
    cleanupResults.push({ testCaseId: testCase.id, runId: execResult?.runId || null, ...browserCleanup });

    tests.push(result);
    emit('TEST_COMPLETED', {
      status: 'RUNNING',
      currentIndex: index + 1,
      currentTestCaseId: testCase.id,
      result,
      screenshotAvailable: Boolean(copiedScreenshot),
      browserCleanup,
    });
  }

  const finalChecks = [];
  for (const ownedRunId of [...new Set(ownedRunIds)]) {
    finalChecks.push(await cleanupAutomationBrowsers({
      runId: ownedRunId,
      reason: `final suite verification ${runId}`,
      log: true,
      attempts: 5,
      verifyDelayMs: 400,
    }));
  }
  const finalCleanup = {
    verifiedGone: finalChecks.every((item) => item.verifiedGone !== false),
    checkedRunIds: [...new Set(ownedRunIds)],
    checks: finalChecks,
  };

  const passed = tests.filter((test) => test.pass).length;
  const failed = tests.filter((test) => test.fail).length;
  const summary = {
    total: tests.length,
    passed,
    failed,
    pending: 0,
    skipped: 0,
    durationMs: Date.now() - suiteStartedAt,
    browser,
    tests,
    forcedTeardown: !finalCleanup.verifiedGone,
    executionMode: 'isolated-per-test',
  };

  const artifacts = {
    sharedVideo: null,
    videosByTestCase,
    screenshotsByTestCase,
  };

  emit('RUN_COMPLETED', {
    status: 'DONE',
    currentIndex: testCases.length,
    currentTestCaseId: null,
    summary,
    finalCleanup,
    cleanupResults,
    complete: true,
  });

  return {
    ok: true,
    runId,
    summary,
    artifacts,
    finalCleanup,
    cleanupResults,
  };
}

module.exports = {
  executeIsolatedSuite,
};

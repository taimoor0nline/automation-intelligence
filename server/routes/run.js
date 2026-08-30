const express = require("express");
const router = express.Router();

const { getSession } = require("../data/sessionStore");
const qwen = require("../services/qwenClient");
const { validateGroundedScript } = require("../services/scriptValidator");
const { executeSingleGeneratedSpec } = require("../services/singleSpecRunner");
const { buildAnalyticsReport } = require("../services/reportGenerator");
const { assessTestCases, readinessSummary, READY } = require("../services/testCaseFeasibility");
const { generateDeterministicAutomation } = require("../services/deterministicAutomationGenerator");

const TEST_ID_REGEX = /^TC(?:\d{3}|-H\d{3})$/;
const TEST_ID_GLOBAL_REGEX = /TC(?:\d{3}|-H\d{3})/g;
const ALLOWED_TYPES = new Set(["positive", "negative", "boundary", "functional", "custom"]);
const ALLOWED_PRIORITIES = new Set(["low", "medium", "high"]);
const LOGIN_SCOPE_FORBIDDEN_ANALYSIS = /\b(feedback|website|url|age|rating|consent|product|category|checkout|payment|cart|profile)\b/i;
const RUNNABLE_STATES = new Set(["AWAITING_APPROVAL", "DONE"]);

function cleanString(value, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

function isLoginOnlyStory(story) {
  const text = String(story || "").toLowerCase();
  const login = /\b(login|log in|sign in|signin|authentication|authenticate)\b/.test(text);
  const other = /\b(feedback|profile|dashboard|registration|register|checkout|payment|order|search|cart)\b/.test(text);
  return login && !other;
}

function selectorFor(item) {
  if (!item) return "";
  if (item.selector) return String(item.selector);
  if (item.testId) return `[data-testid="${item.testId}"]`;
  if (item.id) return `#${item.id}`;
  if (item.name) return `[name="${item.name}"]`;
  return "";
}

function pagePath(page) {
  try {
    const url = new URL(page?.finalUrl || page?.url || "/");
    return `${url.pathname}${url.search}` || "/";
  } catch {
    return "/";
  }
}

function resolveLoginRuntime(pageDiscoveries = []) {
  const entries = [];
  for (const page of pageDiscoveries || []) {
    for (const item of page?.elements || []) entries.push({ page, item });
  }

  const byIdentity = (names) => entries.find(({ item }) =>
    names.includes(String(item?.testId || "").toLowerCase()) ||
    names.includes(String(item?.id || "").toLowerCase()) ||
    names.includes(String(item?.name || "").toLowerCase())
  );

  const usernameEntry = byIdentity(["username", "user-name", "login-username", "email"]) ||
    entries.find(({ item }) => /user.?name|email/i.test(String(item?.label || "")) && String(item?.type || "").toLowerCase() !== "password");
  const passwordEntry = byIdentity(["password", "login-password"]) ||
    entries.find(({ item }) => String(item?.type || "").toLowerCase() === "password");
  const submitEntry = byIdentity(["login-button", "signin-button", "sign-in-button", "submit-login"]) ||
    entries.find(({ item }) => /sign\s*in|log\s*in|login/i.test(String(item?.label || item?.text || "")) && ["button", "submit"].includes(String(item?.type || "").toLowerCase()));

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

function configuredActorRefs(session) {
  return Object.entries(session.actorCredentials || {})
    .filter(([, credentials]) => credentials?.username && credentials?.password)
    .map(([actorRef]) => actorRef);
}

function isPreExecutionAutomationFailure(test) {
  const message = String(test?.err?.message || "");
  return /runtime login credentials are not configured|runtime credentials are not configured for test actor|runtime login controls were not grounded|allowCypressEnv|returned a promise from a command|invalid automation command|command usage|script.*(?:syntax|validation)|failed before test execution|could not verify that this server is running|browser.*(?:failed|closed|crashed)|support file.*(?:error|failed)/i.test(message);
}

function automationFailureAnalysis(tc, test) {
  const expected = Array.isArray(tc.expectedResults) ? tc.expectedResults.join("; ") : "";
  const actual = test.err?.message || "The automation runtime failed before meaningful application validation completed.";
  return {
    testCase: tc.id,
    summary: "The test case was Automation Ready, but the automation runtime failed before meaningful application validation completed.",
    classification: "AUTOMATION_DEFECT",
    expected,
    actual,
    probableCause: "A runtime or framework implementation problem prevented the approved test from reaching meaningful application validation.",
    severity: "medium",
    confidence: 0.99,
  };
}

function failedAssertionFor(tc, test) {
  const assertions = tc?.automationReadiness?.automationPlan?.assertions || [];
  const message = String(test?.err?.message || "");
  if (/not to be empty|to not be empty|expected '' not to be empty/i.test(message)) {
    return assertions.find((item) => item.operation === "ASSERT_TEXT_NOT_EMPTY") || null;
  }
  if (/be visible|to be visible/i.test(message)) {
    return assertions.find((item) => item.operation === "ASSERT_VISIBLE") || null;
  }
  if (/url/i.test(message)) {
    return assertions.find((item) => item.operation === "ASSERT_URL_INCLUDES" || item.operation === "ASSERT_URL_NOT_INCLUDES") || null;
  }
  if (/hidden|not exist|not be visible/i.test(message)) {
    return assertions.find((item) => item.operation === "ASSERT_HIDDEN_OR_ABSENT") || null;
  }
  return assertions.length === 1 ? assertions[0] : null;
}

function describeObservedFailure(tc, test) {
  const raw = String(test?.err?.message || "Automation assertion failed");
  const assertion = failedAssertionFor(tc, test);
  if (!assertion) return raw;
  const target = assertion.selector || assertion.path || "the expected target";

  switch (assertion.operation) {
    case "ASSERT_TEXT_NOT_EMPTY":
      return `The deterministic test reached its assertion phase. Expected ${target} to contain non-empty validation text, but it remained empty until the assertion timed out. Runtime message: ${raw}`;
    case "ASSERT_VISIBLE":
      return `The deterministic test reached its assertion phase. Expected ${target} to be visible, but the visibility assertion failed. Runtime message: ${raw}`;
    case "ASSERT_HIDDEN_OR_ABSENT":
      return `The deterministic test reached its assertion phase. Expected ${target} to remain hidden or absent, but that assertion failed. Runtime message: ${raw}`;
    case "ASSERT_URL_INCLUDES":
      return `The deterministic test reached its assertion phase. Expected the current URL to include ${target}, but the URL assertion failed. Runtime message: ${raw}`;
    case "ASSERT_URL_NOT_INCLUDES":
      return `The deterministic test reached its assertion phase. Expected the current URL not to include ${target}, but the URL assertion failed. Runtime message: ${raw}`;
    default:
      return raw;
  }
}

function deterministicFinding(tc, test) {
  if (!test?.fail) return null;
  if (isPreExecutionAutomationFailure(test)) {
    return {
      testCase: tc.id,
      category: "AUTOMATION_RUNTIME_FAILURE",
      expected: Array.isArray(tc.expectedResults) ? tc.expectedResults.join("; ") : "",
      observed: test.err?.message || "Automation runtime failed before application validation.",
      aiRecommended: false,
    };
  }

  const assertion = failedAssertionFor(tc, test);
  const observed = describeObservedFailure(tc, test);
  return {
    testCase: tc.id,
    category: assertion ? "APPLICATION_BEHAVIOR_MISMATCH" : "ASSERTION_FAILURE",
    expected: Array.isArray(tc.expectedResults) ? tc.expectedResults.join("; ") : "",
    observed,
    failedAssertion: assertion || null,
    aiRecommended: !assertion,
  };
}

function analysisContainsOutOfScopeContent(analysis) {
  return [analysis?.summary, analysis?.expected, analysis?.actual, analysis?.probableCause]
    .filter(Boolean)
    .some((value) => LOGIN_SCOPE_FORBIDDEN_ANALYSIS.test(String(value)));
}

function constrainLoginAnalysis(analysis, tc, test) {
  if (!analysisContainsOutOfScopeContent(analysis)) return { testCase: tc.id, ...analysis };
  const actual = describeObservedFailure(tc, test);
  const expected = Array.isArray(tc.expectedResults) ? tc.expectedResults.join("; ") : "";
  const classification = analysis?.classification === "APPLICATION_DEFECT" ? "APPLICATION_DEFECT" : analysis?.classification || "UNKNOWN";
  return {
    testCase: tc.id,
    summary: classification === "APPLICATION_DEFECT"
      ? "The login negative test reached the application but did not observe the expected login rejection behavior."
      : "The login negative test failed, and the analysis has been constrained to the authentication scope defined by the business story.",
    classification,
    expected,
    actual,
    probableCause: classification === "APPLICATION_DEFECT"
      ? "The login validation or authentication rejection behavior may not match the expected result."
      : "The failure requires review within the login/authentication flow.",
    severity: analysis?.severity || "medium",
    confidence: Math.min(Number(analysis?.confidence) || 0.5, 0.85),
  };
}

function cloneCanonical(value) {
  return value && typeof value === "object" ? JSON.parse(JSON.stringify(value)) : null;
}

function normalizeReviewedTestCases(input, fallbackCases) {
  if (!Array.isArray(input)) return fallbackCases;
  const maxReviewed = Math.max(1, Math.min(Number(process.env.MAX_REVIEWED_TEST_CASES || 500) || 500, 1000));
  if (input.length > maxReviewed) throw new Error(`A maximum of ${maxReviewed} reviewed test cases is allowed.`);

  const seen = new Set();
  const normalized = [];
  input.forEach((raw, index) => {
    if (!raw || typeof raw !== "object") return;
    let id = cleanString(raw.id, 20).toUpperCase();
    if (!TEST_ID_REGEX.test(id) || seen.has(id)) id = `TC-H${String(index + 1).padStart(3, "0")}`;
    while (seen.has(id)) id = `TC-H${String(index + 2).padStart(3, "0")}`;

    const title = cleanString(raw.title, 300);
    if (!title) return;
    const typeCandidate = cleanString(raw.type, 30).toLowerCase();
    const priorityCandidate = cleanString(raw.priority, 30).toLowerCase();
    const steps = Array.isArray(raw.steps)
      ? raw.steps.slice(0, 100).map((step) => ({
          action: cleanString(step?.action ?? step, 500),
          target: typeof step === "object" ? cleanString(step?.target, 300) : "",
          value: typeof step === "object" && step?.value !== null && step?.value !== undefined ? cleanString(step.value, 500) : null,
        })).filter((step) => step.action || step.target)
      : [];
    const expectedResults = Array.isArray(raw.expectedResults)
      ? raw.expectedResults.slice(0, 100).map((value) => cleanString(value, 1000)).filter(Boolean)
      : [];
    const preconditions = Array.isArray(raw.preconditions)
      ? raw.preconditions.slice(0, 50).map((value) => cleanString(value, 500)).filter(Boolean)
      : [];
    const canonicalIr = cloneCanonical(raw.canonicalIr);

    normalized.push({
      id,
      title,
      type: ALLOWED_TYPES.has(typeCandidate) ? typeCandidate : "functional",
      customScenarioType: cleanString(raw.customScenarioType, 80) || null,
      testCategory: cleanString(raw.testCategory || raw.category, 80).toUpperCase() || "FUNCTIONAL",
      customCategory: cleanString(raw.customCategory, 80) || null,
      securitySubcategory: cleanString(raw.securitySubcategory, 80).toUpperCase() || null,
      severity: cleanString(raw.severity || raw.securitySeverity, 30).toUpperCase() || null,
      priority: ALLOWED_PRIORITIES.has(priorityCandidate) ? priorityCandidate : "medium",
      preconditions,
      testData: raw.testData && typeof raw.testData === "object" && !Array.isArray(raw.testData) ? raw.testData : {},
      steps,
      expectedResults,
      source: raw.source === "human" || id.startsWith("TC-H") ? (raw.source || "human") : (canonicalIr ? "ai-canonical-reviewed" : "ai-reviewed"),
      createdBy: raw.createdBy || null,
      repairHistory: Array.isArray(raw.repairHistory) ? raw.repairHistory.slice(-10) : [],
      canonicalIr,
      canonicalValidation: cloneCanonical(raw.canonicalValidation),
      cypressPreview: canonicalIr ? cleanString(raw.cypressPreview, 100000) : null,
      manualCypressSource: raw.manualCypressSource && typeof raw.manualCypressSource === "object" ? cloneCanonical(raw.manualCypressSource) : null,
    });
    seen.add(id);
  });

  if (!normalized.length) throw new Error("No valid reviewed test cases were supplied.");
  return normalized;
}

function addEvidenceUrls(summary, sessionId, artifacts) {
  if (!summary) return summary;
  const encodedSession = encodeURIComponent(sessionId);
  return {
    ...summary,
    tests: (summary.tests || []).map((test) => {
      if (!test.fail) return test;
      const testCaseId = test.testCaseId || String(test.title || "").match(TEST_ID_GLOBAL_REGEX)?.[0] || null;
      const hasVideo = Boolean(testCaseId && artifacts?.videosByTestCase?.[testCaseId]);
      const hasScreenshot = Boolean(testCaseId && artifacts?.screenshotsByTestCase?.[testCaseId]);
      return {
        ...test,
        evidence: {
          ...(test.evidence || {}),
          videoUrl: hasVideo ? `/api/artifacts/${encodedSession}/video/${encodeURIComponent(testCaseId)}` : null,
          screenshotUrl: hasScreenshot ? `/api/artifacts/${encodedSession}/screenshot/${encodeURIComponent(testCaseId)}` : null,
        },
      };
    }),
  };
}

function currentHistoryEntry(session) {
  const runNumber = session.lastResults?.runNumber;
  return (session.runHistory || []).find((item) => item.runNumber === runNumber) || null;
}

async function analyzeStoredFailures(session, modelTier) {
  const summary = session.lastResults?.summary;
  if (!summary) throw new Error("No completed automation results are available for analysis.");
  const loginOnly = isLoginOnlyStory(session.story);
  const failedTests = (summary.tests || []).filter((test) => test.fail);
  if (!failedTests.length) return [];

  return Promise.all(failedTests.map(async (test) => {
    const tcId = test.testCaseId || String(test.title || "").match(TEST_ID_GLOBAL_REGEX)?.[0];
    const tc = session.testCases.find((item) => item.id === tcId) || { id: tcId || "UNKNOWN", title: test.title, expectedResults: [] };
    if (isPreExecutionAutomationFailure(test)) return automationFailureAnalysis(tc, test);

    const expected = Array.isArray(tc.expectedResults) ? tc.expectedResults.join("; ") : "";
    const actual = describeObservedFailure(tc, test);
    const analysis = await qwen.analyzeFailure({ story: session.story, testCase: tc, expected, actual, modelTier });
    if (loginOnly) return constrainLoginAnalysis(analysis, tc, test);
    return { testCase: tc.id, ...analysis, actual: analysis.actual || actual };
  }));
}

router.post("/api/test-results/analyze", async (req, res) => {
  const { sessionId = "default" } = req.body || {};
  const session = getSession(sessionId);
  try {
    if (!session.lastResults?.summary) return res.status(409).json({ reply: "Run approved tests before requesting AI result analysis." });
    if (session.state === "RUNNING") return res.status(409).json({ reply: "Automation is still running. AI analysis is available only after browser execution completes." });

    const failedCount = Number(session.lastResults.summary.failed || 0);
    if (!failedCount) {
      return res.json({ ok: true, failureAnalyses: [], summary: session.lastResults.summary, analysisNeeded: false });
    }

    const modelTier = session.aiModelTier || "strong";
    console.log(`[result-analysis] Starting on-demand AI analysis for ${failedCount} failed test(s) using profile=${modelTier}.`);
    const analyses = await analyzeStoredFailures(session, modelTier);
    session.failureAnalyses = analyses;

    const history = currentHistoryEntry(session);
    if (history) {
      history.analysisStatus = "COMPLETED";
      history.failureAnalyses = analyses;
      history.analyzedAt = new Date().toISOString();
    }

    session.reportHtml = buildAnalyticsReport({
      sessionId,
      story: session.story,
      targetUrl: session.targetUrl,
      environment: session.environment,
      summary: session.lastResults.summary,
      analyses,
      model: modelTier,
    });
    console.log(`[result-analysis] Completed on-demand AI analysis for ${analyses.length} failed test(s).`);

    return res.json({
      ok: true,
      runNumber: session.lastResults.runNumber,
      failureAnalyses: analyses,
      summary: session.lastResults.summary,
      aiModelTier: modelTier,
      reportUrl: `/api/reports/${encodeURIComponent(sessionId)}`,
    });
  } catch (err) {
    console.error("[result-analysis]", err);
    return res.status(500).json({ reply: `AI result analysis could not complete: ${err.message}` });
  }
});

router.get("/api/test-results/history/:sessionId", (req, res) => {
  const session = getSession(req.params.sessionId || "default");
  return res.json({
    ok: true,
    runs: (session.runHistory || []).map((item) => ({
      runNumber: item.runNumber,
      completedAt: item.completedAt,
      approvedIds: item.approvedIds,
      total: item.summary?.total || 0,
      passed: item.summary?.passed || 0,
      failed: item.summary?.failed || 0,
      durationMs: item.summary?.durationMs || null,
      browser: item.summary?.browser || null,
      analysisStatus: item.analysisStatus,
    })),
  });
});

router.get("/api/test-runs/progress/:sessionId", (req, res) => {
  const session = getSession(req.params.sessionId || "default");
  const progress = session.executionProgress || null;
  return res.json({
    ok: true,
    state: session.state,
    progress: progress || {
      runId: null,
      total: Array.isArray(session.approvedIds) ? session.approvedIds.length : 0,
      completed: 0,
      passed: 0,
      failed: 0,
      pending: Array.isArray(session.approvedIds) ? session.approvedIds.length : 0,
      tests: [],
      complete: session.state === "DONE",
    },
  });
});

router.post("/api/chat", async (req, res, next) => {
  const { sessionId = "default", message = "", reviewedTestCases = null, approvedIds = [] } = req.body || {};
  const isRunRequest = message === "approve reviewed cases" || Array.isArray(req.body?.approvedIds);
  if (!isRunRequest) return next();

  const session = getSession(sessionId);
  try {
    if (!RUNNABLE_STATES.has(session.state)) {
      throw new Error(session.state === "RUNNING"
        ? "Automation is already running for this session."
        : "Generate and review test cases before starting execution.");
    }
    if (!session.readinessValidated) {
      return res.status(409).json({
        reply: "Automation readiness is still being checked. Run Approved Tests is locked until readiness validation completes.",
        readinessPending: true,
        automationReadiness: session.automationReadiness,
        testCases: session.testCases,
      });
    }

    const hasCredentials = Boolean(session.credentials?.username && session.credentials?.password);
    const actorRefs = configuredActorRefs(session);
    session.testCases = assessTestCases(
      normalizeReviewedTestCases(reviewedTestCases, session.testCases),
      {
        pageDiscoveries: session.pageDiscoveries,
        hasCredentials,
        actorCatalog: session.testActors || [],
        actorCredentialRefs: actorRefs,
      }
    );
    session.automationReadiness = readinessSummary(session.testCases);

    const allIds = session.testCases.map((tc) => tc.id);
    const approved = Array.isArray(approvedIds)
      ? approvedIds.map((id) => String(id).toUpperCase()).filter((id) => allIds.includes(id))
      : [];
    if (!approved.length) throw new Error("Select at least one reviewed test case to execute.");

    const approvedTestCases = session.testCases.filter((tc) => approved.includes(tc.id));
    const blocked = approvedTestCases.filter((tc) => tc.automationReadiness?.status !== READY);
    if (blocked.length) {
      console.warn(`[readiness] Blocked ${blocked.length} approved case(s) that did not compile into the deterministic automation contract.`);
      return res.status(422).json({
        reply: "One or more selected test cases are not Automation Ready. Every approved case must compile into the deterministic automation contract before execution.",
        unsupportedTestCases: blocked.map((tc) => ({ id: tc.id, title: tc.title, automationReadiness: tc.automationReadiness })),
        automationReadiness: session.automationReadiness,
        testCases: session.testCases,
      });
    }

    const base = new URL(session.targetUrl);
    const loginRuntime = resolveLoginRuntime(session.pageDiscoveries);
    const executionContext = {
      baseUrl: `${base.protocol}//${base.host}`,
      hasCredentials,
      credentials: session.credentials,
      actorCredentials: session.actorCredentials || {},
      testActors: session.testActors || [],
      loginPath: loginRuntime.path,
      loginSelectors: loginRuntime.selectors,
    };
    const modelTier = session.aiModelTier || "strong";

    console.log(`[readiness] ${approvedTestCases.length}/${approvedTestCases.length} approved case(s) compiled and are Automation Ready.`);
    console.log(`[runtime-preflight] Grounded login path: ${executionContext.loginPath}`);
    console.log(`[runtime-preflight] Configured role actors: ${actorRefs.length}`);
    console.log(`[automation-contract] Building deterministic runtime from ${approvedTestCases.length} compiled test plan(s).`);

    const generated = generateDeterministicAutomation(approvedTestCases);
    const validation = validateGroundedScript(generated.script, {
      approvedTestCases,
      pageDiscoveries: session.pageDiscoveries,
      hasCredentials: executionContext.hasCredentials,
      loginSelectors: executionContext.loginSelectors,
      actorCredentialRefs: actorRefs,
      frameworkOwnedSelectors: ["body"],
    });
    if (!validation.valid) {
      console.error(`[automation-contract] Deterministic generator produced an invalid script: ${validation.errors.join(" | ")}`);
      return res.status(500).json({
        reply: "The deterministic automation compiler produced an invalid runtime script. Execution was not started.",
        validationErrors: validation.errors,
        automationReadiness: session.automationReadiness,
      });
    }

    console.log("[automation-contract] Deterministic runtime script validated successfully; no AI code-generation step was required.");
    console.log("[execution] Browser execution is deterministic. No AI calls will be made until execution is complete and the user explicitly requests result analysis.");

    const runNumber = (session.runHistory?.length || 0) + 1;
    session.generatedScript = [{
      fileName: generated.fileName,
      framework: generated.framework,
      language: generated.language,
      generationMode: generated.generationMode,
      script: generated.script,
      testCaseIds: approved,
    }];
    session.approvedIds = approved;
    session.failureAnalyses = [];
    session.executionProgress = {
      runId: null,
      total: approved.length,
      completed: 0,
      passed: 0,
      failed: 0,
      pending: approved.length,
      tests: [],
      complete: false,
      startedAt: new Date().toISOString(),
    };
    session.state = "RUNNING";

    const execResult = await executeSingleGeneratedSpec(generated, executionContext, {
      approvedIds: approved,
      onStart: ({ runId, browser, total }) => {
        session.executionProgress = {
          ...(session.executionProgress || {}),
          runId,
          browser,
          total: total || approved.length,
          pending: total || approved.length,
          complete: false,
        };
      },
      onProgress: (progress) => {
        session.executionProgress = {
          ...(session.executionProgress || {}),
          ...progress,
          runId: session.executionProgress?.runId || execResult?.runId || null,
        };
      },
    });
    if (!execResult.ok || !execResult.summary) {
      session.executionProgress = {
        ...(session.executionProgress || {}),
        complete: true,
        error: execResult.error || "unknown error",
        updatedAt: new Date().toISOString(),
      };
      session.state = "AWAITING_APPROVAL";
      return res.status(500).json({ reply: `Automation execution could not complete: ${execResult.error || "unknown error"}` });
    }

    session.artifacts = execResult.artifacts || null;
    const summary = addEvidenceUrls(execResult.summary, sessionId, session.artifacts);
    session.executionProgress = {
      ...(session.executionProgress || {}),
      runId: execResult.runId || session.executionProgress?.runId || null,
      total: summary.total,
      completed: summary.tests.length,
      passed: summary.passed,
      failed: summary.failed,
      pending: 0,
      tests: summary.tests,
      complete: true,
      updatedAt: new Date().toISOString(),
    };
    const deterministicFindings = summary.tests
      .filter((test) => test.fail)
      .map((test) => {
        const tcId = test.testCaseId || String(test.title || "").match(TEST_ID_GLOBAL_REGEX)?.[0];
        const tc = session.testCases.find((item) => item.id === tcId) || { id: tcId || "UNKNOWN", expectedResults: [] };
        return deterministicFinding(tc, test);
      })
      .filter(Boolean);

    const completedAt = new Date().toISOString();
    const historyEntry = {
      runNumber,
      completedAt,
      approvedIds: [...approved],
      summary,
      deterministicFindings,
      analysisStatus: summary.failed > 0 ? "PENDING" : "NOT_REQUIRED",
      failureAnalyses: [],
    };
    session.runHistory = [...(session.runHistory || []), historyEntry].slice(-20);
    session.lastResults = { execResult, summary, runNumber, deterministicFindings };
    session.reportHtml = buildAnalyticsReport({
      sessionId,
      story: session.story,
      targetUrl: session.targetUrl,
      environment: session.environment,
      summary,
      analyses: [],
      model: modelTier,
    });
    session.state = "DONE";

    console.log(`[execution] Run #${runNumber} completed: ${summary.passed} passed, ${summary.failed} failed. AI analysis has not been called.`);
    return res.json({
      reply: `Test run #${runNumber} complete: ${summary.total} tests, ${summary.passed} passed, ${summary.failed} failed.`,
      runNumber,
      canRunAgain: true,
      summary,
      deterministicFindings,
      failureAnalyses: [],
      analysisPending: summary.failed > 0,
      analysisUrl: summary.failed > 0 ? "/api/test-results/analyze" : null,
      automationReadiness: session.automationReadiness,
      runtimePreflight: { status: "PASSED", loginPath: executionContext.loginPath, actorCount: actorRefs.length, generationMode: "deterministic-dsl-v6-canonical-actors" },
      aiModelTier: modelTier,
      reportUrl: `/api/reports/${encodeURIComponent(sessionId)}`,
      generatedFile: generated.fileName,
      runHistoryCount: session.runHistory.length,
    });
  } catch (err) {
    console.error("[single-spec]", err);
    session.executionProgress = {
      ...(session.executionProgress || {}),
      complete: true,
      error: err.message,
      updatedAt: new Date().toISOString(),
    };
    session.state = session.state === "RUNNING" ? "AWAITING_APPROVAL" : session.state;
    return res.status(500).json({ reply: `Error: ${err.message}` });
  }
});

module.exports = router;

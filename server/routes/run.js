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

function cleanString(value, max = 1000) { return String(value ?? "").trim().slice(0, max); }
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
  try { const url = new URL(page?.finalUrl || page?.url || "/"); return `${url.pathname}${url.search}` || "/"; }
  catch { return "/"; }
}

function resolveLoginRuntime(pageDiscoveries = []) {
  const entries = [];
  for (const page of pageDiscoveries || []) for (const item of page?.elements || []) entries.push({ page, item });
  const byIdentity = (names) => entries.find(({ item }) => names.includes(String(item?.testId || "").toLowerCase()) || names.includes(String(item?.id || "").toLowerCase()) || names.includes(String(item?.name || "").toLowerCase()));
  const usernameEntry = byIdentity(["username", "user-name", "login-username", "email"]) || entries.find(({ item }) => /user.?name|email/i.test(String(item?.label || "")) && String(item?.type || "").toLowerCase() !== "password");
  const passwordEntry = byIdentity(["password", "login-password"]) || entries.find(({ item }) => String(item?.type || "").toLowerCase() === "password");
  const submitEntry = byIdentity(["login-button", "signin-button", "sign-in-button", "submit-login"]) || entries.find(({ item }) => /sign\s*in|log\s*in|login/i.test(String(item?.label || item?.text || "")) && ["button", "submit"].includes(String(item?.type || "").toLowerCase()));
  const loginPage = usernameEntry?.page || passwordEntry?.page || submitEntry?.page || pageDiscoveries?.[0] || null;
  return { path: pagePath(loginPage), selectors: { username: selectorFor(usernameEntry?.item), password: selectorFor(passwordEntry?.item), submit: selectorFor(submitEntry?.item) } };
}

function isPreExecutionAutomationFailure(test) {
  const duration = Number(test?.durationMs);
  const message = String(test?.err?.message || "");
  if (Number.isFinite(duration) && duration <= 50) return true;
  return /\.type\(\).*empty|empty string|cannot type|invalid automation command|command usage|script.*(?:syntax|validation)|failed before test execution/i.test(message);
}

function automationFailureAnalysis(tc, test) {
  const expected = Array.isArray(tc.expectedResults) ? tc.expectedResults.join("; ") : "";
  const actual = test.err?.message || "The generated automation failed before meaningful application validation completed.";
  return { testCase: tc.id, summary: "The test case itself was Automation Ready, but the generated runtime implementation failed before meaningful application validation completed.", classification: "AUTOMATION_DEFECT", expected, actual, probableCause: "A runtime implementation defect escaped pre-execution validation. Test-case readiness and generated-runtime validity are intentionally tracked as separate gates.", severity: "medium", confidence: 0.99 };
}

function analysisContainsOutOfScopeContent(analysis) {
  return [analysis?.summary, analysis?.expected, analysis?.actual, analysis?.probableCause].filter(Boolean).some((value) => LOGIN_SCOPE_FORBIDDEN_ANALYSIS.test(String(value)));
}
function constrainLoginAnalysis(analysis, tc, test) {
  if (!analysisContainsOutOfScopeContent(analysis)) return { testCase: tc.id, ...analysis };
  const actual = test.err?.message || "The login negative test did not produce the expected authentication rejection behavior.";
  const expected = Array.isArray(tc.expectedResults) ? tc.expectedResults.join("; ") : "";
  const classification = analysis?.classification === "APPLICATION_DEFECT" ? "APPLICATION_DEFECT" : analysis?.classification || "UNKNOWN";
  return { testCase: tc.id, summary: classification === "APPLICATION_DEFECT" ? "The login negative test reached the application but did not observe the expected login rejection behavior." : "The login negative test failed, and the analysis has been constrained to the authentication scope defined by the business story.", classification, expected, actual, probableCause: classification === "APPLICATION_DEFECT" ? "The login validation or authentication rejection behavior may not match the expected result." : "The failure requires review within the login/authentication flow.", severity: analysis?.severity || "medium", confidence: Math.min(Number(analysis?.confidence) || 0.5, 0.85) };
}

function normalizeReviewedTestCases(input, fallbackCases) {
  if (!Array.isArray(input)) return fallbackCases;
  if (input.length > 50) throw new Error("A maximum of 50 reviewed test cases is allowed in the demo.");
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
    const steps = Array.isArray(raw.steps) ? raw.steps.slice(0, 30).map((step) => ({ action: cleanString(step?.action ?? step, 500), target: typeof step === "object" ? cleanString(step?.target, 300) : "", value: typeof step === "object" && step?.value !== null && step?.value !== undefined ? cleanString(step.value, 300) : null })).filter((step) => step.action || step.target) : [];
    const expectedResults = Array.isArray(raw.expectedResults) ? raw.expectedResults.slice(0, 20).map((value) => cleanString(value, 600)).filter(Boolean) : [];
    const preconditions = Array.isArray(raw.preconditions) ? raw.preconditions.slice(0, 20).map((value) => cleanString(value, 500)).filter(Boolean) : [];
    normalized.push({ id, title, type: ALLOWED_TYPES.has(typeCandidate) ? typeCandidate : "functional", priority: ALLOWED_PRIORITIES.has(priorityCandidate) ? priorityCandidate : "medium", preconditions, testData: raw.testData && typeof raw.testData === "object" && !Array.isArray(raw.testData) ? raw.testData : {}, steps, expectedResults, source: raw.source === "human" || id.startsWith("TC-H") ? (raw.source || "human") : "ai-reviewed", createdBy: raw.createdBy || null, repairHistory: Array.isArray(raw.repairHistory) ? raw.repairHistory.slice(-10) : [] });
    seen.add(id);
  });
  if (!normalized.length) throw new Error("No valid reviewed test cases were supplied.");
  return normalized;
}

function addEvidenceUrls(summary, sessionId, artifacts) {
  if (!summary) return summary;
  const encodedSession = encodeURIComponent(sessionId);
  return { ...summary, tests: (summary.tests || []).map((test) => {
    if (!test.fail) return test;
    const testCaseId = test.testCaseId || String(test.title || "").match(TEST_ID_GLOBAL_REGEX)?.[0] || null;
    const hasVideo = Boolean(testCaseId && artifacts?.videosByTestCase?.[testCaseId]);
    const hasScreenshot = Boolean(testCaseId && artifacts?.screenshotsByTestCase?.[testCaseId]);
    return { ...test, evidence: { ...(test.evidence || {}), videoUrl: hasVideo ? `/api/artifacts/${encodedSession}/video/${encodeURIComponent(testCaseId)}` : null, screenshotUrl: hasScreenshot ? `/api/artifacts/${encodedSession}/screenshot/${encodeURIComponent(testCaseId)}` : null } };
  }) };
}

router.post("/api/chat", async (req, res, next) => {
  const { sessionId = "default", message = "", reviewedTestCases = null, approvedIds = [] } = req.body || {};
  const isRunRequest = message === "approve reviewed cases" || Array.isArray(req.body?.approvedIds);
  if (!isRunRequest) return next();
  const session = getSession(sessionId);
  try {
    if (session.state !== "AWAITING_APPROVAL") throw new Error("Generate and review test cases before starting execution.");
    const hasCredentials = Boolean(session.credentials?.username && session.credentials?.password);
    session.testCases = assessTestCases(normalizeReviewedTestCases(reviewedTestCases, session.testCases), { pageDiscoveries: session.pageDiscoveries, hasCredentials });
    session.automationReadiness = readinessSummary(session.testCases);
    const allIds = session.testCases.map((tc) => tc.id);
    const approved = Array.isArray(approvedIds) ? approvedIds.map((id) => String(id).toUpperCase()).filter((id) => allIds.includes(id)) : [];
    if (!approved.length) throw new Error("Select at least one reviewed test case to execute.");
    const approvedTestCases = session.testCases.filter((tc) => approved.includes(tc.id));
    const blocked = approvedTestCases.filter((tc) => tc.automationReadiness?.status !== READY);
    if (blocked.length) {
      console.warn(`[readiness] Blocked ${blocked.length} approved case(s) that did not compile into the deterministic automation contract.`);
      return res.status(422).json({ reply: "One or more selected test cases are not Automation Ready. Every approved case must compile into the deterministic automation contract before execution.", unsupportedTestCases: blocked.map((tc) => ({ id: tc.id, title: tc.title, automationReadiness: tc.automationReadiness })), automationReadiness: session.automationReadiness, testCases: session.testCases });
    }

    const base = new URL(session.targetUrl);
    const loginRuntime = resolveLoginRuntime(session.pageDiscoveries);
    const executionContext = { baseUrl: `${base.protocol}//${base.host}`, hasCredentials, credentials: session.credentials, loginPath: loginRuntime.path, loginSelectors: loginRuntime.selectors };
    const modelTier = session.aiModelTier || "strong";
    console.log(`[readiness] ${approvedTestCases.length}/${approvedTestCases.length} approved case(s) compiled and are Automation Ready.`);
    console.log(`[runtime-preflight] Grounded login path: ${executionContext.loginPath}`);
    console.log(`[automation-contract] Building deterministic runtime from ${approvedTestCases.length} compiled test plan(s).`);

    const generated = generateDeterministicAutomation(approvedTestCases);
    const validation = validateGroundedScript(generated.script, {
      approvedTestCases,
      pageDiscoveries: session.pageDiscoveries,
      hasCredentials: executionContext.hasCredentials,
      loginSelectors: executionContext.loginSelectors,
      // The deterministic hidden/absent assertion intentionally queries the document
      // body before looking for the grounded target. "body" is framework-owned and is
      // not an application selector discovered from the target page.
      frameworkOwnedSelectors: ["body"],
    });
    if (!validation.valid) {
      console.error(`[automation-contract] Deterministic generator produced an invalid script: ${validation.errors.join(" | ")}`);
      return res.status(500).json({ reply: "The deterministic automation compiler produced an invalid runtime script. Execution was not started.", validationErrors: validation.errors, automationReadiness: session.automationReadiness });
    }
    console.log("[automation-contract] Deterministic runtime script validated successfully; no AI code-generation step was required.");

    session.generatedScript = [{ fileName: generated.fileName, framework: generated.framework, language: generated.language, generationMode: generated.generationMode, script: generated.script, testCaseIds: approved }];
    session.approvedIds = approved;
    session.state = "RUNNING";
    const execResult = await executeSingleGeneratedSpec(generated, executionContext);
    if (!execResult.ok || !execResult.summary) { session.state = "AWAITING_APPROVAL"; return res.status(500).json({ reply: `Automation execution could not complete: ${execResult.error || "unknown error"}` }); }

    session.artifacts = execResult.artifacts || null;
    const summary = addEvidenceUrls(execResult.summary, sessionId, session.artifacts);
    const loginOnly = isLoginOnlyStory(session.story);
    const analyses = await Promise.all(summary.tests.filter((test) => test.fail).map(async (test) => {
      const tcId = test.testCaseId || String(test.title || "").match(TEST_ID_GLOBAL_REGEX)?.[0];
      const tc = session.testCases.find((item) => item.id === tcId) || { id: tcId || "UNKNOWN", title: test.title, expectedResults: [] };
      if (isPreExecutionAutomationFailure(test)) return automationFailureAnalysis(tc, test);
      const analysis = await qwen.analyzeFailure({ story: session.story, testCase: tc, expected: Array.isArray(tc.expectedResults) ? tc.expectedResults.join("; ") : "", actual: test.err?.message || "Automation assertion failed", modelTier });
      if (loginOnly) return constrainLoginAnalysis(analysis, tc, test);
      return { testCase: tc.id, ...analysis };
    }));

    session.failureAnalyses = analyses;
    session.lastResults = { execResult, summary };
    session.reportHtml = buildAnalyticsReport({ sessionId, story: session.story, targetUrl: session.targetUrl, environment: session.environment, summary, analyses, model: modelTier });
    session.state = "DONE";
    return res.json({ reply: `Test run complete: ${summary.total} tests, ${summary.passed} passed, ${summary.failed} failed.`, summary, failureAnalyses: analyses, automationReadiness: session.automationReadiness, runtimePreflight: { status: "PASSED", loginPath: executionContext.loginPath, generationMode: "deterministic-dsl" }, aiModelTier: modelTier, reportUrl: `/api/reports/${encodeURIComponent(sessionId)}`, generatedFile: generated.fileName });
  } catch (err) {
    console.error("[single-spec]", err);
    session.state = session.state === "RUNNING" ? "AWAITING_APPROVAL" : session.state;
    return res.status(500).json({ reply: `Error: ${err.message}` });
  }
});

module.exports = router;
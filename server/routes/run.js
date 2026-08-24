const express = require("express");
const router = express.Router();

const { getSession } = require("../data/sessionStore");
const qwen = require("../services/qwenClient");
const { validateScript } = require("../services/scriptValidator");
const { executeSingleGeneratedSpec } = require("../services/singleSpecRunner");
const { buildAnalyticsReport } = require("../services/reportGenerator");

const TEST_ID_REGEX = /^TC(?:\d{3}|-H\d{3})$/;
const TEST_ID_GLOBAL_REGEX = /TC(?:\d{3}|-H\d{3})/g;
const ALLOWED_TYPES = new Set(["positive", "negative", "boundary", "functional", "custom"]);
const ALLOWED_PRIORITIES = new Set(["low", "medium", "high"]);

function cleanString(value, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizeReviewedTestCases(input, fallbackCases) {
  if (!Array.isArray(input)) return fallbackCases;
  if (input.length > 50) throw new Error("A maximum of 50 reviewed test cases is allowed in the demo.");

  const seen = new Set();
  const normalized = [];

  input.forEach((raw, index) => {
    if (!raw || typeof raw !== "object") return;

    let id = cleanString(raw.id, 20).toUpperCase();
    if (!TEST_ID_REGEX.test(id) || seen.has(id)) {
      id = `TC-H${String(index + 1).padStart(3, "0")}`;
    }
    while (seen.has(id)) {
      id = `TC-H${String(index + 2).padStart(3, "0")}`;
    }

    const title = cleanString(raw.title, 300);
    if (!title) return;

    const typeCandidate = cleanString(raw.type, 30).toLowerCase();
    const priorityCandidate = cleanString(raw.priority, 30).toLowerCase();

    const steps = Array.isArray(raw.steps)
      ? raw.steps.slice(0, 30).map((step) => ({
          action: cleanString(step?.action ?? step, 500),
          target: typeof step === "object" ? cleanString(step?.target, 300) : "",
          value: typeof step === "object" && step?.value !== null && step?.value !== undefined
            ? cleanString(step.value, 300)
            : null,
        })).filter((step) => step.action || step.target)
      : [];

    const expectedResults = Array.isArray(raw.expectedResults)
      ? raw.expectedResults.slice(0, 20).map((value) => cleanString(value, 600)).filter(Boolean)
      : [];

    const preconditions = Array.isArray(raw.preconditions)
      ? raw.preconditions.slice(0, 20).map((value) => cleanString(value, 500)).filter(Boolean)
      : [];

    normalized.push({
      id,
      title,
      type: ALLOWED_TYPES.has(typeCandidate) ? typeCandidate : "functional",
      priority: ALLOWED_PRIORITIES.has(priorityCandidate) ? priorityCandidate : "medium",
      preconditions,
      testData: raw.testData && typeof raw.testData === "object" && !Array.isArray(raw.testData) ? raw.testData : {},
      steps,
      expectedResults,
      source: raw.source === "human" || id.startsWith("TC-H") ? "human" : "ai-reviewed",
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
          videoUrl: hasVideo
            ? `/api/artifacts/${encodedSession}/video/${encodeURIComponent(testCaseId)}`
            : null,
          screenshotUrl: hasScreenshot
            ? `/api/artifacts/${encodedSession}/screenshot/${encodeURIComponent(testCaseId)}`
            : null,
        },
      };
    }),
  };
}

router.post("/api/run", async (req, res) => {
  const {
    sessionId = "default",
    reviewedTestCases = null,
    approvedIds = [],
  } = req.body || {};

  const session = getSession(sessionId);

  try {
    if (session.state !== "AWAITING_APPROVAL") {
      throw new Error("Generate and review test cases before starting execution.");
    }

    session.testCases = normalizeReviewedTestCases(reviewedTestCases, session.testCases);
    const allIds = session.testCases.map((tc) => tc.id);
    const approved = Array.isArray(approvedIds)
      ? approvedIds.map((id) => String(id).toUpperCase()).filter((id) => allIds.includes(id))
      : [];

    if (!approved.length) throw new Error("Select at least one reviewed test case to execute.");

    const approvedTestCases = session.testCases.filter((tc) => approved.includes(tc.id));
    const base = new URL(session.targetUrl);
    const executionContext = {
      baseUrl: `${base.protocol}//${base.host}`,
      hasCredentials: Boolean(session.credentials?.username || session.credentials?.password),
      credentials: session.credentials,
    };

    console.log(`[api/run] Generating one automation spec for ${approvedTestCases.length} approved case(s)`);

    // One Qwen call generates one file containing all approved it() blocks.
    // This avoids five model round-trips and five separate browser launches.
    const generated = await qwen.generateAutomationCode({
      approvedTestCases,
      pageDiscoveries: session.pageDiscoveries,
      fileName: "ai-generated.cy.js",
      executionContext,
    });

    const validation = validateScript(generated.script);
    if (!validation.valid) {
      return res.status(422).json({
        reply: `Generated automation code failed validation: ${validation.errors.join(" | ")}`,
        validationErrors: validation.errors,
      });
    }

    session.generatedScript = [{
      fileName: "ai-generated.cy.js",
      framework: generated.framework,
      language: generated.language,
      script: generated.script,
      testCaseIds: approved,
    }];
    session.approvedIds = approved;
    session.state = "RUNNING";

    const execResult = await executeSingleGeneratedSpec(generated, executionContext);
    if (!execResult.ok || !execResult.summary) {
      session.state = "AWAITING_APPROVAL";
      return res.status(500).json({
        reply: `Automation execution could not complete: ${execResult.error || "unknown error"}`,
      });
    }

    session.artifacts = execResult.artifacts || null;
    const summary = addEvidenceUrls(execResult.summary, sessionId, session.artifacts);

    const analyses = await Promise.all(
      summary.tests.filter((test) => test.fail).map(async (test) => {
        const tcId = test.testCaseId || String(test.title || "").match(TEST_ID_GLOBAL_REGEX)?.[0];
        const tc = session.testCases.find((item) => item.id === tcId) || {
          id: tcId || "UNKNOWN",
          title: test.title,
          expectedResults: [],
        };

        const analysis = await qwen.analyzeFailure({
          story: session.story,
          testCase: tc,
          expected: Array.isArray(tc.expectedResults) ? tc.expectedResults.join("; ") : "",
          actual: test.err?.message || "Automation assertion failed",
        });

        return { testCase: tc.id, ...analysis };
      })
    );

    session.failureAnalyses = analyses;
    session.lastResults = { execResult, summary };
    session.reportHtml = buildAnalyticsReport({
      sessionId,
      story: session.story,
      targetUrl: session.targetUrl,
      environment: session.environment,
      summary,
      analyses,
      model: qwen.QWEN_MODEL,
    });
    session.state = "DONE";

    // Keep the browser response deliberately compact. Generated source remains
    // in memory/on disk and does not need to be sent back to DevTools/UI.
    return res.json({
      reply: `Test run complete: ${summary.total} tests, ${summary.passed} passed, ${summary.failed} failed.`,
      summary,
      failureAnalyses: analyses,
      reportUrl: `/api/reports/${encodeURIComponent(sessionId)}`,
      generatedFile: "ai-generated.cy.js",
    });
  } catch (err) {
    console.error("[api/run]", err);
    session.state = session.state === "RUNNING" ? "AWAITING_APPROVAL" : session.state;
    return res.status(500).json({ reply: `Error: ${err.message}` });
  }
});

module.exports = router;

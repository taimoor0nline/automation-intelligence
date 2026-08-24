const express = require("express");
const fs = require("fs");
const router = express.Router();

const { getSession, resetSession } = require("../data/sessionStore");
const { discoverPages } = require("../services/pageDiscovery");
const qwen = require("../services/qwenClient");
const { validateScript } = require("../services/scriptValidator");
const { executeGeneratedTest } = require("../services/testRunner");
const { buildAnalyticsReport } = require("../services/reportGenerator");

const URL_REGEX = /https?:\/\/[^\s)]+/i;
const TEST_ID_REGEX = /^TC(?:\d{3}|-H\d{3})$/;
const TEST_ID_GLOBAL_REGEX = /TC(?:\d{3}|-H\d{3})/g;
const ALLOWED_TYPES = new Set(["positive", "negative", "boundary", "functional", "custom"]);
const ALLOWED_PRIORITIES = new Set(["low", "medium", "high"]);

function extractUrl(text) {
  const m = String(text || "").match(URL_REGEX);
  return m ? m[0].replace(/[),.;:!?]+$/, "") : null;
}

function normalizeTargetUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only http/https targets are supported.");
  return url.toString();
}

function resolveDiscoveryUrls(targetUrl, additionalPaths = []) {
  const base = new URL(targetUrl);
  const urls = [targetUrl];
  for (const raw of additionalPaths) {
    const path = String(raw || "").trim();
    if (!path) continue;
    urls.push(new URL(path, `${base.protocol}//${base.host}/`).toString());
  }
  return [...new Set(urls)];
}

function parseApproval(text, allIds) {
  const normalized = String(text || "").trim().toLowerCase();
  if (["approve all", "approve", "yes"].includes(normalized)) return allIds;
  const ids = String(text || "").toUpperCase().match(TEST_ID_GLOBAL_REGEX) || [];
  if (/reject/i.test(text)) return allIds.filter((id) => !ids.includes(id));
  return ids.length ? ids : null;
}

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
      while (seen.has(id)) {
        id = `TC-H${String(index + 2).padStart(3, "0")}`;
      }
    }

    const title = cleanString(raw.title, 300);
    if (!title) return;

    const typeCandidate = cleanString(raw.type, 30).toLowerCase();
    const priorityCandidate = cleanString(raw.priority, 30).toLowerCase();

    const steps = Array.isArray(raw.steps)
      ? raw.steps.slice(0, 30).map((step) => {
          if (typeof step === "string") {
            return { action: cleanString(step, 500), target: "", value: null };
          }
          return {
            action: cleanString(step?.action, 500),
            target: cleanString(step?.target, 300),
            value: step?.value === null || step?.value === undefined ? null : cleanString(step.value, 300),
          };
        }).filter((step) => step.action || step.target)
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

function formatTestCaseList(testCases) {
  return testCases.map((tc) => `• ${tc.id} [${tc.type}/${tc.priority}] — ${tc.title}`).join("\n");
}

function addEvidenceUrls(summary, sessionId, artifacts) {
  if (!summary) return summary;
  const encodedSession = encodeURIComponent(sessionId);
  return {
    ...summary,
    tests: (summary.tests || []).map((test) => {
      if (!test.fail) return test;
      const testCaseId = test.testCaseId || String(test.title || "").match(TEST_ID_GLOBAL_REGEX)?.[0] || null;
      const hasScreenshot = Boolean(testCaseId && artifacts?.screenshotsByTestCase?.[testCaseId]);
      return {
        ...test,
        evidence: {
          ...(test.evidence || {}),
          videoUrl: artifacts?.videoPath ? `/api/artifacts/${encodedSession}/video` : null,
          screenshotUrl: hasScreenshot
            ? `/api/artifacts/${encodedSession}/screenshot/${encodeURIComponent(testCaseId)}`
            : null,
        },
      };
    }),
  };
}

router.post("/api/chat", async (req, res) => {
  const {
    sessionId = "default",
    message = "",
    targetUrl: explicitTargetUrl,
    additionalPaths = [],
    environment = "Test",
    credentials = null,
    reviewedTestCases = null,
    approvedIds: explicitApprovedIds = null,
  } = req.body || {};

  const session = getSession(sessionId);

  try {
    if (session.state === "IDLE") {
      if (!qwen.isConfigured()) throw new Error("Real Qwen is required for this demo. Configure QWEN_API_KEY and QWEN_BASE_URL in .env.");

      const rawUrl = explicitTargetUrl || extractUrl(message);
      if (!rawUrl) throw new Error("Please provide a target URL.");
      const targetUrl = normalizeTargetUrl(rawUrl);
      const story = String(message || "").trim();
      if (!story) throw new Error("Please enter a business user story.");

      session.story = story;
      session.targetUrl = targetUrl;
      session.environment = environment;
      session.additionalPaths = Array.isArray(additionalPaths) ? additionalPaths : [];
      session.credentials = credentials && typeof credentials === "object"
        ? { username: String(credentials.username || ""), password: String(credentials.password || "") }
        : null;

      const discoveryUrls = resolveDiscoveryUrls(targetUrl, session.additionalPaths);
      session.pageDiscoveries = await discoverPages(discoveryUrls);

      const generated = await qwen.generateTestCases({
        story,
        pageDiscoveries: session.pageDiscoveries,
        environment,
      });

      session.testCases = generated.testCases.map((tc) => ({ ...tc, source: "ai" }));
      session.state = "AWAITING_APPROVAL";

      return res.json({
        reply: `Qwen generated ${session.testCases.length} story-driven test cases from ${session.pageDiscoveries.length} discovered page(s).\n\n${formatTestCaseList(session.testCases)}`,
        feature: generated.feature || null,
        testCases: session.testCases,
        pageDiscoveries: session.pageDiscoveries,
        usingRealQwen: true,
        qwenModel: qwen.QWEN_MODEL,
      });
    }

    if (session.state === "AWAITING_APPROVAL") {
      session.testCases = normalizeReviewedTestCases(reviewedTestCases, session.testCases);

      const allIds = session.testCases.map((tc) => tc.id);
      const approvedIds = Array.isArray(explicitApprovedIds)
        ? explicitApprovedIds.map((id) => String(id).toUpperCase()).filter((id) => allIds.includes(id))
        : parseApproval(message, allIds);

      if (!approvedIds || !approvedIds.length) {
        throw new Error("Select at least one reviewed test case to execute.");
      }

      const approvedTestCases = session.testCases.filter((tc) => approvedIds.includes(tc.id));
      if (!approvedTestCases.length) throw new Error("No test cases were approved.");
      session.approvedIds = approvedIds;

      const base = new URL(session.targetUrl);
      const executionContext = {
        baseUrl: `${base.protocol}//${base.host}`,
        hasCredentials: Boolean(session.credentials?.username || session.credentials?.password),
        credentials: session.credentials,
      };

      const generated = await qwen.generateCypressCode({
        approvedTestCases,
        pageDiscoveries: session.pageDiscoveries,
        fileName: "ai-generated.cy.js",
        executionContext,
      });

      const validation = validateScript(generated.script);
      if (!validation.valid) {
        return res.status(422).json({
          reply: `Generated Cypress code failed validation and was not executed: ${validation.errors.join(" | ")}`,
          validationErrors: validation.errors,
        });
      }

      session.generatedScript = generated;
      session.state = "RUNNING";

      const execResult = await executeGeneratedTest(generated, executionContext);
      if (!execResult.ok || !execResult.summary) {
        session.state = "AWAITING_APPROVAL";
        return res.status(500).json({
          reply: `Cypress could not complete: ${execResult.error || "unknown error"}`,
          generatedScript: generated,
        });
      }

      session.artifacts = execResult.artifacts || null;
      const summary = addEvidenceUrls(execResult.summary, sessionId, session.artifacts);
      const analyses = [];
      for (const test of summary.tests.filter((t) => t.fail)) {
        const tcId = String(test.title || "").match(TEST_ID_GLOBAL_REGEX)?.[0];
        const tc = session.testCases.find((item) => item.id === tcId) || { id: tcId || "UNKNOWN", title: test.title };
        const analysis = await qwen.analyzeFailure({
          story: session.story,
          testCase: tc,
          expected: Array.isArray(tc.expectedResults) ? tc.expectedResults.join("; ") : "",
          actual: test.err?.message || "Cypress assertion failed",
        });
        analyses.push({ testCase: tc.id, ...analysis });
      }

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

      return res.json({
        reply: `Test run complete: ${summary.total} tests, ${summary.passed} passed, ${summary.failed} failed.`,
        summary,
        failureAnalyses: analyses,
        generatedScript: generated,
        reviewedTestCases: session.testCases,
        reportUrl: `/api/reports/${encodeURIComponent(sessionId)}`,
      });
    }

    return res.json({
      reply: "This run is complete. Start a new story to create another run.",
      summary: session.lastResults?.summary || null,
      failureAnalyses: session.failureAnalyses || [],
      reportUrl: session.reportHtml ? `/api/reports/${encodeURIComponent(sessionId)}` : null,
    });
  } catch (err) {
    console.error("[api/chat]", err);
    return res.status(500).json({ reply: `Error: ${err.message}` });
  }
});

router.get("/api/reports/:sessionId", (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session.reportHtml) return res.status(404).send("Report not found or the run has not completed.");
  res.type("html").send(session.reportHtml);
});

router.get("/api/artifacts/:sessionId/video", (req, res) => {
  const session = getSession(req.params.sessionId);
  const filePath = session.artifacts?.videoPath;
  if (!filePath || !fs.existsSync(filePath)) return res.status(404).send("Video evidence not found.");
  res.sendFile(filePath);
});

router.get("/api/artifacts/:sessionId/screenshot/:testCaseId", (req, res) => {
  const session = getSession(req.params.sessionId);
  const testCaseId = String(req.params.testCaseId || "").toUpperCase();
  if (!TEST_ID_REGEX.test(testCaseId)) return res.status(400).send("Invalid test case id.");
  const filePath = session.artifacts?.screenshotsByTestCase?.[testCaseId];
  if (!filePath || !fs.existsSync(filePath)) return res.status(404).send("Screenshot evidence not found.");
  res.sendFile(filePath);
});

router.post("/api/reset", (req, res) => {
  const { sessionId = "default" } = req.body || {};
  resetSession(sessionId);
  res.json({ ok: true });
});

module.exports = router;
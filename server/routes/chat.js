const express = require("express");
const router = express.Router();

const { getSession, resetSession } = require("../data/sessionStore");
const { discoverPages } = require("../services/pageDiscovery");
const qwen = require("../services/qwenClient");
const { validateScript } = require("../services/scriptValidator");
const { executeGeneratedTest } = require("../services/testRunner");
const { buildAnalyticsReport } = require("../services/reportGenerator");

const URL_REGEX = /https?:\/\/[^\s)]+/i;

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
  const ids = String(text || "").toUpperCase().match(/TC(?:\d{3}|-C\d+)/g) || [];
  if (/reject/i.test(text)) return allIds.filter((id) => !ids.includes(id));
  return ids.length ? ids : null;
}

function formatTestCaseList(testCases) {
  return testCases.map((tc) => `• ${tc.id} [${tc.type}/${tc.priority}] — ${tc.title}`).join("\n");
}

router.post("/api/chat", async (req, res) => {
  const {
    sessionId = "default",
    message = "",
    targetUrl: explicitTargetUrl,
    additionalPaths = [],
    environment = "Test",
    credentials = null,
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

      session.testCases = generated.testCases;
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
      const allIds = session.testCases.map((tc) => tc.id);
      const approvedIds = parseApproval(message, allIds);
      if (!approvedIds) throw new Error('Approve test cases using "approve all" or a list such as "approve TC001,TC003".');

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

      const summary = execResult.summary;
      const analyses = [];
      for (const test of summary.tests.filter((t) => t.fail)) {
        const tcId = String(test.title || "").match(/TC(?:\d{3}|-C\d+)/)?.[0];
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
        reportUrl: `/api/reports/${encodeURIComponent(sessionId)}`,
      });
    }

    return res.json({
      reply: 'This run is complete. Start a new story to create another run.',
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

router.post("/api/reset", (req, res) => {
  const { sessionId = "default" } = req.body || {};
  resetSession(sessionId);
  res.json({ ok: true });
});

module.exports = router;

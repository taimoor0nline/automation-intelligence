const express = require("express");
const fs = require("fs");
const router = express.Router();

const { getSession, resetSession } = require("../data/sessionStore");
const { discoverPages } = require("../services/pageDiscovery");
const qwen = require("../services/qwenClient");
const { assessTestCases, readinessSummary } = require("../services/testCaseFeasibility");

const URL_REGEX = /https?:\/\/[^\s)]+/i;
const TEST_ID_REGEX = /^TC(?:\d{3}|-H\d{3})$/;
const FIXED_ENVIRONMENT = "Test";

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

function formatTestCaseList(testCases) {
  return testCases.map((tc) => {
    const readiness = tc.automationReadiness?.status || "UNKNOWN";
    return `• ${tc.id} [${tc.type}/${tc.priority}] [${readiness}] — ${tc.title}`;
  }).join("\n");
}

router.post("/api/chat", async (req, res) => {
  const {
    sessionId = "default",
    message = "",
    targetUrl: explicitTargetUrl,
    additionalPaths = [],
    credentials = null,
  } = req.body || {};

  const session = getSession(sessionId);

  try {
    if (session.state === "IDLE") {
      if (!qwen.isConfigured()) throw new Error("The configured AI provider is required for this demo.");

      const rawUrl = explicitTargetUrl || extractUrl(message);
      if (!rawUrl) throw new Error("Please provide a target URL.");
      const targetUrl = normalizeTargetUrl(rawUrl);
      const story = String(message || "").trim();
      if (!story) throw new Error("Please enter a business user story.");

      session.story = story;
      session.targetUrl = targetUrl;
      session.environment = FIXED_ENVIRONMENT;
      session.additionalPaths = Array.isArray(additionalPaths) ? additionalPaths : [];
      session.credentials = credentials && typeof credentials === "object"
        ? { username: String(credentials.username || ""), password: String(credentials.password || "") }
        : null;

      const discoveryUrls = resolveDiscoveryUrls(targetUrl, session.additionalPaths);
      session.pageDiscoveries = await discoverPages(discoveryUrls);

      const generated = await qwen.generateTestCases({
        story,
        pageDiscoveries: session.pageDiscoveries,
        environment: FIXED_ENVIRONMENT,
      });

      const hasCredentials = Boolean(session.credentials?.username && session.credentials?.password);
      session.testCases = assessTestCases(
        generated.testCases.map((tc) => ({ ...tc, source: "ai" })),
        { pageDiscoveries: session.pageDiscoveries, hasCredentials }
      );
      session.automationReadiness = readinessSummary(session.testCases);
      session.state = "AWAITING_APPROVAL";

      return res.json({
        reply: `AI generated ${session.testCases.length} story-driven test cases from ${session.pageDiscoveries.length} discovered page(s). Each case was checked for Cypress automation readiness before human review.\n\n${formatTestCaseList(session.testCases)}`,
        feature: generated.feature || null,
        testCases: session.testCases,
        pageDiscoveries: session.pageDiscoveries,
        automationReadiness: session.automationReadiness,
      });
    }

    if (session.state === "AWAITING_APPROVAL") {
      return res.status(409).json({
        reply: "Test cases are awaiting human review. Select only Automation Ready cases and use Run Approved Tests.",
        testCases: session.testCases,
        automationReadiness: session.automationReadiness || readinessSummary(session.testCases || []),
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

router.get("/api/artifacts/:sessionId/video/:testCaseId", (req, res) => {
  const session = getSession(req.params.sessionId);
  const testCaseId = String(req.params.testCaseId || "").toUpperCase();
  if (!TEST_ID_REGEX.test(testCaseId)) return res.status(400).send("Invalid test case id.");
  const filePath = session.artifacts?.videosByTestCase?.[testCaseId];
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

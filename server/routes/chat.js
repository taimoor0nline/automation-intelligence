const express = require("express");
const fs = require("fs");
const router = express.Router();

const { getSession, resetSession } = require("../data/sessionStore");
const { discoverPages } = require("../services/pageDiscovery");
const { compactDiscoveriesForModel } = require("../services/modelDiscoveryView");
const qwen = require("../services/qwenClient");
const { readinessSummary } = require("../services/testCaseFeasibility");

const URL_REGEX = /https?:\/\/[^\s)]+/i;
const TEST_ID_REGEX = /^TC(?:\d{3}|-H\d{3})$/;
const FIXED_ENVIRONMENT = "Test";
const DISCOVERY_CACHE_TTL_MS = Math.max(0, Math.min(Number(process.env.DISCOVERY_CACHE_TTL_MS || 300000) || 300000, 3600000));
const DISCOVERY_CACHE_MAX = 20;
const discoveryCache = new Map();

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

function pendingReadinessSummary(testCases = []) {
  return {
    total: testCases.length,
    ready: 0,
    checking: testCases.length,
    manual: 0,
    insufficientEvidence: 0,
    invalid: 0,
    userInputRequired: 0,
    aiRepairable: 0,
    frameworkChangeRequired: 0,
  };
}

function formatTestCaseList(testCases) {
  return testCases.map((tc) => `• ${tc.id} [${tc.type}/${tc.priority}] [CHECKING] — ${tc.title}`).join("\n");
}

function discoveryCacheKey(urls) {
  return [...urls].sort().join("\n");
}

function trimDiscoveryCache() {
  const now = Date.now();
  for (const [key, entry] of discoveryCache.entries()) {
    if (!entry || entry.expiresAt <= now) discoveryCache.delete(key);
  }
  while (discoveryCache.size > DISCOVERY_CACHE_MAX) {
    discoveryCache.delete(discoveryCache.keys().next().value);
  }
}

async function discoverPagesCached(urls) {
  if (!DISCOVERY_CACHE_TTL_MS) return { pages: await discoverPages(urls), cacheHit: false };
  trimDiscoveryCache();
  const key = discoveryCacheKey(urls);
  const cached = discoveryCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return { pages: cached.pages, cacheHit: true };

  const pages = await discoverPages(urls);
  discoveryCache.set(key, { pages, expiresAt: Date.now() + DISCOVERY_CACHE_TTL_MS });
  trimDiscoveryCache();
  return { pages, cacheHit: false };
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

      const requestStartedAt = Date.now();
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
      const discoveryStartedAt = Date.now();
      const discoveryResult = await discoverPagesCached(discoveryUrls);
      session.pageDiscoveries = discoveryResult.pages;
      const discoveryMs = Date.now() - discoveryStartedAt;

      // Keep the full discovery evidence in the session for deterministic validation,
      // but send only the fields the AI needs. This materially reduces prompt size
      // on pages with verbose DOM metadata while preserving selectors, constraints,
      // messages, options and routes needed for grounded test generation.
      const modelDiscoveries = compactDiscoveriesForModel(session.pageDiscoveries);
      const aiStartedAt = Date.now();
      const generated = await qwen.generateTestCases({
        story,
        pageDiscoveries: modelDiscoveries,
        environment: FIXED_ENVIRONMENT,
      });
      const aiGenerationMs = Date.now() - aiStartedAt;

      // Return AI-generated cases to the reviewer immediately. Readiness is a
      // separate deterministic phase started by the browser after rendering.
      session.testCases = generated.testCases.map((tc) => ({
        ...tc,
        source: "ai",
        automationReadiness: null,
      }));
      session.automationReadiness = pendingReadinessSummary(session.testCases);
      session.state = "AWAITING_APPROVAL";

      const totalMs = Date.now() - requestStartedAt;
      console.log(`[test-generation] discovery=${discoveryMs}ms${discoveryResult.cacheHit ? " (cache)" : ""} ai=${aiGenerationMs}ms total=${totalMs}ms pages=${session.pageDiscoveries.length}`);

      return res.json({
        reply: `AI generated ${session.testCases.length} story-driven test cases from ${session.pageDiscoveries.length} discovered page(s). They are available for human review now; automation readiness is being checked separately in the background.\n\n${formatTestCaseList(session.testCases)}`,
        feature: generated.feature || null,
        testCases: session.testCases,
        pageDiscoveries: session.pageDiscoveries,
        automationReadiness: session.automationReadiness,
        readinessPending: true,
        generationTiming: {
          discoveryMs,
          discoveryCacheHit: discoveryResult.cacheHit,
          aiGenerationMs,
          totalMs,
        },
      });
    }

    if (session.state === "AWAITING_APPROVAL") {
      return res.status(409).json({
        reply: "Test cases are awaiting human review. Readiness is validated independently before execution.",
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

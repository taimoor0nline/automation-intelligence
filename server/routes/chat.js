const express = require("express");
const fs = require("fs");
const router = express.Router();

const { getSession, resetSession } = require("../data/sessionStore");
const { discoverPages } = require("../services/pageDiscovery");
const { compactDiscoveriesForModel } = require("../services/modelDiscoveryView");
const { normalizeProfile } = require("../services/aiModelProfiles");
const qwen = require("../services/qwenClient");
const { readinessSummary } = require("../services/testCaseFeasibility");
const { validateStoryDiscoveryCompatibility, mismatchMessage } = require("../services/storyDiscoveryCompatibility");
const { MAX_GENERATED_CASES, pruneGeneratedTestCases } = require("../services/testCaseScopeFilter");
const { TEST_CATEGORIES, normalizeTestCategory, inferTestCategory } = require("../services/testCategories");
const {
  SECURITY_SUBCATEGORIES,
  SECURITY_SEVERITIES,
  normalizeSecuritySubcategory,
  normalizeSecuritySeverity,
  inferSecuritySubcategory,
  inferSecuritySeverity,
} = require("../services/securityTaxonomy");

const URL_REGEX = /https?:\/\/[^\s)]+/i;
const TEST_ID_REGEX = /^TC(?:\d{3}|-H\d{3})$/;
const FIXED_ENVIRONMENT = "Test";
const rawDiscoveryTtl = process.env.DISCOVERY_CACHE_TTL_MS;
const parsedDiscoveryTtl = rawDiscoveryTtl === undefined || rawDiscoveryTtl === "" ? 300000 : Number(rawDiscoveryTtl);
const DISCOVERY_CACHE_TTL_MS = Math.max(0, Math.min(Number.isFinite(parsedDiscoveryTtl) ? parsedDiscoveryTtl : 300000, 3600000));
const DISCOVERY_CACHE_MAX = 20;
const discoveryCache = new Map();

function extractUrl(text) { const m = String(text || "").match(URL_REGEX); return m ? m[0].replace(/[),.;:!?]+$/, "") : null; }
function normalizeTargetUrl(value) { const url = new URL(value); if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only http/https targets are supported."); return url.toString(); }
function resolveDiscoveryUrls(targetUrl, additionalPaths = []) { const base = new URL(targetUrl); const urls = [targetUrl]; for (const raw of additionalPaths) { const pagePath = String(raw || "").trim(); if (!pagePath) continue; urls.push(new URL(pagePath, `${base.protocol}//${base.host}/`).toString()); } return [...new Set(urls)]; }
function pendingReadinessSummary(testCases = []) { return { total: testCases.length, ready: 0, checking: testCases.length, manual: 0, insufficientEvidence: 0, invalid: 0, userInputRequired: 0, aiRepairable: 0, frameworkChangeRequired: 0 }; }
function formatTestCaseList(testCases) { return testCases.map((tc) => `• ${tc.id} [${tc.type}/${tc.testCategory || "FUNCTIONAL"}/${tc.priority}]${tc.testCategory === 'SECURITY' ? ` [${tc.securitySubcategory || 'CUSTOM'}/${tc.severity || 'MEDIUM'}]` : ''} [CHECKING] — ${tc.title}`).join("\n"); }

function normalizeSelectedCategories(input) {
  const requested = Array.isArray(input) ? input : [];
  const normalized = requested.map((value) => normalizeTestCategory(value, null)).filter(Boolean);
  const unique = [...new Set(normalized)].filter((value) => TEST_CATEGORIES.includes(value));
  return unique.length ? unique : [...TEST_CATEGORIES];
}
function normalizeSelectedSecuritySubcategories(input) {
  const normalized = (Array.isArray(input) ? input : []).map((value) => normalizeSecuritySubcategory(value, null)).filter(Boolean);
  const unique = [...new Set(normalized)];
  return unique.length ? unique : [...SECURITY_SUBCATEGORIES];
}
function normalizeSelectedSecuritySeverities(input) {
  const normalized = (Array.isArray(input) ? input : []).map((value) => normalizeSecuritySeverity(value, null)).filter(Boolean);
  const unique = [...new Set(normalized)];
  return unique.length ? unique : [...SECURITY_SEVERITIES];
}

function categoryGenerationInstruction(categories, securitySubcategories, securitySeverities) {
  const labels = categories.join(", ");
  let instruction = `\n\nTEST CATEGORY SCOPE SELECTED BY THE HUMAN REVIEWER:\n${labels}\nGenerate scenarios only for these selected testing categories. Treat category as the PURPOSE of the test, separately from scenario type (positive/negative/boundary). Functional is a Test Category and must never be used as a Scenario Type. Make each scenario's title, preconditions and expected behaviour clearly reflect its intended testing category without inventing requirements that are absent from the business story or discovery evidence. Never repurpose an unrelated discovered control to imitate a story feature. When multiple categories are selected, distribute the suite across them where the supplied evidence genuinely supports doing so. SECURITY means evidence-supported security-functional checks only; do not invent vulnerabilities. PERFORMANCE means evidence-supported response/page timing checks only. ACCESSIBILITY means evidence-supported accessibility checks. API applies only when the supplied story/discovery supports an API-related scenario. LOAD and STRESS are planning/reporting categories in this browser flow; do not simulate concurrency or claim true load/stress execution through normal browser actions.`;
  if (categories.includes('SECURITY')) {
    instruction += `\n\nSECURITY SCOPE SELECTED BY THE HUMAN REVIEWER:\nSubcategories: ${securitySubcategories.join(', ')}\nSeverities: ${securitySeverities.join(', ')}\nFor every SECURITY case, include securitySubcategory and severity fields. Use only the selected security subcategories and severities. Severity describes security impact, not execution priority. Generate only safe security-functional checks grounded in the supplied story/page evidence. Dependency vulnerability scanning, active exploitation, network attacks, password spraying and destructive tests must not be represented as ordinary executable browser tests.`;
  }
  return instruction;
}

function applySelectedCategories(testCases, selectedCategories, story, securitySubcategories, securitySeverities) {
  const allowed = new Set(selectedCategories);
  return (testCases || []).map((testCase, index) => {
    let category = inferTestCategory({ story, testCase });
    if (!allowed.has(category)) category = selectedCategories.length === 1 ? selectedCategories[0] : selectedCategories[index % selectedCategories.length];
    const normalizedCategory = normalizeTestCategory(category);
    if (normalizedCategory !== 'SECURITY') return { ...testCase, testCategory: normalizedCategory, securitySubcategory: null, severity: null };
    let subcategory = normalizeSecuritySubcategory(testCase.securitySubcategory, inferSecuritySubcategory(testCase));
    if (!securitySubcategories.includes(subcategory)) subcategory = securitySubcategories.length === 1 ? securitySubcategories[0] : securitySubcategories[index % securitySubcategories.length];
    let severity = normalizeSecuritySeverity(testCase.severity || testCase.securitySeverity, inferSecuritySeverity(testCase));
    if (!securitySeverities.includes(severity)) severity = securitySeverities.length === 1 ? securitySeverities[0] : securitySeverities[index % securitySeverities.length];
    return { ...testCase, testCategory: normalizedCategory, securitySubcategory: subcategory, severity };
  });
}

function discoveryCacheKey(urls) { return [...urls].sort().join("\n"); }
function trimDiscoveryCache() { const now = Date.now(); for (const [key, entry] of discoveryCache.entries()) if (!entry || entry.expiresAt <= now) discoveryCache.delete(key); while (discoveryCache.size > DISCOVERY_CACHE_MAX) discoveryCache.delete(discoveryCache.keys().next().value); }
async function discoverPagesCached(urls, bypassCache = false) { if (bypassCache || !DISCOVERY_CACHE_TTL_MS) return { pages: await discoverPages(urls), cacheHit: false, bypassed: Boolean(bypassCache) }; trimDiscoveryCache(); const key = discoveryCacheKey(urls); const cached = discoveryCache.get(key); if (cached && cached.expiresAt > Date.now()) return { pages: cached.pages, cacheHit: true, bypassed: false }; const pages = await discoverPages(urls); discoveryCache.set(key, { pages, expiresAt: Date.now() + DISCOVERY_CACHE_TTL_MS }); trimDiscoveryCache(); return { pages, cacheHit: false, bypassed: false }; }

router.post("/api/chat", async (req, res) => {
  const {
    sessionId = "default", message = "", targetUrl: explicitTargetUrl, additionalPaths = [], credentials = null,
    selectedTestCategories = TEST_CATEGORIES,
    selectedSecuritySubcategories = SECURITY_SUBCATEGORIES,
    selectedSecuritySeverities = SECURITY_SEVERITIES,
    aiModelTier = process.env.AI_MODEL_DEFAULT || "strong", bypassDiscoveryCache = false,
  } = req.body || {};

  const session = getSession(sessionId);
  let stage = "request validation";

  try {
    if (session.state === "IDLE") {
      if (!qwen.isConfigured()) throw new Error("The configured AI provider is required for this demo.");
      const requestStartedAt = Date.now();
      const rawUrl = explicitTargetUrl || extractUrl(message);
      if (!rawUrl) throw new Error("Please provide a target URL.");
      const targetUrl = normalizeTargetUrl(rawUrl);
      const story = String(message || "").trim();
      if (!story) throw new Error("Please enter a business user story.");
      const categories = normalizeSelectedCategories(selectedTestCategories);
      const securitySubcategories = normalizeSelectedSecuritySubcategories(selectedSecuritySubcategories);
      const securitySeverities = normalizeSelectedSecuritySeverities(selectedSecuritySeverities);

      session.story = story; session.targetUrl = targetUrl; session.environment = FIXED_ENVIRONMENT; session.additionalPaths = Array.isArray(additionalPaths) ? additionalPaths : [];
      session.selectedTestCategories = categories; session.selectedSecuritySubcategories = securitySubcategories; session.selectedSecuritySeverities = securitySeverities;
      session.aiModelTier = normalizeProfile(aiModelTier);
      session.credentials = credentials && typeof credentials === "object" ? { username: String(credentials.username || ""), password: String(credentials.password || "") } : null;

      stage = "page discovery";
      const discoveryUrls = resolveDiscoveryUrls(targetUrl, session.additionalPaths);
      const discoveryStartedAt = Date.now();
      const discoveryResult = await discoverPagesCached(discoveryUrls, Boolean(bypassDiscoveryCache));
      session.pageDiscoveries = discoveryResult.pages;
      const discoveryMs = Date.now() - discoveryStartedAt;
      const modelDiscoveries = compactDiscoveriesForModel(session.pageDiscoveries);

      stage = "story/discovery validation";
      const compatibility = validateStoryDiscoveryCompatibility(story, modelDiscoveries);
      session.storyDiscoveryCompatibility = compatibility;
      if (!compatibility.compatible) {
        return res.status(422).json({
          reply: mismatchMessage(compatibility, targetUrl),
          code: "STORY_DISCOVERY_MISMATCH",
          scopeCompatibility: compatibility,
          pageDiscoveries: session.pageDiscoveries,
        });
      }

      stage = "AI test generation";
      const aiStartedAt = Date.now();
      const generationStory = `${story}${categoryGenerationInstruction(categories, securitySubcategories, securitySeverities)}`;
      const generated = await qwen.generateTestCases({ story: generationStory, pageDiscoveries: modelDiscoveries, environment: FIXED_ENVIRONMENT, modelTier: session.aiModelTier });
      const aiGenerationMs = Date.now() - aiStartedAt;

      stage = "scope test cases";
      const scopedCases = pruneGeneratedTestCases(generated.testCases, { story, pageDiscoveries: modelDiscoveries, maxCases: MAX_GENERATED_CASES });
      if (scopedCases.length !== generated.testCases.length) console.log(`[test-scope] Retained ${scopedCases.length}/${generated.testCases.length} distinct evidence-supported case(s); maximum=${MAX_GENERATED_CASES}.`);

      stage = "prepare human review";
      session.testCases = applySelectedCategories(scopedCases, categories, story, securitySubcategories, securitySeverities).map((tc) => ({ ...tc, source: "ai", automationReadiness: null }));
      session.automationReadiness = pendingReadinessSummary(session.testCases); session.readinessValidated = false; session.state = "AWAITING_APPROVAL";

      const totalMs = Date.now() - requestStartedAt;
      const cacheLabel = discoveryResult.cacheHit ? " cache-hit" : discoveryResult.bypassed ? " cache-bypassed" : " fresh";
      console.log(`[test-generation] profile=${session.aiModelTier} discovery=${discoveryMs}ms${cacheLabel} ai=${aiGenerationMs}ms total=${totalMs}ms pages=${session.pageDiscoveries.length} cases=${session.testCases.length} categories=${categories.join(",")}`);

      return res.json({
        reply: `AI generated ${session.testCases.length} story-driven test case(s), up to the configured maximum of ${MAX_GENERATED_CASES}, from ${session.pageDiscoveries.length} discovered page(s). Selected categories: ${categories.join(", ")}. They are available for human review now; automation readiness is being checked separately.\n\n${formatTestCaseList(session.testCases)}`,
        feature: generated.feature || null, testCases: session.testCases, pageDiscoveries: session.pageDiscoveries,
        automationReadiness: session.automationReadiness, readinessPending: true, selectedTestCategories: categories,
        selectedSecuritySubcategories: securitySubcategories, selectedSecuritySeverities: securitySeverities,
        maxGeneratedCases: MAX_GENERATED_CASES, aiModelTier: session.aiModelTier,
        storyDiscoveryCompatibility: compatibility,
        generationTiming: { discoveryMs, discoveryCacheHit: discoveryResult.cacheHit, discoveryCacheBypassed: discoveryResult.bypassed, aiGenerationMs, totalMs },
      });
    }

    if (session.state === "AWAITING_APPROVAL") return res.status(409).json({ reply: session.readinessValidated ? "Test cases are awaiting human review." : "Test cases are awaiting human review while automation readiness is still being checked.", testCases: session.testCases, automationReadiness: session.automationReadiness || readinessSummary(session.testCases || []), readinessPending: !session.readinessValidated });
    return res.json({ reply: "This run is complete. Start a new story to create another run.", summary: session.lastResults?.summary || null, failureAnalyses: session.failureAnalyses || [], reportUrl: session.reportHtml ? `/api/reports/${encodeURIComponent(sessionId)}` : null });
  } catch (err) {
    console.error(`[api/chat] failed during ${stage}:`, err);
    return res.status(500).json({ reply: `Generation failed during ${stage}: ${err.message}` });
  }
});

router.get("/api/reports/:sessionId", (req, res) => { const session = getSession(req.params.sessionId); if (!session.reportHtml) return res.status(404).send("Report not found or the run has not completed."); res.type("html").send(session.reportHtml); });
router.get("/api/artifacts/:sessionId/video/:testCaseId", (req, res) => { const session = getSession(req.params.sessionId); const testCaseId = String(req.params.testCaseId || "").toUpperCase(); if (!TEST_ID_REGEX.test(testCaseId)) return res.status(400).send("Invalid test case id."); const filePath = session.artifacts?.videosByTestCase?.[testCaseId]; if (!filePath || !fs.existsSync(filePath)) return res.status(404).send("Video evidence not found."); res.sendFile(filePath); });
router.get("/api/artifacts/:sessionId/screenshot/:testCaseId", (req, res) => { const session = getSession(req.params.sessionId); const testCaseId = String(req.params.testCaseId || "").toUpperCase(); if (!TEST_ID_REGEX.test(testCaseId)) return res.status(400).send("Invalid test case id."); const filePath = session.artifacts?.screenshotsByTestCase?.[testCaseId]; if (!filePath || !fs.existsSync(filePath)) return res.status(404).send("Screenshot evidence not found."); res.sendFile(filePath); });
router.post("/api/reset", (req, res) => { const { sessionId = "default" } = req.body || {}; resetSession(sessionId); res.json({ ok: true }); });

module.exports = router;

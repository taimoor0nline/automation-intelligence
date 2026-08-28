const { modelForProfile } = require("./aiModelProfiles");
const { assertionCatalog, ASSERTION_OPERATION_SET } = require("./assertionRegistry");
const { compileTestCase } = require("./automationDsl");

function numberEnv(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const REQUEST_TIMEOUT_MS = Math.max(30000, Math.min(numberEnv(process.env.QWEN_TIMEOUT_MS, 180000), 600000));

function ensureConfigured() {
  if (!process.env.QWEN_API_KEY || !process.env.QWEN_BASE_URL) throw new Error("AI provider is not configured on the server.");
}

function parseJson(raw) {
  return JSON.parse(String(raw || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim());
}

async function callModel(systemPrompt, payload, modelTier = "fast") {
  ensureConfigured();
  const { model } = modelForProfile(modelTier);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${process.env.QWEN_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.QWEN_API_KEY}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: JSON.stringify(payload) }],
        response_format: { type: "json_object" },
        temperature: 0.03,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`AI provider returned ${response.status}: ${body.slice(0, 250)}`);
    }
    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) throw new Error("AI provider returned an empty response.");
    return parseJson(raw);
  } finally {
    clearTimeout(timeout);
  }
}

const SINGLE_CASE_PROMPT = `You are a senior QA analyst generating exactly ONE test case requested by a human reviewer.
The human request defines the desired scenario. The supplied business story provides context. Page discovery is the only evidence for pages, controls, selectors, routes, messages, options and validation metadata.
Rules:
- Generate exactly one candidate test case and preserve the requested business intent.
- Never invent selectors, pages, routes, controls, messages, validation rules or business constraints.
- Use exact discovered selectors.
- If a field must intentionally remain empty, use an action such as "clear" or "leave blank" for that selector; do NOT emit a fill/type action with an empty or null value.
- If runtime credentials are needed, describe the dependency; never include actual credentials.
- Do not make unsupported behavior appear automatable by removing an essential requirement.
- Return JSON only.
Schema: {"testCase":{"title":string,"type":"positive"|"negative"|"boundary"|"functional"|"custom","priority":"low"|"medium"|"high","preconditions":[string],"testData":object,"steps":[{"action":string,"target":string,"value":string|null}],"expectedResults":[string]}}`;

const REPAIR_CASE_PROMPT = `You are a constrained QA test-case repair assistant. Repair ONLY the deterministic validation problem supplied by the automation system.
Hard rules:
- Preserve the original business intent and expected behaviour.
- Never delete, weaken or replace an essential requirement merely to make the case automatable.
- Use only supplied page-discovery evidence. Never invent selectors, routes, controls, messages or capabilities.
- A fill/type/input action must contain a non-empty value. If the business intent is to leave a discovered input empty, represent that as a "clear" or "leave blank" action with the same selector, not fill/type with "" or null.
- If the issue cannot be repaired without changing intent or inventing evidence, return repaired=false.
- Do not modify the test-case id or include secrets.
- Return JSON only.
Schema: {"repaired":boolean,"explanation":string,"testCase":{"id":string,"title":string,"type":"positive"|"negative"|"boundary"|"functional"|"custom","priority":"low"|"medium"|"high","preconditions":[string],"testData":object,"steps":[{"action":string,"target":string,"value":string|null}],"expectedResults":[string]}}`;

const ASSERTION_SUGGESTION_PROMPT = `You are a Cypress assertion capability advisor for a deterministic test-automation platform.
Preserve exact business intent. Prefer an EXISTING supported assertion when it legitimately represents the expected result; otherwise propose one allow-listed-style ASSERT_* capability and a concise Cypress strategy. Return MANUAL only for behavior browser automation should not attempt. Never emit arbitrary executable code or invent selectors. Return JSON only.
Schema: {"kind":"USE_EXISTING"|"ADD_ASSERTION"|"MANUAL","operation":string|null,"title":string,"rationale":string,"cypressStrategy":string,"dependency":string|null,"expectedResult":string}`;

function normalizeCandidate(raw, id, source) {
  const tc = raw && typeof raw === "object" ? raw : {};
  return {
    id,
    title: String(tc.title || "").trim(),
    type: ["positive", "negative", "boundary", "functional", "custom"].includes(String(tc.type || "").toLowerCase()) ? String(tc.type).toLowerCase() : "functional",
    priority: ["low", "medium", "high"].includes(String(tc.priority || "").toLowerCase()) ? String(tc.priority).toLowerCase() : "medium",
    preconditions: Array.isArray(tc.preconditions) ? tc.preconditions.map((v) => String(v).trim()).filter(Boolean).slice(0, 20) : [],
    testData: tc.testData && typeof tc.testData === "object" && !Array.isArray(tc.testData) ? tc.testData : {},
    steps: Array.isArray(tc.steps) ? tc.steps.map((step) => ({
      action: String(step?.action || "").trim(),
      target: String(step?.target || "").trim(),
      value: step?.value === null || step?.value === undefined ? null : String(step.value),
    })).filter((step) => step.action || step.target).slice(0, 30) : [],
    expectedResults: Array.isArray(tc.expectedResults) ? tc.expectedResults.map((v) => String(v).trim()).filter(Boolean).slice(0, 20) : [],
    source,
  };
}

function deterministicEmptyFieldRepair(testCase, readiness) {
  const reason = String(readiness?.reason || "");
  const target = reason.match(/Typing step is missing a value for\s+(.+)$/i)?.[1]?.trim();
  if (!target) return null;
  const index = (testCase.steps || []).findIndex((step) => {
    const action = String(step?.action || "").toLowerCase();
    const value = step?.value;
    return String(step?.target || "").trim() === target && /enter|type|fill|input/.test(action) && (value === null || value === undefined || String(value) === "");
  });
  if (index < 0) return null;
  const steps = (testCase.steps || []).map((step, i) => i === index ? { action: "clear", target, value: null } : { ...step });
  return normalizeCandidate({ ...testCase, steps }, testCase.id, testCase.source === "ai-on-demand" ? "ai-on-demand" : "ai-repaired");
}

function verifyRepairCandidate(candidate, pageDiscoveries) {
  const compiled = compileTestCase(candidate, { pageDiscoveries, hasCredentials: true });
  if (compiled.ok) return { ok: true, compiled };
  return { ok: false, reason: compiled.reason || compiled.errors?.[0] || compiled.reasonCode || "The repaired candidate still does not satisfy the deterministic automation contract." };
}

async function generateSingleTestCase({ id, requestText, story, pageDiscoveries, modelTier = "fast" }) {
  const result = await callModel(SINGLE_CASE_PROMPT, { requestText, businessStory: story, pageDiscoveries, supportedAssertions: assertionCatalog() }, modelTier);
  return normalizeCandidate(result?.testCase, id, "ai-on-demand");
}

async function repairTestCase({ testCase, readiness, story, pageDiscoveries, modelTier = "fast" }) {
  const deterministic = deterministicEmptyFieldRepair(testCase, readiness);
  if (deterministic) {
    const verification = verifyRepairCandidate(deterministic, pageDiscoveries);
    if (verification.ok) {
      return { repaired: true, explanation: "Converted the empty fill/type step to an explicit clear action so the field remains intentionally empty while satisfying the deterministic automation contract.", testCase: deterministic };
    }
  }

  const result = await callModel(REPAIR_CASE_PROMPT, {
    businessStory: story,
    originalTestCase: testCase,
    deterministicReadiness: readiness,
    pageDiscoveries,
    supportedAssertions: assertionCatalog(),
  }, modelTier);

  if (!result?.repaired) return { repaired: false, explanation: String(result?.explanation || "The issue could not be repaired without changing test intent or inventing evidence."), testCase };

  const candidate = normalizeCandidate(result.testCase, testCase.id, testCase.source === "ai-on-demand" ? "ai-on-demand" : "ai-repaired");
  const verification = verifyRepairCandidate(candidate, pageDiscoveries);
  if (!verification.ok) {
    return {
      repaired: false,
      explanation: `AI proposed a change, but deterministic revalidation still rejected it: ${verification.reason}`,
      testCase,
    };
  }

  return { repaired: true, explanation: String(result.explanation || "The candidate test case was corrected using discovered application evidence."), testCase: candidate };
}

async function suggestAssertionCapability({ testCase, readiness, story, pageDiscoveries, modelTier = "fast" }) {
  const result = await callModel(ASSERTION_SUGGESTION_PROMPT, {
    businessStory: story,
    testCase,
    deterministicReadiness: readiness,
    uncompiledExpectations: readiness?.uncompiledExpectations || readiness?.automationPlan?.narrativeExpectations || [],
    deterministicHints: readiness?.assertionSuggestions || readiness?.automationPlan?.assertionSuggestions || [],
    supportedAssertions: assertionCatalog(),
    pageDiscoveries,
  }, modelTier);

  let kind = ["USE_EXISTING", "ADD_ASSERTION", "MANUAL"].includes(String(result?.kind || "").toUpperCase()) ? String(result.kind).toUpperCase() : "ADD_ASSERTION";
  let operation = result?.operation ? String(result.operation).trim().toUpperCase() : null;
  if (kind === "USE_EXISTING" && (!operation || !ASSERTION_OPERATION_SET.has(operation))) kind = "ADD_ASSERTION";
  if (kind === "ADD_ASSERTION" && operation && !/^ASSERT_[A-Z0-9_]+$/.test(operation)) operation = null;

  return {
    kind,
    operation,
    title: String(result?.title || (kind === "USE_EXISTING" ? "Use an existing assertion" : "Add a Cypress assertion capability")).trim().slice(0, 200),
    rationale: String(result?.rationale || "This expectation needs an explicit assertion mapping before deterministic execution.").trim().slice(0, 1200),
    cypressStrategy: String(result?.cypressStrategy || "Add an allow-listed deterministic Cypress assertion handler and parser mapping.").trim().slice(0, 1200),
    dependency: result?.dependency ? String(result.dependency).trim().slice(0, 120) : null,
    expectedResult: String(result?.expectedResult || readiness?.uncompiledExpectations?.[0] || "").trim().slice(0, 600),
    supportedNow: kind === "USE_EXISTING" && Boolean(operation && ASSERTION_OPERATION_SET.has(operation)),
  };
}

module.exports = { generateSingleTestCase, repairTestCase, suggestAssertionCapability };

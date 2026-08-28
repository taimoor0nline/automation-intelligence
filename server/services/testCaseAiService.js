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
- Steps contain browser ACTIONS only. Do not put ASSERT_* operations, verify_text, assert_text or other assertion pseudo-actions in steps. Assertions belong in expectedResults.
- If a field must intentionally remain empty, use an action such as "clear" or "leave blank" for that selector; do NOT emit a fill/type action with an empty or null value.
- If runtime credentials are needed, describe the dependency; never include actual credentials.
- Do not make unsupported behavior appear automatable by removing an essential requirement.
- Return JSON only.
Schema: {"testCase":{"title":string,"type":"positive"|"negative"|"boundary"|"functional"|"custom","priority":"low"|"medium"|"high","preconditions":[string],"testData":object,"steps":[{"action":string,"target":string,"value":string|null}],"expectedResults":[string]}}`;

const REPAIR_CASE_PROMPT = `You are a constrained QA test-case repair assistant. Repair ONLY the deterministic validation problems supplied by the automation system.
Hard rules:
- Preserve the original business intent and expected behaviour.
- Never delete, weaken or replace an essential requirement merely to make the case automatable.
- Use only supplied page-discovery evidence. Never invent selectors, routes, controls, messages or capabilities.
- Steps contain browser ACTIONS only. Never put ASSERT_* operations, verify_text, assert_text, check_text or other assertion pseudo-actions in steps. Express assertions in expectedResults using the grounded selector.
- A fill/type/input action must contain a non-empty value. If the business intent is to leave a discovered input empty, represent that as a "clear" or "leave blank" action with the same selector, not fill/type with "" or null.
- For exact text validation, use an expected result such as: Text equals "Expected message" in [data-testid="..."]
- For contains text validation, use an expected result such as: Text contains "Expected fragment" in [data-testid="..."]
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

function quotedValues(text) {
  const values = [];
  const regex = /["'`]([^"'`]+)["'`]/g;
  let match;
  while ((match = regex.exec(String(text || ""))) !== null) values.push(match[1]);
  return values;
}

function isVerificationAction(action) {
  const normalized = String(action || "").trim().toLowerCase().replace(/[_-]+/g, " ");
  return /^assert\b/.test(normalized) || /^verify\b/.test(normalized) || /^check\s+text\b/.test(normalized) || /^validate\s+text\b/.test(normalized);
}

function textExpectationKind(text) {
  const value = String(text || "").toLowerCase();
  if (/contains?|includes?|has text/.test(value)) return "contains";
  if (/matches?|equals?|exactly|exact match|same text/.test(value)) return "equals";
  return "";
}

function canonicalTextExpectation(target, value, kind = "equals") {
  if (!target || value === null || value === undefined || String(value) === "") return "";
  const escaped = String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `Text ${kind === "contains" ? "contains" : "equals"} "${escaped}" in ${target}`;
}

function attachSelectorToTextExpectation(expectedResults, target, preferredValue = null, preferredKind = "") {
  const next = [...(expectedResults || [])];
  if (!target) return { expectedResults: next, attached: false };

  if (preferredValue !== null && preferredValue !== undefined && String(preferredValue) !== "") {
    const canonical = canonicalTextExpectation(target, preferredValue, preferredKind || "equals");
    if (canonical && !next.includes(canonical)) next.push(canonical);
    return { expectedResults: next, attached: Boolean(canonical) };
  }

  for (let i = 0; i < next.length; i += 1) {
    const expectation = String(next[i] || "");
    if (expectation.includes(target)) continue;
    const values = quotedValues(expectation);
    const message = values.length ? values[values.length - 1] : "";
    const kind = textExpectationKind(expectation);
    if (!message || !kind || !/(?:text|message|error|label|content)/i.test(expectation)) continue;
    next[i] = canonicalTextExpectation(target, message, kind);
    return { expectedResults: next, attached: true };
  }

  return { expectedResults: next, attached: false };
}

function deterministicContractRepair(testCase) {
  const source = testCase.source === "ai-on-demand" ? "ai-on-demand" : "ai-repaired";
  let expectedResults = [...(testCase.expectedResults || [])];
  const steps = [];
  const changes = [];

  for (const originalStep of testCase.steps || []) {
    const step = { ...originalStep };
    const action = String(step.action || "").trim();
    const normalizedAction = action.toLowerCase().replace(/[_-]+/g, " ");
    const target = String(step.target || "").trim();
    const value = step.value;

    if (/^(?:enter|type|fill|input)\b/.test(normalizedAction) && (value === null || value === undefined || String(value) === "")) {
      steps.push({ action: "clear", target, value: null });
      changes.push(`converted empty ${action || "fill"} to clear for ${target}`);
      continue;
    }

    if (isVerificationAction(action) || /^ASSERT_[A-Z0-9_]+$/i.test(action)) {
      let kind = textExpectationKind(action);
      if (/TEXT_CONTAINS/i.test(action)) kind = "contains";
      if (/TEXT_EQUALS/i.test(action)) kind = "equals";
      const attached = attachSelectorToTextExpectation(expectedResults, target, value, kind);
      expectedResults = attached.expectedResults;
      if (attached.attached) {
        changes.push(`moved verification step ${action} into expected results for ${target}`);
        continue;
      }
    }

    steps.push(step);
  }

  if (!changes.length) return null;
  return {
    testCase: normalizeCandidate({ ...testCase, steps, expectedResults }, testCase.id, source),
    changes,
  };
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
  const deterministic = deterministicContractRepair(testCase);
  if (deterministic) {
    const verification = verifyRepairCandidate(deterministic.testCase, pageDiscoveries);
    if (verification.ok) {
      return {
        repaired: true,
        explanation: `Normalized the test into the deterministic automation contract: ${deterministic.changes.join("; ")}.`,
        testCase: deterministic.testCase,
      };
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

  let candidate = normalizeCandidate(result.testCase, testCase.id, testCase.source === "ai-on-demand" ? "ai-on-demand" : "ai-repaired");
  const normalizedAiCandidate = deterministicContractRepair(candidate);
  if (normalizedAiCandidate) candidate = normalizedAiCandidate.testCase;

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

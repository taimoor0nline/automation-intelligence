const { modelForProfile } = require("./aiModelProfiles");

function numberEnv(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const REQUEST_TIMEOUT_MS = Math.max(30000, Math.min(numberEnv(process.env.QWEN_TIMEOUT_MS, 180000), 600000));

function ensureConfigured() {
  if (!process.env.QWEN_API_KEY || !process.env.QWEN_BASE_URL) {
    throw new Error("AI provider is not configured on the server.");
  }
}

function parseJson(raw) {
  const cleaned = String(raw || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  return JSON.parse(cleaned);
}

async function callModel(systemPrompt, payload, modelTier = "fast") {
  ensureConfigured();
  const { model } = modelForProfile(modelTier);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${process.env.QWEN_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.QWEN_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(payload) },
        ],
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
The human request defines the desired scenario. The supplied business story provides surrounding business context. Page discovery is the only evidence for pages, controls, selectors, routes, messages, options and validation metadata.

Rules:
- Generate exactly one candidate test case.
- Preserve the human's requested business intent. Do not broaden it.
- Never invent selectors, pages, routes, controls, messages, validation rules or business constraints.
- Use exact discovered selectors when a selector is needed.
- If valid runtime credentials are needed, describe that as a precondition/action; never include actual credentials.
- Do not make an unsupported scenario appear automatable by removing or replacing its essential requirement.
- Steps and expected results must be concrete enough for deterministic readiness checks.
- Return JSON only.

Schema:
{
  "testCase": {
    "title": string,
    "type": "positive"|"negative"|"boundary"|"functional"|"custom",
    "priority": "low"|"medium"|"high",
    "preconditions": [string],
    "testData": object,
    "steps": [{"action": string, "target": string, "value": string|null}],
    "expectedResults": [string]
  }
}`;

const REPAIR_CASE_PROMPT = `You are a constrained QA test-case repair assistant.
Repair ONLY the deterministic validation problem supplied by the automation system.

Hard rules:
- Preserve the original business intent and expected behaviour.
- Never delete, weaken or replace an essential business requirement merely to make the case automatable.
- Use only supplied page-discovery evidence.
- Never invent a selector, page, route, control, validation rule, message, option or automation capability.
- If the supplied reason cannot be repaired without changing business intent or inventing evidence, return repaired=false and explain why.
- Do not modify the test-case id.
- Do not include secrets or runtime credential values.
- Return JSON only.

Schema:
{
  "repaired": boolean,
  "explanation": string,
  "testCase": {
    "id": string,
    "title": string,
    "type": "positive"|"negative"|"boundary"|"functional"|"custom",
    "priority": "low"|"medium"|"high",
    "preconditions": [string],
    "testData": object,
    "steps": [{"action": string, "target": string, "value": string|null}],
    "expectedResults": [string]
  }
}`;

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

async function generateSingleTestCase({ id, requestText, story, pageDiscoveries, modelTier = "fast" }) {
  const result = await callModel(SINGLE_CASE_PROMPT, {
    requestText,
    businessStory: story,
    pageDiscoveries,
  }, modelTier);
  return normalizeCandidate(result?.testCase, id, "ai-on-demand");
}

async function repairTestCase({ testCase, readiness, story, pageDiscoveries, modelTier = "fast" }) {
  const result = await callModel(REPAIR_CASE_PROMPT, {
    businessStory: story,
    originalTestCase: testCase,
    deterministicReadiness: readiness,
    pageDiscoveries,
  }, modelTier);

  if (!result?.repaired) {
    return { repaired: false, explanation: String(result?.explanation || "The issue could not be repaired without changing test intent or inventing evidence."), testCase };
  }

  return {
    repaired: true,
    explanation: String(result.explanation || "The candidate test case was corrected using discovered application evidence."),
    testCase: normalizeCandidate(result.testCase, testCase.id, testCase.source === "ai-on-demand" ? "ai-on-demand" : "ai-repaired"),
  };
}

module.exports = { generateSingleTestCase, repairTestCase };

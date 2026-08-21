/**
 * Qwen Client
 * -----------
 * Thin wrapper around Alibaba Cloud Model Studio (Qwen).
 *
 * Set QWEN_API_KEY + QWEN_BASE_URL + QWEN_MODEL in .env to hit the real API.
 * With no key configured, every method falls back to a deterministic mock
 * so the full pipeline (story -> test cases -> approval -> Cypress code ->
 * execution -> failure analysis) can be demoed end-to-end without a live key.
 *
 * IMPORTANT: this file is the ONLY place that should ever call the Qwen API.
 * Never call it from the frontend / chat-ui.
 */
const USE_REAL_QWEN = Boolean(process.env.QWEN_API_KEY && process.env.QWEN_BASE_URL);
const QWEN_MODEL = process.env.QWEN_MODEL || "qwen3.7-plus";

const { mockGenerateTestCases } = require("./mock/mockTestCases");
const { mockGenerateCypressCode } = require("./mock/mockCypressCode");
const { mockAnalyzeFailure } = require("./mock/mockFailureAnalysis");

async function callQwenReal(systemPrompt, userPayload) {
  const res = await fetch(`${process.env.QWEN_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.QWEN_API_KEY}`,
    },
    body: JSON.stringify({
      model: QWEN_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(userPayload) },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    throw new Error(`Qwen API error: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content ?? "{}";
  return JSON.parse(raw);
}

const SYSTEM_PROMPTS = {
  TEST_ANALYST_V1: `You are a senior QA test analyst. Given a business story, acceptance
criteria, and a page-control inventory, produce 15-25 structured test cases covering
positive, negative, and boundary scenarios. Return JSON only, matching the required schema.`,

  PLAYWRIGHT_GENERATOR_V1: `You are a senior QA automation engineer. Generate Cypress
JavaScript tests only for the supplied approved test cases. Prefer semantic selectors
(cy.findByLabelText, cy.findByRole) and stable data-testid fallbacks. Never invent fields
not present in the page discovery data. No fixed waits/cy.wait(ms). Return JSON only.`,

  FAILURE_ANALYST_V1: `You are a QA failure analyst. Given a business requirement, the
test case, expected result, and actual error, classify the failure and explain it in
plain business language. Return JSON only.`,
};

async function generateTestCases({ story, acceptanceCriteria, pageDiscovery, environment, priority }) {
  if (USE_REAL_QWEN) {
    return callQwenReal(SYSTEM_PROMPTS.TEST_ANALYST_V1, {
      story, acceptanceCriteria, pageDiscovery, environment, priority,
    });
  }
  return mockGenerateTestCases({ story, acceptanceCriteria, pageDiscovery });
}

async function generateCypressCode({ approvedTestCases, pageDiscovery, fileName }) {
  if (USE_REAL_QWEN) {
    return callQwenReal(SYSTEM_PROMPTS.PLAYWRIGHT_GENERATOR_V1, {
      approvedTestCases, pageDiscovery, fileName,
    });
  }
  return mockGenerateCypressCode({ approvedTestCases, pageDiscovery, fileName });
}

async function analyzeFailure({ story, acceptanceCriteria, testCase, expected, actual, consoleErrors }) {
  if (USE_REAL_QWEN) {
    return callQwenReal(SYSTEM_PROMPTS.FAILURE_ANALYST_V1, {
      story, acceptanceCriteria, testCase, expected, actual, consoleErrors,
    });
  }
  return mockAnalyzeFailure({ testCase, expected, actual });
}

module.exports = {
  generateTestCases,
  generateCypressCode,
  analyzeFailure,
  isUsingRealQwen: () => USE_REAL_QWEN,
  QWEN_MODEL,
};

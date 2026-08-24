const QWEN_MODEL = process.env.QWEN_MODEL || "qwen3.7-flash";
const REQUEST_TIMEOUT_MS = 90000;
const MAX_RETRIES = 1;
const TEST_CASE_COUNT = Math.max(1, Math.min(Number(process.env.AI_TEST_CASE_COUNT || 5) || 5, 20));

function isConfigured() {
  return Boolean(process.env.QWEN_API_KEY && process.env.QWEN_BASE_URL);
}

function ensureConfigured() {
  if (!isConfigured()) {
    throw new Error("Qwen is not configured. Set QWEN_API_KEY and QWEN_BASE_URL in your local .env file.");
  }
}

function parseJsonContent(raw) {
  const cleaned = String(raw || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error("Qwen returned invalid JSON. Retry the generation.");
  }
}

async function callQwen(systemPrompt, userPayload, attempt = 0) {
  ensureConfigured();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const endpoint = `${process.env.QWEN_BASE_URL.replace(/\/$/, "")}/chat/completions`;
    const res = await fetch(endpoint, {
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
        temperature: 0.1,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status >= 500 && attempt < MAX_RETRIES) return callQwen(systemPrompt, userPayload, attempt + 1);
      if (res.status === 401 || res.status === 403) {
        throw new Error(`Qwen authentication failed (${res.status}). Check the key and Model Studio region/base URL.`);
      }
      throw new Error(`Qwen API error (${res.status}): ${body.slice(0, 400)}`);
    }

    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) throw new Error("Qwen returned an empty response.");
    return parseJsonContent(raw);
  } catch (err) {
    if (err.name === "AbortError") {
      if (attempt < MAX_RETRIES) return callQwen(systemPrompt, userPayload, attempt + 1);
      throw new Error(`Qwen request timed out after ${REQUEST_TIMEOUT_MS / 1000}s.`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

const TEST_ANALYST_PROMPT = `You are a senior QA test analyst.
Convert the supplied business user story and discovered web-page inventory into a concise set of executable test cases.

Rules:
- Generate EXACTLY requestedTestCaseCount test cases. Do not generate more or fewer.
- Cover only behaviour that appears in the business story and discovered page inventory.
- Include a useful mix of positive, negative, validation and boundary coverage.
- Tests must describe the EXPECTED behaviour. Never manufacture an assertion just to make a test fail. A failed run should mean the real application did not meet the expected behaviour.
- For a five-case demo, use this shape when the discovered controls support it: one positive end-to-end journey, one authentication/required-field negative case, one later-form required-field case, and two defect-detection validation/boundary cases.
- DEMO CALIBRATION: if the discovered feedback form contains an Age field with min=18, TC004 MUST test age 17 and expect the submission to be rejected by the age rule. If the discovered feedback form contains a Website field of type=url, TC005 MUST use the malformed value "abc" and expect the submission to be rejected by the website URL rule. These are legitimate expected-behaviour tests derived from discovered constraints; do not describe them as intentionally failing tests.
- When the story and discovered controls contain explicit boundaries, formats or validation constraints, prioritize them because they are good defect-detection scenarios.
- Treat the supplied page inventory as the source of truth. Never invent fields, pages, buttons, selectors, messages or dropdown values.
- Multi-page journeys are allowed. If the story describes login followed by another page, create end-to-end cases that reflect that flow.
- Do not include actual passwords or secrets in test data.
- Each case must be independently understandable and have concrete expected results.

Return JSON only using:
{
  "feature": string,
  "testCases": [
    {
      "id": "TC001",
      "title": string,
      "type": "positive"|"negative"|"boundary"|"functional",
      "priority": "low"|"medium"|"high",
      "preconditions": [string],
      "testData": object,
      "steps": [{"action": string, "target": string, "value": string|null}],
      "expectedResults": [string]
    }
  ]
}`;

const AUTOMATION_GENERATOR_PROMPT = `You are a senior browser automation engineer.
Generate a complete JavaScript end-to-end spec for ONLY the approved test cases using the current runtime's cy.* API.

STRICT RULES:
1. Use only selectors, data-testid values, ids, names, messages, option values and URLs that appear in pageDiscoveries.
2. Never invent a selector or assertion text.
3. Prefer data-testid, then id, then name.
4. Use relative paths with cy.visit() when pages share the supplied base URL.
5. If login credentials are available, NEVER hardcode them. Read them securely with:
   cy.env(['TEST_USERNAME','TEST_PASSWORD'], { log: false }).then(({ TEST_USERNAME, TEST_PASSWORD }) => { ... })
   and type them with { log: false }.
6. Do not send credential values to logs, assertions, screenshots, titles or comments.
7. For a login journey, use the discovered username/password fields and discovered login button, then assert the discovered destination/page outcome.
8. Before testing a validation rule on a later form, populate the other required fields with valid values using only discovered controls/options.
9. No numeric cy.wait(). No child_process, fs, eval, Function, network modules or arbitrary Node code.
10. Assertions must use real discovered elements/messages. For a rejection/validation case, assert the discovered field-specific error element becomes visible/non-empty and/or the discovered success state remains absent. Do not use a weak assertion that can pass even when invalid data is accepted.
11. Every approved test case must map to one it() block whose title begins with its TC id.
12. For an age-minimum case using 17, the assertion must prove the age rule rejected 17. For an invalid-website case using "abc", the assertion must prove the URL rule rejected "abc".

Return JSON only:
{"fileName": string, "framework": "browser-automation", "language": "javascript", "script": string}`;

const FAILURE_ANALYST_PROMPT = `You are a QA failure analyst.
Classify a failed automated test using the business story, test case, expected result and actual browser-automation error.
Do not assume the application is wrong: selector/generator mistakes are AUTOMATION_DEFECT, bad input is TEST_DATA_PROBLEM, unreachable systems are ENVIRONMENT_PROBLEM.
Return JSON only:
{
  "summary": string,
  "classification": "APPLICATION_DEFECT"|"AUTOMATION_DEFECT"|"TEST_DATA_PROBLEM"|"ENVIRONMENT_PROBLEM"|"REQUIREMENT_AMBIGUITY"|"UNKNOWN",
  "expected": string,
  "actual": string,
  "probableCause": string,
  "severity": "low"|"medium"|"high",
  "confidence": number
}`;

function validateTestCases(result, requestedCount = TEST_CASE_COUNT) {
  if (!result || !Array.isArray(result.testCases) || result.testCases.length === 0) {
    throw new Error("Qwen response did not contain testCases.");
  }
  if (result.testCases.length !== requestedCount) {
    throw new Error(`Qwen returned ${result.testCases.length} test cases; this demo requires exactly ${requestedCount}. Retry generation.`);
  }
  result.testCases.forEach((tc, i) => {
    if (!tc.id || !tc.title || !Array.isArray(tc.steps) || !Array.isArray(tc.expectedResults)) {
      throw new Error(`Qwen test case ${i + 1} is missing required fields.`);
    }
    if (!/^TC\d{3}$/i.test(tc.id)) {
      throw new Error(`Qwen test case ${i + 1} has invalid id '${tc.id}'. Expected TC001 style ids.`);
    }
  });
  return result;
}

function validateAutomation(result) {
  if (!result || typeof result.script !== "string" || !result.script.includes("describe(") || !result.script.includes("it(")) {
    throw new Error("Qwen did not return a valid automation spec.");
  }
  if (result.script.length > 200000) throw new Error("Generated automation spec is unexpectedly large.");
  return {
    fileName: result.fileName || "ai-generated.cy.js",
    framework: "browser-automation",
    language: "javascript",
    script: result.script,
  };
}

function validateFailure(result) {
  const allowed = new Set([
    "APPLICATION_DEFECT",
    "AUTOMATION_DEFECT",
    "TEST_DATA_PROBLEM",
    "ENVIRONMENT_PROBLEM",
    "REQUIREMENT_AMBIGUITY",
    "UNKNOWN",
  ]);
  if (!result || typeof result.summary !== "string") throw new Error("Qwen failure analysis was invalid.");
  if (!allowed.has(result.classification)) result.classification = "UNKNOWN";
  if (typeof result.confidence !== "number" || result.confidence < 0 || result.confidence > 1) result.confidence = 0.5;
  return result;
}

async function generateTestCases({ story, pageDiscoveries, environment }) {
  const result = await callQwen(TEST_ANALYST_PROMPT, {
    story,
    pageDiscoveries,
    environment,
    requestedTestCaseCount: TEST_CASE_COUNT,
  });
  return validateTestCases(result, TEST_CASE_COUNT);
}

async function generateAutomationCode({ approvedTestCases, pageDiscoveries, fileName, executionContext }) {
  const result = await callQwen(AUTOMATION_GENERATOR_PROMPT, {
    approvedTestCases,
    pageDiscoveries,
    fileName,
    executionContext: {
      baseUrl: executionContext.baseUrl,
      hasCredentials: Boolean(executionContext.hasCredentials),
      credentialKeys: executionContext.hasCredentials ? ["TEST_USERNAME", "TEST_PASSWORD"] : [],
    },
  });
  return validateAutomation(result);
}

async function analyzeFailure({ story, testCase, expected, actual }) {
  const result = await callQwen(FAILURE_ANALYST_PROMPT, { story, testCase, expected, actual });
  return validateFailure(result);
}

module.exports = {
  generateTestCases,
  generateAutomationCode,
  analyzeFailure,
  isConfigured,
  QWEN_MODEL,
  TEST_CASE_COUNT,
};

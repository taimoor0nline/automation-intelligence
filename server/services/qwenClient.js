/**
 * Qwen Client
 * -----------
 * Thin wrapper around Alibaba Cloud Model Studio (Qwen), OpenAI-compatible mode.
 *
 * Set QWEN_API_KEY + QWEN_BASE_URL + QWEN_MODEL in .env to hit the real API.
 * With no key configured, every method falls back to a deterministic mock.
 *
 * IMPORTANT: this file is the ONLY place that should ever call the Qwen API.
 * Never call it from the frontend / chat-ui.
 */
const USE_REAL_QWEN = Boolean(process.env.QWEN_API_KEY && process.env.QWEN_BASE_URL);
const QWEN_MODEL = process.env.QWEN_MODEL || "qwen-plus";
const REQUEST_TIMEOUT_MS = 60000;
const MAX_RETRIES = 1; // one retry on transient (5xx/network) failure only

const { mockGenerateTestCases } = require("./mock/mockTestCases");
const { mockGenerateCypressCode } = require("./mock/mockCypressCode");
const { mockAnalyzeFailure } = require("./mock/mockFailureAnalysis");

async function callQwenReal(systemPrompt, userPayload, attempt = 0) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
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
      signal: controller.signal,
    });

    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      // Retry once on server-side/transient errors; never retry on 4xx (bad key, bad request).
      if (res.status >= 500 && attempt < MAX_RETRIES) {
        return callQwenReal(systemPrompt, userPayload, attempt + 1);
      }
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          `Qwen API auth error (${res.status}). Check QWEN_API_KEY and that QWEN_BASE_URL matches the same ` +
          `region your key was created in (a Singapore key against a Beijing URL, or vice versa, causes this).`
        );
      }
      throw new Error(`Qwen API error (${res.status}): ${bodyText.slice(0, 300)}`);
    }

    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) {
      throw new Error("Qwen API returned an empty response — no message content found.");
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("Qwen API response was not valid JSON — the model may not have followed the requested format.");
    }
    return parsed;
  } catch (err) {
    if (err.name === "AbortError") {
      if (attempt < MAX_RETRIES) return callQwenReal(systemPrompt, userPayload, attempt + 1);
      throw new Error(`Qwen API request timed out after ${REQUEST_TIMEOUT_MS / 1000}s.`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// ---------- Response shape validation ----------
// The mock always returns a guaranteed shape. Real AI output isn't guaranteed,
// so we check the essentials before trusting it downstream, and fail loudly
// (not silently) if something's missing.

function validateTestCasesResponse(result) {
  if (!result || !Array.isArray(result.testCases)) {
    throw new Error("Qwen response missing a valid 'testCases' array.");
  }
  result.testCases.forEach((tc, i) => {
    if (!tc.id || !tc.title) {
      throw new Error(`Qwen test case at index ${i} is missing required 'id' or 'title'.`);
    }
  });
  return result;
}

function validateCypressCodeResponse(result) {
  if (!result || typeof result.script !== "string" || result.script.trim().length === 0) {
    throw new Error("Qwen response missing a valid 'script' string.");
  }
  if (!result.script.includes("describe(") || !result.script.includes("it(")) {
    throw new Error("Qwen-generated script doesn't look like a Cypress spec (missing describe/it blocks).");
  }
  if (result.script.length > 200000) {
    throw new Error("Qwen-generated script is unexpectedly large (>200KB) — refusing to use it.");
  }
  return { fileName: result.fileName || "customer-feedback.cy.js", framework: "cypress", language: "javascript", script: result.script };
}

function validateFailureAnalysisResponse(result) {
  const ALLOWED_CLASSIFICATIONS = [
    "APPLICATION_DEFECT", "AUTOMATION_DEFECT", "TEST_DATA_PROBLEM",
    "ENVIRONMENT_PROBLEM", "REQUIREMENT_AMBIGUITY", "UNKNOWN",
  ];
  if (!result || typeof result.summary !== "string") {
    throw new Error("Qwen failure-analysis response missing a valid 'summary' string.");
  }
  if (!ALLOWED_CLASSIFICATIONS.includes(result.classification)) {
    result.classification = "UNKNOWN"; // don't trust an invented classification — fall back safely
  }
  if (typeof result.confidence !== "number" || result.confidence < 0 || result.confidence > 1) {
    result.confidence = 0.5;
  }
  return result;
}

// ---------- Deterministic relevance filter ----------
// The prompt asks the AI to scope results to what the story mentions, but
// LLMs follow instructions with high probability, not certainty. This is a
// second, deterministic layer behind the prompt: strip out any test case
// whose title doesn't relate to a word actually in the story, so a narrow
// request like "check the age" can't come back with unrelated feedback/email
// cases even if the AI over-generates. Real code, not another AI call —
// instant, free, and always behaves the same way.
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "for", "is", "are", "in", "on",
  "check", "test", "validate", "validation", "please", "should", "that",
  "this", "with", "field", "fields", "only", "all", "must", "be", "it",
]);

function extractKeywords(story) {
  return (story || "")
    .toLowerCase()
    .replace(/https?:\/\/[^\s]+/g, " ") // strip URLs so they never leak in as false keywords
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function looksLikeBaseline(title) {
  const t = title.toLowerCase();
  return /valid information|all valid|empty form|completely empty|valid data/.test(t);
}

function filterRelevantTestCases(result, story) {
  const keywords = extractKeywords(story);
  if (keywords.length === 0) return result; // broad/unspecific story — keep everything, nothing to scope to

  const relevant = [];
  const baseline = [];

  result.testCases.forEach((tc) => {
    const titleLower = tc.title.toLowerCase();
    if (keywords.some((k) => titleLower.includes(k))) {
      relevant.push(tc);
    } else if (looksLikeBaseline(titleLower) && baseline.length < 2) {
      baseline.push(tc);
    }
    // else: dropped — didn't match the story and isn't a baseline sanity check
  });

  // Safety net: if filtering would remove everything (e.g. keywords too
  // unusual to match any title text), fall back to the original unfiltered
  // list rather than showing the user nothing.
  if (relevant.length === 0 && baseline.length === 0) return result;

  return { ...result, testCases: [...baseline, ...relevant] };
}

const SYSTEM_PROMPTS = {
  TEST_ANALYST_V1: `You are a senior QA test analyst. Given a business story, acceptance
criteria, and a page-control inventory, produce 15-25 structured test cases covering
positive, negative, and boundary scenarios. Return JSON only, matching this schema:
{"feature": string, "testCases": [{"id": "TC001", "title": string, "type": "positive"|"negative"|"boundary"|"functional",
"priority": "low"|"medium"|"high", "preconditions": [], "testData": {}, "steps": [{"action": string, "target": string}],
"expectedResults": [string]}]}. Never invent fields not present in the page-control inventory.`,

  // ============================================================
  // UPDATED: tightened to stop the AI from inventing cy.contains()
  // assertion text that never appears on the real page (this was
  // the root cause of most generated tests failing regardless of
  // whether the form actually worked).
  // ============================================================
  PLAYWRIGHT_GENERATOR_V1: `You are a senior QA automation engineer. Generate Cypress
JavaScript tests only for the supplied approved test cases, using ONLY the real
data-testid values present in the supplied page discovery data. Never invent fields,
buttons, or testids not present in that data.

CRITICAL ASSERTION RULES — read carefully, these are the most common source of bugs:
1. For a SUCCESS assertion (form submitted successfully), you MUST assert on the
   real success element's data-testid from page discovery (e.g.
   cy.get('[data-testid="success-panel"]').should('be.visible')). NEVER use
   cy.contains() with an invented or paraphrased sentence describing what should
   happen — only use cy.contains() with text you can see verbatim in the page
   discovery data or the supplied HTML content itself.
2. For an ERROR assertion (validation failure), you MUST assert on that specific
   field's real error element data-testid from page discovery's errorElement data
   (e.g. cy.get('[data-testid="email-error"]').should('be.visible')). Do NOT use
   cy.contains() with a made-up description of the error like "Error message for
   invalid email is displayed" — that text does not exist on the page and the
   test will always fail.
3. If page discovery does not provide a testid for the success or error element
   you need, do not guess one. Instead assert against the element's real id
   selector if provided, or omit that specific assertion rather than inventing text.
4. Every test case that submits the form MUST first fill in ALL fields the page
   discovery data marks as required — not just the field(s) directly relevant to
   that test's scenario — otherwise unrelated required-field errors will block
   the test from reaching its actual assertion. Only leave a field empty if the
   test's specific purpose is to test that field being empty.
5. When selecting a value from a <select> dropdown, you MUST use only a value
   or label that literally appears in that field's "options" array from page
   discovery. Never invent a plausible-sounding option (e.g. do not write
   cy.get(...).select('Feature Request') unless "Feature Request" is a real
   entry in that field's options list).

No fixed waits/cy.wait(ms). Never use child_process, eval, Function(), or
fs.readFile. Return JSON only, matching:
{"fileName": string, "framework": "cypress", "language": "javascript", "script": string}.
The script must be a complete, valid Cypress spec file using describe()/it() blocks.`,

  FAILURE_ANALYST_V1: `You are a QA failure analyst. Given a business requirement, the
test case, expected result, and actual error, classify the failure and explain it in
plain business language. Return JSON only, matching:
{"summary": string, "classification": "APPLICATION_DEFECT"|"AUTOMATION_DEFECT"|"TEST_DATA_PROBLEM"|
"ENVIRONMENT_PROBLEM"|"REQUIREMENT_AMBIGUITY"|"UNKNOWN", "expected": string, "actual": string,
"probableCause": string, "severity": "low"|"medium"|"high", "confidence": number between 0 and 1}.
Do NOT automatically classify every failure as an application defect — consider automation and test-data causes too.`,
};

async function generateTestCases({ story, acceptanceCriteria, pageDiscovery, environment, priority }) {
  if (USE_REAL_QWEN) {
    const result = await callQwenReal(SYSTEM_PROMPTS.TEST_ANALYST_V1, {
      story, acceptanceCriteria, pageDiscovery, environment, priority,
    });
    const validated = validateTestCasesResponse(result);
    return filterRelevantTestCases(validated, story);
  }
  return mockGenerateTestCases({ story, acceptanceCriteria, pageDiscovery });
}

async function generateCypressCode({ approvedTestCases, pageDiscovery, fileName }) {
  if (USE_REAL_QWEN) {
    const result = await callQwenReal(SYSTEM_PROMPTS.PLAYWRIGHT_GENERATOR_V1, {
      approvedTestCases, pageDiscovery, fileName,
    });
    return validateCypressCodeResponse(result);
  }
  return mockGenerateCypressCode({ approvedTestCases, pageDiscovery, fileName });
}

async function analyzeFailure({ story, acceptanceCriteria, testCase, expected, actual, consoleErrors }) {
  if (USE_REAL_QWEN) {
    const result = await callQwenReal(SYSTEM_PROMPTS.FAILURE_ANALYST_V1, {
      story, acceptanceCriteria, testCase, expected, actual, consoleErrors,
    });
    return validateFailureAnalysisResponse(result);
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
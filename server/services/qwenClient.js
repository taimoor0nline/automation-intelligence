function numberEnv(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const QWEN_MODEL = process.env.QWEN_MODEL || "qwen3.7-flash";
const REQUEST_TIMEOUT_MS = Math.max(30000, Math.min(numberEnv(process.env.QWEN_TIMEOUT_MS, 180000), 600000));
const MAX_RETRIES = Math.max(0, Math.min(Math.trunc(numberEnv(process.env.QWEN_MAX_RETRIES, 1)), 3));
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
      throw new Error(`Qwen request timed out after ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s. Increase QWEN_TIMEOUT_MS if Model Studio is responding slowly.`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

const TEST_ANALYST_PROMPT = `You are a senior QA test analyst.
Convert the supplied business user story and discovered web-page inventory into a concise set of executable test cases.

Rules:
- The BUSINESS USER STORY is the authoritative scope. Generate tests ONLY for the behaviour requested by the story.
- A discovered page is evidence that a page/control exists; discovery is NOT permission to test unrelated features.
- If the story is limited to login/authentication, every generated test case must remain on login/authentication. Do not create feedback, profile, dashboard, registration, checkout, or other downstream feature tests merely because those pages were discovered.
- If the story explicitly asks for negative testing, prioritize negative, validation, required-field and invalid-input scenarios within that same feature. Do not add a positive end-to-end journey unless it is necessary to establish the negative scenario.
- Generate EXACTLY requestedTestCaseCount test cases. Do not generate more or fewer.
- Cover only behaviour that appears in BOTH the business-story scope and the usable discovered controls.
- Tests must describe the EXPECTED behaviour. Never manufacture an assertion just to make a test fail. A failed run should mean the real application did not meet the expected behaviour.
- When the story and discovered controls contain explicit required fields, boundaries, formats or validation constraints, prioritize them.
- Treat selectors, fields, messages and option values in the supplied page inventory as the source of truth. Never invent fields, pages, buttons, selectors, messages or dropdown values.
- Multi-page journeys are allowed ONLY when the story itself requires a multi-page journey.
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
1. APPROVED TEST CASES define the execution scope. Do not navigate to or interact with a discovered page/control unless an approved test case requires it.
2. Use only selectors, data-testid values, ids, names, messages, option values and URLs that appear in pageDiscoveries or the approved test case itself.
3. Never invent a selector or assertion text.
4. Prefer an explicit selector supplied in a test step; otherwise prefer data-testid, then id, then name from discovery.
5. Use relative paths with cy.visit() when pages share the supplied base URL.
6. If login credentials are available, NEVER hardcode them. Read them securely with:
   cy.env(['TEST_USERNAME','TEST_PASSWORD'], { log: false }).then(({ TEST_USERNAME, TEST_PASSWORD }) => { ... })
   and type them with { log: false }.
7. Do not send credential values to logs, assertions, screenshots, titles or comments.
8. For login-only test cases, remain on the login/authentication flow. Do not continue to feedback or another downstream page unless that approved case explicitly requires it.
9. Execute the approved test case steps in order.
10. For a form validation case, populate every other field listed in that approved case before submitting. Check/select radio buttons, checkboxes and dropdowns exactly as requested.
11. No numeric cy.wait(). No child_process, fs, eval, Function, network modules or arbitrary Node code.
12. Assertions must prove the expected result. For a rejection/validation case, assert the discovered field-specific or form-level error state and that the disallowed transition does not occur.
13. Every approved test case must map to one it() block whose title begins with its TC id.
14. For containers containing dynamic values such as generated reference IDs or timestamps, do not use exact whole-element text equality; assert visibility and known static text separately.

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

function findByTestId(pageDiscoveries, testId) {
  for (const page of pageDiscoveries || []) {
    const element = (page.elements || []).find((item) => item.testId === testId);
    if (element) return { page, element };
  }
  return null;
}

function findMessageByTestId(pageDiscoveries, testId) {
  for (const page of pageDiscoveries || []) {
    const message = (page.messages || []).find((item) => item.testId === testId);
    if (message) return { page, message };
  }
  return null;
}

function elementTarget(found) {
  return found?.element?.selector || found?.element?.label || found?.element?.testId || "";
}

function errorTarget(found) {
  const error = found?.element?.errorElement;
  if (!error) return "";
  if (error.testId) return `[data-testid="${error.testId}"]`;
  if (error.id) return `#${error.id}`;
  return error.text || "";
}

function pagePath(page) {
  try {
    const url = new URL(page?.finalUrl || page?.url || "/");
    return `${url.pathname}${url.search}` || "/";
  } catch {
    return "/";
  }
}

function firstNonEmptyOption(found, fallback) {
  const option = (found?.element?.options || []).find((item) => item.value !== "");
  return option?.value || fallback;
}

function isLoginScopedStory(story) {
  const text = String(story || "").toLowerCase();
  const mentionsLogin = /\b(login|log in|sign in|signin|authentication|authenticate)\b/.test(text);
  const mentionsOtherFeature = /\b(feedback|profile|dashboard|registration|register|checkout|payment|order|search|cart)\b/.test(text);
  return mentionsLogin && !mentionsOtherFeature;
}

function scopeDiscoveriesForStory(pageDiscoveries, story) {
  if (!isLoginScopedStory(story)) return pageDiscoveries;

  const loginPages = (pageDiscoveries || []).filter((page) => {
    const ids = new Set((page.elements || []).flatMap((item) => [item.testId, item.id, item.name].filter(Boolean)));
    return ids.has("username") || ids.has("password") || ids.has("login-button") || ids.has("login-error");
  });

  const scoped = loginPages.length ? loginPages : (pageDiscoveries || []).slice(0, 1);
  return scoped.map((page) => ({
    ...page,
    // A redirect hint tells discovery that another route exists, but for a
    // login-only story it must not broaden the test scope into that feature.
    routeHints: [],
  }));
}

function buildDemoCalibration(result, pageDiscoveries, story) {
  if (TEST_CASE_COUNT !== 5 || !/feedback/i.test(String(story || ""))) return result;

  const username = findByTestId(pageDiscoveries, "username");
  const password = findByTestId(pageDiscoveries, "password");
  const loginButton = findByTestId(pageDiscoveries, "login-button");
  const loginError = findMessageByTestId(pageDiscoveries, "login-error");
  const fullName = findByTestId(pageDiscoveries, "full-name");
  const email = findByTestId(pageDiscoveries, "email");
  const age = findByTestId(pageDiscoveries, "age");
  const website = findByTestId(pageDiscoveries, "website");
  const category = findByTestId(pageDiscoveries, "feedback-category");
  const contact = findByTestId(pageDiscoveries, "contact-method-email");
  const product = findByTestId(pageDiscoveries, "products-web");
  const rating = findByTestId(pageDiscoveries, "rating");
  const subject = findByTestId(pageDiscoveries, "subject");
  const feedback = findByTestId(pageDiscoveries, "feedback-message");
  const consent = findByTestId(pageDiscoveries, "consent");
  const submit = findByTestId(pageDiscoveries, "submit-feedback");
  const success = findMessageByTestId(pageDiscoveries, "success-panel");

  const requiredDemoControls = [username, password, loginButton, fullName, email, age, website, category, contact, product, rating, subject, feedback, consent, submit, success];
  if (requiredDemoControls.some((item) => !item)) return result;
  if (String(age.element.min || "") !== "18" || age.element.type !== "number" || website.element.type !== "url") return result;

  const loginPath = pagePath(username.page);
  const feedbackPath = pagePath(fullName.page);
  const loginErrorTarget = loginError?.message?.testId ? `[data-testid="${loginError.message.testId}"]` : loginError?.message?.id ? `#${loginError.message.id}` : "";
  const successTarget = success?.message?.testId ? `[data-testid="${success.message.testId}"]` : success?.message?.id ? `#${success.message.id}` : "";

  const loginSteps = () => [
    { action: "Navigate to the login page", target: "page", value: loginPath },
    { action: "Enter the configured test username", target: elementTarget(username), value: null },
    { action: "Enter the configured test password", target: elementTarget(password), value: null },
    { action: "Click Sign in", target: elementTarget(loginButton), value: null },
    { action: "Continue to the feedback form after successful login", target: "page", value: feedbackPath },
  ];

  const feedbackSteps = ({ emailValue = "demo.user@example.com", ageValue = "30", websiteValue = "https://example.com" } = {}) => [
    { action: "Enter full name", target: elementTarget(fullName), value: "Demo User" },
    emailValue === null ? { action: "Leave email blank", target: elementTarget(email), value: null } : { action: "Enter email", target: elementTarget(email), value: emailValue },
    { action: "Enter age", target: elementTarget(age), value: ageValue },
    { action: "Enter website", target: elementTarget(website), value: websiteValue },
    { action: "Select feedback category", target: elementTarget(category), value: firstNonEmptyOption(category, "service") },
    { action: "Select preferred contact method", target: elementTarget(contact), value: contact.element.value || "email" },
    { action: "Select at least one product", target: elementTarget(product), value: product.element.value || "web" },
    { action: "Enter satisfaction rating", target: elementTarget(rating), value: "8" },
    { action: "Enter subject", target: elementTarget(subject), value: "Service feedback" },
    { action: "Enter feedback message", target: elementTarget(feedback), value: "This feedback confirms the expected customer journey." },
    { action: "Provide consent", target: elementTarget(consent), value: "checked" },
    { action: "Submit feedback", target: elementTarget(submit), value: null },
  ];

  return {
    ...result,
    demoCalibrated: true,
    testCases: [
      {
        id: "TC001",
        title: "Login and submit valid customer feedback",
        type: "positive",
        priority: "high",
        preconditions: ["Target application is available", "Valid test credentials are configured in the automation runtime"],
        testData: { category: firstNonEmptyOption(category, "service"), age: "30", website: "https://example.com" },
        steps: [...loginSteps(), ...feedbackSteps()],
        expectedResults: [`The feedback form at ${feedbackPath} is opened after login`, "The valid feedback submission is accepted", `The success element ${successTarget} is visible after submission`],
      },
      {
        id: "TC002",
        title: "Reject invalid login credentials",
        type: "negative",
        priority: "high",
        preconditions: ["Target application is available"],
        testData: { username: "invalid-user", password: "invalid-password" },
        steps: [
          { action: "Navigate to the login page", target: "page", value: loginPath },
          { action: "Enter invalid username", target: elementTarget(username), value: "invalid-user" },
          { action: "Enter invalid password", target: elementTarget(password), value: "invalid-password" },
          { action: "Click Sign in", target: elementTarget(loginButton), value: null },
        ],
        expectedResults: ["Login is rejected", loginErrorTarget ? `The login error element ${loginErrorTarget} is visible and non-empty` : "A discovered login error is shown", `The user is not taken to ${feedbackPath}`],
      },
      {
        id: "TC003",
        title: "Reject feedback submission when email is missing",
        type: "negative",
        priority: "medium",
        preconditions: ["Target application is available", "Valid test credentials are configured in the automation runtime"],
        testData: { email: null },
        steps: [...loginSteps(), ...feedbackSteps({ emailValue: null })],
        expectedResults: ["Feedback submission is rejected because email is required", `The email validation element ${errorTarget(email)} is visible and non-empty`, `The success element ${successTarget} remains absent or hidden`],
      },
      {
        id: "TC004",
        title: "Reject age below the minimum of 18",
        type: "boundary",
        priority: "high",
        preconditions: ["Target application is available", "Valid test credentials are configured in the automation runtime"],
        testData: { age: "17", minimumAge: "18" },
        steps: [...loginSteps(), ...feedbackSteps({ ageValue: "17" })],
        expectedResults: ["Age 17 is rejected because the discovered minimum age is 18", `The age validation element ${errorTarget(age)} is visible and non-empty`, `The success element ${successTarget} remains absent or hidden`],
      },
      {
        id: "TC005",
        title: "Reject malformed website URL",
        type: "negative",
        priority: "high",
        preconditions: ["Target application is available", "Valid test credentials are configured in the automation runtime"],
        testData: { website: "abc" },
        steps: [...loginSteps(), ...feedbackSteps({ websiteValue: "abc" })],
        expectedResults: ["Website value abc is rejected because the discovered field requires a URL", `The website validation element ${errorTarget(website)} is visible and non-empty`, `The success element ${successTarget} remains absent or hidden`],
      },
    ],
  };
}

async function generateTestCases({ story, pageDiscoveries, environment }) {
  const scopedDiscoveries = scopeDiscoveriesForStory(pageDiscoveries, story);
  const result = await callQwen(TEST_ANALYST_PROMPT, {
    story,
    pageDiscoveries: scopedDiscoveries,
    environment,
    requestedTestCaseCount: TEST_CASE_COUNT,
    scopeInstruction: isLoginScopedStory(story)
      ? "LOGIN/AUTHENTICATION ONLY. Do not create tests for downstream pages or features."
      : "Follow the business story exactly; discovered pages do not broaden scope.",
  });
  const validated = validateTestCases(result, TEST_CASE_COUNT);
  return buildDemoCalibration(validated, pageDiscoveries, story);
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

module.exports = { generateTestCases, generateAutomationCode, analyzeFailure, isConfigured, QWEN_MODEL, TEST_CASE_COUNT };
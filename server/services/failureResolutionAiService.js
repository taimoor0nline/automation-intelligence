const { modelForProfile } = require("./aiModelProfiles");

function numberEnv(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const REQUEST_TIMEOUT_MS = Math.max(30000, Math.min(numberEnv(process.env.QWEN_TIMEOUT_MS, 180000), 600000));

const FAILURE_RESOLUTION_PROMPT = `You are a senior QA failure analyst and remediation advisor for a Cypress-based deterministic test automation platform.
Analyze one completed failed test using only the supplied business story, approved test case, expected behavior and observed failure.

Your job has three parts:
1. classify what most likely failed;
2. provide concise, actionable resolution guidance for a human developer/tester;
3. when classification is APPLICATION_DEFECT, provide developer-oriented implementation guidance that explains what logic to inspect and a safe pseudocode/example pattern for correcting it.

Hard rules:
- Never weaken, remove, bypass or rewrite the approved expected behavior merely to make the test pass.
- Never claim that the issue is fixed or resolved. This is advisory guidance only.
- Do not invent source files, line numbers, APIs, database objects, selectors, requirements or implementation details that were not supplied.
- If source code was not supplied, developer guidance must say which logical area to inspect, not fabricate an exact file or function name.
- An example fix may be pseudocode or a generic code pattern. Clearly label it as an example, not a verified patch.
- APPLICATION_DEFECT means the automation reached meaningful application validation and observed behavior that conflicts with the approved expectation.
- AUTOMATION_DEFECT means the runtime/compiler/selector/framework failed before meaningful application validation.
- TEST_DATA_PROBLEM means the supplied data is unsuitable or contradicts the approved scenario.
- ENVIRONMENT_PROBLEM means browser/server/network/environment availability prevented meaningful validation.
- REQUIREMENT_AMBIGUITY means the expected behavior cannot be determined confidently from supplied requirements.
- Recommended fixes must describe what should be reviewed or changed, not fabricate code.
- Regression checks must identify nearby behavior that could be broken by the change.
- Verification steps must describe how to prove the resolution after a human change, normally by re-running the failed test and confirming the expected assertion.
- safeToAutoResolve must always be false. The platform must not auto-close or auto-fix a failed test from this response.
- Return JSON only.

Schema:
{
  "summary": string,
  "classification": "APPLICATION_DEFECT"|"AUTOMATION_DEFECT"|"TEST_DATA_PROBLEM"|"ENVIRONMENT_PROBLEM"|"REQUIREMENT_AMBIGUITY"|"UNKNOWN",
  "expected": string,
  "actual": string,
  "probableCause": string,
  "severity": "low"|"medium"|"high",
  "confidence": number,
  "resolutionComment": string,
  "recommendedFix": string,
  "recommendedOwner": "APPLICATION_TEAM"|"TEST_AUTOMATION_TEAM"|"TEST_DATA_OWNER"|"ENVIRONMENT_TEAM"|"BUSINESS_ANALYST"|"MANUAL_REVIEW",
  "developerReviewArea": string,
  "developerImplementationHint": string,
  "developerExampleFix": string,
  "regressionChecks": [string],
  "verificationSteps": [string],
  "safeToAutoResolve": false
}`;

function cleanText(value, max = 2000) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizeOwner(value, classification) {
  const allowed = new Set([
    "APPLICATION_TEAM",
    "TEST_AUTOMATION_TEAM",
    "TEST_DATA_OWNER",
    "ENVIRONMENT_TEAM",
    "BUSINESS_ANALYST",
    "MANUAL_REVIEW",
  ]);
  const candidate = cleanText(value, 50).toUpperCase();
  if (allowed.has(candidate)) return candidate;
  if (classification === "APPLICATION_DEFECT") return "APPLICATION_TEAM";
  if (classification === "AUTOMATION_DEFECT") return "TEST_AUTOMATION_TEAM";
  if (classification === "TEST_DATA_PROBLEM") return "TEST_DATA_OWNER";
  if (classification === "ENVIRONMENT_PROBLEM") return "ENVIRONMENT_TEAM";
  if (classification === "REQUIREMENT_AMBIGUITY") return "BUSINESS_ANALYST";
  return "MANUAL_REVIEW";
}

function cleanList(value, maxItems = 6) {
  return Array.isArray(value)
    ? value.map((v) => cleanText(v, 700)).filter(Boolean).slice(0, maxItems)
    : [];
}

function normalizeResult(result, fallback) {
  const allowedClassifications = new Set([
    "APPLICATION_DEFECT",
    "AUTOMATION_DEFECT",
    "TEST_DATA_PROBLEM",
    "ENVIRONMENT_PROBLEM",
    "REQUIREMENT_AMBIGUITY",
    "UNKNOWN",
  ]);
  const classification = allowedClassifications.has(result?.classification) ? result.classification : "UNKNOWN";
  const severity = ["low", "medium", "high"].includes(String(result?.severity || "").toLowerCase())
    ? String(result.severity).toLowerCase()
    : "medium";
  const confidence = Number(result?.confidence);
  const verificationSteps = cleanList(result?.verificationSteps, 5);
  const regressionChecks = cleanList(result?.regressionChecks, 6);
  const isApplicationDefect = classification === "APPLICATION_DEFECT";

  return {
    summary: cleanText(result?.summary || "The failed test requires review.", 1500),
    classification,
    expected: cleanText(result?.expected || fallback.expected, 2500),
    actual: cleanText(result?.actual || fallback.actual, 3000),
    probableCause: cleanText(result?.probableCause || "The available evidence is insufficient to identify a more specific cause.", 1800),
    severity,
    confidence: Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 ? confidence : 0.5,
    resolutionComment: cleanText(result?.resolutionComment || "Review the failure against the approved expectation before making a corrective change.", 1800),
    recommendedFix: cleanText(result?.recommendedFix || "Correct the responsible application, automation, data, environment, or requirement issue without weakening the approved assertion.", 1800),
    recommendedOwner: normalizeOwner(result?.recommendedOwner, classification),
    developerReviewArea: isApplicationDefect
      ? cleanText(result?.developerReviewArea || "Review the application validation/business-rule path responsible for the failed expected behavior.", 1200)
      : "",
    developerImplementationHint: isApplicationDefect
      ? cleanText(result?.developerImplementationHint || "Align the application rule with the approved requirement, return/render the expected validation state, and preserve the valid-path behavior.", 2200)
      : "",
    developerExampleFix: isApplicationDefect
      ? cleanText(result?.developerExampleFix || "Example pattern: if (input violates approved rule) { reject submission; expose validation error; } else { continue normal processing; }", 2600)
      : "",
    regressionChecks: isApplicationDefect
      ? (regressionChecks.length ? regressionChecks : ["Confirm a valid value is still accepted.", "Confirm the boundary/invalid value is rejected.", "Confirm the expected validation feedback remains visible and non-empty."])
      : [],
    verificationSteps: verificationSteps.length ? verificationSteps : ["Apply the reviewed corrective change.", "Re-run the failed test case and confirm the original expected behavior now passes."],
    safeToAutoResolve: false,
    resolutionSource: "AI_ADVISORY",
  };
}

async function callModel(payload, modelTier) {
  if (!process.env.QWEN_API_KEY || !process.env.QWEN_BASE_URL) {
    throw new Error("AI provider is not configured on the server.");
  }

  const { model } = modelForProfile(modelTier || "strong");
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
          { role: "system", content: FAILURE_RESOLUTION_PROMPT },
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
    const raw = String(data.choices?.[0]?.message?.content || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    if (!raw) throw new Error("AI provider returned an empty response.");
    return JSON.parse(raw);
  } finally {
    clearTimeout(timeout);
  }
}

async function analyzeFailureWithResolution({ story, testCase, expected, actual, modelTier = "strong" }) {
  const payload = {
    businessStory: cleanText(story, 6000),
    approvedTestCase: testCase,
    expectedBehavior: cleanText(expected, 3500),
    observedFailure: cleanText(actual, 5000),
  };
  const result = await callModel(payload, modelTier);
  return normalizeResult(result, { expected, actual });
}

module.exports = { analyzeFailureWithResolution, FAILURE_RESOLUTION_PROMPT };

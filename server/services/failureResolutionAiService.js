const { modelForProfile } = require("./aiModelProfiles");

function numberEnv(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const REQUEST_TIMEOUT_MS = Math.max(30000, Math.min(numberEnv(process.env.QWEN_TIMEOUT_MS, 180000), 600000));

const FAILURE_RESOLUTION_PROMPT = `You are a senior QA failure analyst and remediation advisor for a Cypress-based deterministic test automation platform.
Analyze one completed failed test using only the supplied business story, approved test case, expected behavior, observed failure, and optional source-code evidence.

Your job has three parts:
1. classify what most likely failed;
2. provide concise, actionable resolution guidance for a human developer/tester;
3. when classification is APPLICATION_DEFECT, provide developer-oriented implementation guidance.

SOURCE-AWARE RULES:
- sourceContext, when present, contains candidate repository files/snippets gathered from the configured source repository.
- You may name an exact file/function/line area ONLY when it appears in sourceContext.
- Distinguish SOURCE_VERIFIED from SOURCE_SUGGESTED. A candidate file with matching snippets may support SOURCE_VERIFIED guidance; a path-only candidate is SOURCE_SUGGESTED.
- Never claim a candidate is definitely the root cause unless the supplied snippet directly demonstrates the mismatch.
- If source evidence is insufficient, fall back to logical-area guidance rather than inventing a file.
- You may propose a patch-style example only against supplied source snippets. Otherwise provide pseudocode/generic patterns.

Hard rules:
- Never weaken, remove, bypass or rewrite the approved expected behavior merely to make the test pass.
- Never claim that the issue is fixed or resolved. This is advisory guidance only.
- Do not invent source files, line numbers, APIs, database objects, selectors, requirements or implementation details that were not supplied.
- APPLICATION_DEFECT means the automation reached meaningful application validation and observed behavior that conflicts with the approved expectation.
- AUTOMATION_DEFECT means the runtime/compiler/selector/framework failed before meaningful application validation.
- TEST_DATA_PROBLEM means the supplied data is unsuitable or contradicts the approved scenario.
- ENVIRONMENT_PROBLEM means browser/server/network/environment availability prevented meaningful validation.
- REQUIREMENT_AMBIGUITY means the expected behavior cannot be determined confidently from supplied requirements.
- Regression checks must identify nearby behavior that could be broken by the change.
- Verification steps must prove the resolution after a human change, normally by re-running the failed test.
- safeToAutoResolve must always be false.
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
  "sourceGuidanceLevel": "BLACK_BOX"|"SOURCE_SUGGESTED"|"SOURCE_VERIFIED",
  "sourceCandidateFiles": [{"path":string,"reason":string,"startLine":number|null,"endLine":number|null}],
  "regressionChecks": [string],
  "verificationSteps": [string],
  "safeToAutoResolve": false
}`;

function cleanText(value, max = 2000) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizeOwner(value, classification) {
  const allowed = new Set(["APPLICATION_TEAM","TEST_AUTOMATION_TEAM","TEST_DATA_OWNER","ENVIRONMENT_TEAM","BUSINESS_ANALYST","MANUAL_REVIEW"]);
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
  return Array.isArray(value) ? value.map((v) => cleanText(v, 700)).filter(Boolean).slice(0, maxItems) : [];
}

function compactSourceContext(sourceContext) {
  if (!sourceContext || typeof sourceContext !== 'object') return null;
  const files = Array.isArray(sourceContext.candidateFiles) ? sourceContext.candidateFiles.slice(0, 6).map((file) => ({
    path: cleanText(file.path, 500),
    score: Number(file.score) || 0,
    snippets: Array.isArray(file.snippets) ? file.snippets.slice(0, 3).map((s) => ({
      startLine: Number(s.startLine) || null,
      endLine: Number(s.endLine) || null,
      text: cleanText(s.text, 3500),
    })) : [],
  })) : [];
  return {
    mode: sourceContext.mode || 'SOURCE_AWARE',
    repoFullName: cleanText(sourceContext.repoFullName, 300),
    branch: cleanText(sourceContext.branch, 200),
    sourceVerified: Boolean(sourceContext.sourceVerified),
    candidateFiles: files,
  };
}

function normalizeSourceCandidates(value, sourceContext) {
  const allowedPaths = new Set((sourceContext?.candidateFiles || []).map((x) => x.path));
  if (!Array.isArray(value)) return [];
  return value.slice(0, 6).map((item) => {
    const path = cleanText(item?.path, 500);
    if (!allowedPaths.has(path)) return null;
    return {
      path,
      reason: cleanText(item?.reason, 900),
      startLine: Number(item?.startLine) || null,
      endLine: Number(item?.endLine) || null,
    };
  }).filter(Boolean);
}

function normalizeResult(result, fallback, sourceContext) {
  const allowedClassifications = new Set(["APPLICATION_DEFECT","AUTOMATION_DEFECT","TEST_DATA_PROBLEM","ENVIRONMENT_PROBLEM","REQUIREMENT_AMBIGUITY","UNKNOWN"]);
  const classification = allowedClassifications.has(result?.classification) ? result.classification : "UNKNOWN";
  const severity = ["low","medium","high"].includes(String(result?.severity || "").toLowerCase()) ? String(result.severity).toLowerCase() : "medium";
  const confidence = Number(result?.confidence);
  const verificationSteps = cleanList(result?.verificationSteps, 5);
  const regressionChecks = cleanList(result?.regressionChecks, 6);
  const isApplicationDefect = classification === "APPLICATION_DEFECT";
  const sourceCandidates = normalizeSourceCandidates(result?.sourceCandidateFiles, sourceContext);
  const requestedLevel = String(result?.sourceGuidanceLevel || '').toUpperCase();
  const sourceLevel = !isApplicationDefect || !sourceContext
    ? 'BLACK_BOX'
    : requestedLevel === 'SOURCE_VERIFIED' && sourceContext.sourceVerified && sourceCandidates.length
      ? 'SOURCE_VERIFIED'
      : sourceCandidates.length ? 'SOURCE_SUGGESTED' : 'BLACK_BOX';

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
    developerReviewArea: isApplicationDefect ? cleanText(result?.developerReviewArea || "Review the application validation/business-rule path responsible for the failed expected behavior.", 1800) : "",
    developerImplementationHint: isApplicationDefect ? cleanText(result?.developerImplementationHint || "Align the application rule with the approved requirement and preserve valid-path behavior.", 2400) : "",
    developerExampleFix: isApplicationDefect ? cleanText(result?.developerExampleFix || "Example pattern: if (input violates approved rule) { reject submission; expose validation error; }", 4000) : "",
    sourceGuidanceLevel: sourceLevel,
    sourceCandidateFiles: sourceCandidates,
    sourceContext: sourceContext || null,
    regressionChecks: isApplicationDefect ? (regressionChecks.length ? regressionChecks : ["Confirm a valid value is still accepted.","Confirm the boundary/invalid value is rejected.","Confirm expected validation feedback is shown."]) : [],
    verificationSteps: verificationSteps.length ? verificationSteps : ["Apply the reviewed corrective change.","Re-run the failed test case and confirm the original expected behavior now passes."],
    safeToAutoResolve: false,
    resolutionSource: sourceLevel === 'BLACK_BOX' ? "AI_ADVISORY" : "AI_SOURCE_AWARE_ADVISORY",
  };
}

async function callModel(payload, modelTier) {
  if (!process.env.QWEN_API_KEY || !process.env.QWEN_BASE_URL) throw new Error("AI provider is not configured on the server.");
  const { model } = modelForProfile(modelTier || "strong");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${process.env.QWEN_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.QWEN_API_KEY}` },
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

async function analyzeFailureWithResolution({ story, testCase, expected, actual, sourceContext = null, modelTier = "strong" }) {
  const compactSource = compactSourceContext(sourceContext);
  const payload = {
    businessStory: cleanText(story, 6000),
    approvedTestCase: testCase,
    expectedBehavior: cleanText(expected, 3500),
    observedFailure: cleanText(actual, 5000),
    sourceContext: compactSource,
  };
  const result = await callModel(payload, modelTier);
  return normalizeResult(result, { expected, actual }, compactSource);
}

module.exports = { analyzeFailureWithResolution, FAILURE_RESOLUTION_PROMPT };

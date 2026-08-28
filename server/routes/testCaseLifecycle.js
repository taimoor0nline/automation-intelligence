const express = require("express");
const router = express.Router();

const { getSession } = require("../data/sessionStore");
const {
  READY,
  RESOLUTION_AI_REPAIRABLE,
  assessTestCases,
  classifyTestCase,
  readinessSummary,
} = require("../services/testCaseFeasibility");
const { generateSingleTestCase, repairTestCase, suggestAssertionCapability } = require("../services/testCaseAiService");

function cleanString(value, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizeTestCase(raw, fallbackId = "TC-H001") {
  const testCase = raw && typeof raw === "object" ? raw : {};
  const id = /^TC(?:\d{3}|-H\d{3})$/i.test(cleanString(testCase.id, 20)) ? cleanString(testCase.id, 20).toUpperCase() : fallbackId;
  return {
    id,
    title: cleanString(testCase.title, 300),
    type: ["positive", "negative", "boundary", "functional", "custom"].includes(cleanString(testCase.type, 30).toLowerCase()) ? cleanString(testCase.type, 30).toLowerCase() : "functional",
    priority: ["low", "medium", "high"].includes(cleanString(testCase.priority, 30).toLowerCase()) ? cleanString(testCase.priority, 30).toLowerCase() : "medium",
    preconditions: Array.isArray(testCase.preconditions) ? testCase.preconditions.map((value) => cleanString(value, 500)).filter(Boolean).slice(0, 20) : [],
    testData: testCase.testData && typeof testCase.testData === "object" && !Array.isArray(testCase.testData) ? testCase.testData : {},
    steps: Array.isArray(testCase.steps) ? testCase.steps.map((step) => ({
      action: cleanString(step?.action ?? step, 500),
      target: typeof step === "object" ? cleanString(step?.target, 300) : "",
      value: typeof step === "object" && step?.value !== null && step?.value !== undefined ? cleanString(step.value, 300) : null,
    })).filter((step) => step.action || step.target).slice(0, 30) : [],
    expectedResults: Array.isArray(testCase.expectedResults) ? testCase.expectedResults.map((value) => cleanString(value, 600)).filter(Boolean).slice(0, 20) : [],
    source: cleanString(testCase.source, 40) || "human",
    createdBy: cleanString(testCase.createdBy, 40) || null,
    repairHistory: Array.isArray(testCase.repairHistory) ? testCase.repairHistory.slice(-10) : [],
  };
}

function updateCredentials(session, credentials) {
  if (!credentials || typeof credentials !== "object") return;
  session.credentials = {
    username: String(credentials.username || ""),
    password: String(credentials.password || ""),
  };
}

function hasCredentials(session) {
  return Boolean(session.credentials?.username && session.credentials?.password);
}

function context(session) {
  return { pageDiscoveries: session.pageDiscoveries || [], hasCredentials: hasCredentials(session) };
}

function nextOnDemandId(session, suppliedCases = []) {
  const ids = new Set([...(session.testCases || []), ...(suppliedCases || [])].map((tc) => String(tc?.id || "").toUpperCase()));
  for (let i = 1; i <= 999; i += 1) {
    const id = `TC-H${String(i).padStart(3, "0")}`;
    if (!ids.has(id)) return id;
  }
  throw new Error("No on-demand test-case id is available in this session.");
}

function upsertSessionCase(session, candidate) {
  const index = (session.testCases || []).findIndex((tc) => tc.id === candidate.id);
  if (index >= 0) session.testCases[index] = candidate;
  else session.testCases = [candidate, ...(session.testCases || [])];
}

router.post("/api/test-cases/revalidate", async (req, res) => {
  const { sessionId = "default", testCases = null, credentials = null } = req.body || {};
  const session = getSession(sessionId);

  try {
    if (session.state === "IDLE" || !session.story) throw new Error("Generate the initial story-driven test cases before readiness validation.");
    session.readinessValidated = false;
    updateCredentials(session, credentials);

    const sourceCases = Array.isArray(testCases) ? testCases : session.testCases;
    const normalized = sourceCases.map((tc, index) => normalizeTestCase(tc, `TC-H${String(index + 1).padStart(3, "0")}`));
    const assessed = assessTestCases(normalized, context(session));
    session.testCases = assessed;
    session.automationReadiness = readinessSummary(assessed);
    session.readinessValidated = true;

    return res.json({ ok: true, testCases: assessed, automationReadiness: session.automationReadiness, readinessPending: false });
  } catch (err) {
    session.readinessValidated = false;
    return res.status(422).json({ ok: false, reply: err.message, readinessPending: true });
  }
});

router.post("/api/test-cases/generate-one", async (req, res) => {
  const { sessionId = "default", requestText = "", testCases = null, credentials = null, requestedId = null } = req.body || {};
  const session = getSession(sessionId);

  try {
    if (session.state === "IDLE" || !session.story || !(session.pageDiscoveries || []).length) throw new Error("Generate the initial story and page discovery before creating an on-demand test case.");
    updateCredentials(session, credentials);
    const request = cleanString(requestText, 1500);
    if (!request) throw new Error("Describe the specific test case you want the AI to generate.");

    const supplied = Array.isArray(testCases) ? testCases.map((tc, i) => normalizeTestCase(tc, `TC-H${String(i + 1).padStart(3, "0")}`)) : session.testCases;
    const requested = /^TC-H\d{3}$/i.test(String(requestedId || "")) ? String(requestedId).toUpperCase() : null;
    const id = requested || nextOnDemandId(session, supplied);

    const candidate = await generateSingleTestCase({
      id,
      requestText: request,
      story: session.story,
      pageDiscoveries: session.pageDiscoveries,
      modelTier: session.aiModelTier || "strong",
    });
    candidate.createdBy = "human-request";
    candidate.source = "ai-on-demand";
    candidate.repairHistory = [];
    candidate.automationReadiness = classifyTestCase(candidate, context(session));

    return res.json({
      ok: true,
      preview: true,
      testCase: candidate,
      automationReadiness: candidate.automationReadiness,
      readinessSummary: readinessSummary([candidate]),
      aiModelTier: session.aiModelTier || "strong",
    });
  } catch (err) {
    return res.status(422).json({ ok: false, reply: err.message });
  }
});

router.post("/api/test-cases/repair", async (req, res) => {
  const { sessionId = "default", testCase: rawTestCase, credentials = null } = req.body || {};
  const session = getSession(sessionId);

  try {
    if (session.state === "IDLE" || !session.story) throw new Error("Generate the initial test suite before repairing a test case.");
    updateCredentials(session, credentials);

    const original = normalizeTestCase(rawTestCase, "TC-H001");
    const readiness = classifyTestCase(original, context(session));
    if (readiness.status === READY) {
      return res.json({ ok: true, repaired: false, reply: "This test case is already Automation Ready.", testCase: { ...original, automationReadiness: readiness } });
    }
    if (readiness.resolutionType !== RESOLUTION_AI_REPAIRABLE) {
      return res.status(422).json({
        ok: false,
        repaired: false,
        reply: "This readiness issue cannot legitimately be repaired by AI without user input, manual testing, or a different automation capability.",
        automationReadiness: readiness,
      });
    }

    const repair = await repairTestCase({
      testCase: original,
      readiness,
      story: session.story,
      pageDiscoveries: session.pageDiscoveries,
      modelTier: session.aiModelTier || "strong",
    });
    if (!repair.repaired) return res.status(422).json({ ok: false, repaired: false, reply: repair.explanation, automationReadiness: readiness });

    const repaired = normalizeTestCase({ ...repair.testCase, id: original.id }, original.id);
    repaired.automationReadiness = classifyTestCase(repaired, context(session));
    repaired.repairHistory = [
      ...(original.repairHistory || []),
      {
        attempt: (original.repairHistory || []).length + 1,
        action: "AI_REPAIR",
        originalStatus: readiness.status,
        reasonCode: readiness.reasonCode,
        reason: readiness.reason,
        explanation: repair.explanation,
        result: repaired.automationReadiness.status,
      },
    ].slice(-10);

    upsertSessionCase(session, repaired);
    session.automationReadiness = readinessSummary(session.testCases);
    session.readinessValidated = true;

    return res.json({ ok: true, repaired: true, testCase: repaired, automationReadiness: repaired.automationReadiness, aiModelTier: session.aiModelTier || "strong" });
  } catch (err) {
    return res.status(422).json({ ok: false, repaired: false, reply: err.message });
  }
});

router.post("/api/test-cases/assertion-suggestion", async (req, res) => {
  const { sessionId = "default", testCase: rawTestCase, credentials = null } = req.body || {};
  const session = getSession(sessionId);

  try {
    if (session.state === "IDLE" || !session.story) throw new Error("Generate the initial test suite before requesting an assertion suggestion.");
    updateCredentials(session, credentials);

    const testCase = normalizeTestCase(rawTestCase, "TC-H001");
    const readiness = classifyTestCase(testCase, context(session));
    if (!readiness.canSuggestAssertion) {
      return res.status(422).json({ ok: false, reply: "This test case does not currently contain an unsupported or uncompiled expectation that needs an assertion suggestion.", automationReadiness: readiness });
    }

    const suggestion = await suggestAssertionCapability({
      testCase,
      readiness,
      story: session.story,
      pageDiscoveries: session.pageDiscoveries,
      modelTier: session.aiModelTier || "strong",
    });

    return res.json({
      ok: true,
      suggestion,
      automationReadiness: readiness,
      aiModelTier: session.aiModelTier || "strong",
    });
  } catch (err) {
    return res.status(422).json({ ok: false, reply: err.message });
  }
});

module.exports = router;

const express = require("express");
const router = express.Router();

const { getSession, resetSession } = require("../data/sessionStore");
const { discoverPage } = require("../services/pageDiscovery");
const qwen = require("../services/qwenClient");
const { validateScript } = require("../services/scriptValidator");
const { executeGeneratedTest } = require("../services/testRunner");
const db = require("../db/database");

const URL_REGEX = /https?:\/\/[^\s)]+/i;

function extractUrl(text) {
  const m = text.match(URL_REGEX);
  if (!m) return null;
  // Strip trailing punctuation that's part of the sentence, not the URL.
  return m[0].replace(/[),.;:!?]+$/, "");
}

function formatTestCaseList(testCases) {
  return testCases
    .map((tc) => `  • **${tc.id}** [${tc.type}/${tc.priority}] — ${tc.title}`)
    .join("\n");
}

function parseApproval(text, allIds) {
  const t = text.trim().toLowerCase();
  if (/^approve all$/.test(t) || /^approve$/.test(t) || /^yes$/.test(t)) {
    return { approvedIds: allIds, rejectedIds: [] };
  }
  const idMatches = text.toUpperCase().match(/TC(?:\d{3}|-C\d+)/g) || [];
  if (/reject/i.test(text)) {
    const rejected = idMatches;
    return { approvedIds: allIds.filter((id) => !rejected.includes(id)), rejectedIds: rejected };
  }
  if (idMatches.length > 0) {
    return { approvedIds: idMatches, rejectedIds: allIds.filter((id) => !idMatches.includes(id)) };
  }
  return null; // couldn't parse
}

router.post("/api/chat", async (req, res) => {
  const { sessionId = "default", message = "", customTestCases = [] } = req.body;
  const session = getSession(sessionId);

  try {
    if (session.state === "IDLE") {
      const url = extractUrl(message);
      if (!url) {
        return res.json({
          reply:
            "Sure — please include the target URL you'd like tested, e.g.\n\n" +
            `"Please test https://uat.example.com/feedback, do the validation checks like email, web url, phone, and name validation upon submit."`,
        });
      }

      session.story = message;
      session.targetUrl = url;

      session.pageDiscovery = await discoverPage(url);

      const result = await qwen.generateTestCases({
        story: message,
        acceptanceCriteria: [],
        pageDiscovery: session.pageDiscovery,
        environment: "UAT",
        priority: "high",
      });

      session.testCases = result.testCases;
      session.state = "AWAITING_APPROVAL";

      // Persist the run + generated test cases (no-op if DB isn't configured).
      session.dbRunId = await db.saveRun({
        sessionId, story: message, targetUrl: url, environment: "UAT",
      });
      await db.saveTestCases(session.dbRunId, session.testCases);

      return res.json({
        reply:
          `Discovered **${session.pageDiscovery.elements.length} controls** on ${url}.\n\n` +
          `Qwen generated **${session.testCases.length} test cases**:\n\n` +
          `${formatTestCaseList(session.testCases)}\n\n` +
          `Reply **"approve all"** to proceed, or **"approve TC001,TC003,TC009"** to select specific cases, ` +
          `or **"reject TC004"** to exclude one.`,
        testCases: session.testCases,
        pageDiscovery: session.pageDiscovery,
        usingRealQwen: qwen.isUsingRealQwen(),
      });
    }

    if (session.state === "AWAITING_APPROVAL") {
      // Merge any custom test cases sent from the UI's "+ Add Test Case"
      // form before parsing approval, so they can be approved/run alongside
      // the AI-generated ones. Malformed entries are skipped, not trusted blindly.
      if (Array.isArray(customTestCases) && customTestCases.length > 0) {
        customTestCases.forEach((c, i) => {
          if (!c || !c.action || !c.action.type || (!c.action.fieldTestId && !c.action.fieldName)) return;
          const existingCustomCount = session.testCases.filter((t) => t.custom).length;
          const id = c.id && /^TC-C\d+$/.test(c.id) ? c.id : `TC-C${existingCustomCount + i + 1}`;
          if (session.testCases.some((t) => t.id === id)) return; // already merged
          const newCase = {
            id,
            title: c.title || `Custom check: ${c.action.fieldTestId || c.action.fieldName}`,
            type: "custom",
            priority: ["low", "medium", "high"].includes(c.priority) ? c.priority : "medium",
            custom: true,
            action: c.action,
            assertion: c.assertion || {},
            expectedResults: c.assertion?.message ? [c.assertion.message] : [],
          };
          session.testCases.push(newCase);
          db.saveTestCases(session.dbRunId, [newCase]).catch(() => {}); // fire-and-forget, non-blocking
        });
      }

      const allIds = session.testCases.map((tc) => tc.id);
      const parsed = parseApproval(message, allIds);
      if (!parsed) {
        return res.json({
          reply:
            'Not sure which cases to approve. Try **"approve all"** or list specific IDs, e.g. **"approve TC001,TC002,TC009"**.',
        });
      }

      session.approvedIds = parsed.approvedIds;
      const approvedTestCases = session.testCases.filter((tc) => session.approvedIds.includes(tc.id));

      if (approvedTestCases.length === 0) {
        return res.json({ reply: "No test cases approved — nothing to generate. Reply with IDs to approve, or \"approve all\"." });
      }

      const generated = await qwen.generateCypressCode({
        approvedTestCases,
        pageDiscovery: session.pageDiscovery,
        fileName: "customer-feedback.cy.js",
      });

      const validation = validateScript(generated.script);
      if (!validation.valid) {
        session.state = "AWAITING_APPROVAL";
        return res.json({
          reply: `⚠️ Generated script failed security/syntax validation and was NOT executed:\n${validation.errors.join("\n")}`,
        });
      }

      session.generatedScript = generated;
      session.state = "RUNNING";

      const execResult = await executeGeneratedTest(generated);
      const summary = execResult.ok ? execResult.summary : null;

      session.lastResults = { execResult, summary };
      session.state = "DONE";

      if (summary) await db.saveResults(session.dbRunId, summary.tests);

      if (!execResult.ok || !summary) {
        return res.json({
          reply:
            `✅ ${approvedTestCases.length} approved test cases converted to Cypress and passed security validation.\n\n` +
            `**Generated spec:** \`automation/cypress/e2e/generated/${generated.fileName}\`\n\n` +
            `⚠️ Could not execute Cypress automatically: ${execResult.error || "unknown error"}\n\n` +
            `Make sure you've run \`npm install\` inside \`automation/\` at least once, then you can also run it manually:\n\n` +
            `\`\`\`\ncd automation && npx cypress run --spec cypress/e2e/generated/${generated.fileName}\n\`\`\``,
          generatedScript: generated,
        });
      }

      const failedTests = summary.tests.filter((t) => t.fail);
      let failureAnalysisText = "";
      if (failedTests.length > 0) {
        const analyses = [];
        for (const t of failedTests) {
          const tcId = t.title?.match(/TC(?:\d{3}|-C\d+)/)?.[0];
          const tc = session.testCases.find((c) => c.id === tcId) || { id: tcId, title: t.title };
          const analysis = await qwen.analyzeFailure({
            story: session.story,
            testCase: tc,
            expected: tc.expectedResults?.join("; "),
            actual: t.err?.message || "Assertion failed",
          });
          analyses.push({ testCase: tc.id, ...analysis });
        }
        failureAnalysisText =
          "\n\n**Failure Analysis:**\n" +
          analyses
            .map((a) => `  • **${a.testCase}** [${a.classification}] — ${a.summary} (confidence ${Math.round(a.confidence * 100)}%)`)
            .join("\n");

        await db.saveFailureAnalyses(session.dbRunId, analyses);
      }

      return res.json({
        reply:
          `**Test Run Complete**\n` +
          `${summary.total} tests | ${summary.passed} passed | ${summary.failed} failed | ` +
          `${Math.round((summary.passed / summary.total) * 100)}% success rate` +
          failureAnalysisText,
        summary,
        generatedScript: generated,
      });
    }

    if (session.state === "DONE") {
      if (/^(run again|reset|new test|start over)$/i.test(message.trim())) {
        resetSession(sessionId);
        return res.json({ reply: "Session reset. Send a new story/URL to start a fresh test run." });
      }
      return res.json({
        reply: 'Run complete. Reply **"run again"** to start a new test, or send a new URL/story to begin fresh.',
      });
    }

    return res.json({ reply: "Unexpected state — resetting session.", });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ reply: `Error: ${err.message}` });
  }
});

router.post("/api/reset", (req, res) => {
  const { sessionId = "default" } = req.body;
  resetSession(sessionId);
  res.json({ ok: true });
});

module.exports = router;

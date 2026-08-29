const express = require("express");
const fs = require("fs");
const path = require("path");
const router = express.Router();

const { getSession } = require("../data/sessionStore");
const { cancelActiveExecution, getActiveExecution } = require("../services/singleSpecRunner");
const { REPORT_DIR, reportFileName } = require("../services/reportGenerator");

function currentRunId(session) {
  return session?.executionProgress?.runId || null;
}

router.post("/api/test-runs/cancel/:sessionId", async (req, res) => {
  const sessionId = req.params.sessionId || "default";
  const session = getSession(sessionId);
  const runId = currentRunId(session);

  if (!runId) {
    return res.json({ ok: true, cancelled: false, state: session.state, reply: "No active automation run was found." });
  }

  const active = getActiveExecution(runId);
  if (!active) {
    return res.json({ ok: true, cancelled: false, runId, state: session.state, reply: "The automation run is no longer active." });
  }

  const result = await cancelActiveExecution(runId, "Automation execution cancelled by user.");
  session.executionProgress = {
    ...(session.executionProgress || {}),
    cancelRequested: true,
    cancelled: true,
    cancelRequestedAt: new Date().toISOString(),
  };

  return res.status(202).json({
    ok: true,
    cancelled: result.cancelled,
    runId,
    state: result.state,
    reply: "Cancellation requested. TestNexus is closing the controlled Cypress/browser run.",
  });
});

router.post("/api/test-runs/reset/:sessionId", async (req, res) => {
  const sessionId = req.params.sessionId || "default";
  const session = getSession(sessionId);
  const runId = currentRunId(session);

  if (runId && getActiveExecution(runId)) {
    return res.status(409).json({
      ok: false,
      reply: "Cancel the running automation before resetting Execution & Analytics.",
    });
  }

  const analysisCancel = typeof global.__testNexusCancelFailureAnalysis === "function"
    ? global.__testNexusCancelFailureAnalysis(sessionId, "Execution & Analytics reset by user.")
    : { cancelled: false };

  session.failureAnalyses = [];
  session.lastResults = null;
  session.executionProgress = null;
  session.artifacts = null;
  session.reportHtml = null;
  session.generatedScript = [];
  session.state = Array.isArray(session.testCases) && session.testCases.length ? "AWAITING_APPROVAL" : "NEW";

  const reportPath = path.join(REPORT_DIR, reportFileName(sessionId));
  try { fs.rmSync(reportPath, { force: true }); } catch {}

  return res.json({
    ok: true,
    state: session.state,
    analysisCancelled: Boolean(analysisCancel?.cancelled),
    approvedIds: Array.isArray(session.approvedIds) ? session.approvedIds : [],
    runHistoryPreserved: true,
    reply: "Current execution and analytics were reset. Reviewed test cases and run history were preserved.",
  });
});

module.exports = router;

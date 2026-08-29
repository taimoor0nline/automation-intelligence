const express = require("express");
const fs = require("fs");
const path = require("path");
const router = express.Router();

const { getSession } = require("../data/sessionStore");
const { cancelActiveExecution, getActiveExecution } = require("../services/singleSpecRunner");
const {
  REPORT_DIR,
  reportFileName,
  buildAnalyticsReport,
  requestReportGeneration,
  clearReportGenerationRequest,
  removeReportFile,
} = require("../services/reportGenerator");

function allowQaManager(req, res, next) {
  if (!req.user) return next();
  const role = String(req.user.role || "").toUpperCase();
  if (!["QA", "MANAGER"].includes(role)) {
    return res.status(403).json({ reply: "QA or MANAGER role is required to control automation execution." });
  }
  next();
}

function currentRunId(session) {
  return session?.executionProgress?.runId || null;
}

router.post("/api/test-runs/cancel/:sessionId", allowQaManager, async (req, res) => {
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

router.post("/api/reports/:sessionId/generate", allowQaManager, (req, res) => {
  const sessionId = req.params.sessionId || "default";
  const session = getSession(sessionId);
  const summary = session.lastResults?.summary;

  if (!summary) {
    return res.status(409).json({ ok: false, reply: "Complete a test execution before generating the AI analysis report." });
  }
  if (session.state === "RUNNING") {
    return res.status(409).json({ ok: false, reply: "Wait for the current execution to complete before generating the report." });
  }

  requestReportGeneration(sessionId, summary);
  const html = buildAnalyticsReport({
    sessionId,
    story: session.story,
    targetUrl: session.targetUrl,
    environment: session.environment,
    summary,
    analyses: Array.isArray(session.failureAnalyses) ? session.failureAnalyses : [],
  });

  if (!html) {
    return res.status(500).json({ ok: false, reply: "The analytics report could not be generated." });
  }

  session.reportHtml = html;
  session.reportGeneratedAt = new Date().toISOString();
  session.reportGeneratedForRun = session.lastResults?.runNumber || null;

  return res.json({
    ok: true,
    runNumber: session.lastResults?.runNumber || null,
    total: Number(summary.total || 0),
    failed: Number(summary.failed || 0),
    analysisNeeded: Number(summary.failed || 0) > 0,
    reportUrl: `/api/reports/${encodeURIComponent(sessionId)}`,
    generatedAt: session.reportGeneratedAt,
  });
});

router.post("/api/test-runs/reset/:sessionId", allowQaManager, async (req, res) => {
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
  session.reportGeneratedAt = null;
  session.reportGeneratedForRun = null;
  session.generatedScript = [];
  session.state = Array.isArray(session.testCases) && session.testCases.length ? "AWAITING_APPROVAL" : "NEW";

  clearReportGenerationRequest(sessionId);
  removeReportFile(sessionId);
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

// Generation is mounted here as part of the already-active failure-analysis/control route tree.
// This keeps /api/generation/* available without adding startup coupling to the main server bootstrap.
router.use(require("./progressiveGeneration"));

module.exports = router;

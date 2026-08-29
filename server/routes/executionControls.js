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

  try {
    if (!summary) {
      return res.status(409).json({ ok: false, reply: "Complete a test execution before generating the AI analysis report." });
    }
    if (session.state === "RUNNING") {
      return res.status(409).json({ ok: false, reply: "Wait for the current execution to complete before generating the report." });
    }

    clearReportGenerationRequest(sessionId);
    removeReportFile(sessionId);

    if (!requestReportGeneration(sessionId, summary, Array.isArray(session.testCases) ? session.testCases : [])) {
      throw new Error("The completed execution summary could not be registered for report generation.");
    }

    const html = buildAnalyticsReport({
      sessionId,
      story: session.story,
      targetUrl: session.targetUrl,
      environment: session.environment,
      summary,
      analyses: Array.isArray(session.failureAnalyses) ? session.failureAnalyses : [],
      testCases: Array.isArray(session.testCases) ? session.testCases : [],
    });

    if (!html) {
      throw new Error("The report renderer rejected the completed execution summary.");
    }

    const reportPath = path.join(REPORT_DIR, reportFileName(sessionId));
    if (!fs.existsSync(reportPath) || fs.statSync(reportPath).size <= 0) {
      throw new Error("The report HTML was rendered but the report file was not written successfully.");
    }

    session.reportHtml = html;
    session.reportGeneratedAt = new Date().toISOString();
    session.reportGeneratedForRun = session.lastResults?.runNumber || null;
    session.reportGenerationError = null;

    return res.json({
      ok: true,
      runNumber: session.lastResults?.runNumber || null,
      total: Number(summary.total || 0),
      failed: Number(summary.failed || 0),
      analysisNeeded: Number(summary.failed || 0) > 0,
      reportUrl: `/api/reports/${encodeURIComponent(sessionId)}`,
      analysisStartUrl: Number(summary.failed || 0) > 0 ? "/api/test-results/analyze/start" : null,
      generatedAt: session.reportGeneratedAt,
    });
  } catch (err) {
    session.reportHtml = null;
    session.reportGenerationError = err.message || String(err);
    clearReportGenerationRequest(sessionId);
    removeReportFile(sessionId);
    console.error(`[report-generation] session=${sessionId} failed:`, err);
    return res.status(500).json({
      ok: false,
      reply: `AI analysis report generation failed: ${err.message || String(err)}`,
    });
  }
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
  session.reportGenerationError = null;
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

// Any new execution invalidates a previously requested/generated report for this session.
// The next report is created only after the user explicitly clicks Generate AI Analysis Report again.
router.use((req, _res, next) => {
  if (req.method === "POST" && req.path === "/api/test-runs/start") {
    const sessionId = String(req.body?.sessionId || "default");
    const session = getSession(sessionId);
    clearReportGenerationRequest(sessionId);
    removeReportFile(sessionId);
    session.reportHtml = null;
    session.reportGeneratedAt = null;
    session.reportGeneratedForRun = null;
    session.reportGenerationError = null;
  }
  next();
});

// Mount the active adaptive generator and deterministic execution routes through the
// already-mounted failure-analysis/control route tree.
router.use(require("./progressiveGenerationAdaptive"));
router.use(require("./isolatedExecution"));

module.exports = router;

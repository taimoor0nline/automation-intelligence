const express = require("express");
const { randomUUID } = require("crypto");
const router = express.Router();

const { getSession } = require("../data/sessionStore");
const qwen = require("../services/qwenClient");
const { buildAnalyticsReport, analysisHtml } = require("../services/reportGenerator");

const jobs = new Map();
const JOB_TTL_MS = 30 * 60 * 1000;

function boundedInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.trunc(parsed), max));
}

function analysisConcurrency() {
  return boundedInt(process.env.AI_FAILURE_ANALYSIS_CONCURRENCY, 2, 1, 5);
}

function key(sessionId, jobId) {
  return `${sessionId}:${jobId}`;
}

function scheduleExpiry(job) {
  const timer = setTimeout(() => jobs.delete(key(job.sessionId, job.jobId)), JOB_TTL_MS);
  timer.unref?.();
}

function closeClients(job) {
  for (const client of job.clients) {
    try { client.end(); } catch {}
  }
  job.clients.clear();
}

function send(job, type, payload = {}) {
  const event = { type, at: new Date().toISOString(), ...payload };
  job.events.push(event);
  if (job.events.length > 1500) job.events.splice(0, job.events.length - 1500);
  for (const client of job.clients) {
    try {
      client.write(`event: ${type}\ndata: ${JSON.stringify(event)}\n\n`);
    } catch {}
  }
}

function findingFor(session, testCaseId) {
  return (session.lastResults?.deterministicFindings || []).find((item) => String(item?.testCase || "").toUpperCase() === String(testCaseId || "").toUpperCase()) || null;
}

function actualFor(session, test, testCaseId) {
  const finding = findingFor(session, testCaseId);
  return String(finding?.observed || test?.err?.message || "Automation test failed.");
}

function testCaseFor(session, test) {
  const id = test?.testCaseId || String(test?.title || "").match(/TC(?:\d{3}|-H\d{3})/i)?.[0] || "UNKNOWN";
  return session.testCases.find((item) => String(item.id).toUpperCase() === String(id).toUpperCase()) || {
    id,
    title: test?.title || id,
    expectedResults: [],
  };
}

function failedTestsFor(session) {
  return (session.lastResults?.summary?.tests || []).filter((test) => test.fail);
}

function testForAnalysis(session, analysis) {
  const id = String(analysis?.testCase || "").toUpperCase();
  return failedTestsFor(session).find((test) => {
    const tc = testCaseFor(session, test);
    return String(tc.id || "").toUpperCase() === id;
  }) || { fail: true, title: analysis?.testCase || "Failed test" };
}

function latestJobForSession(sessionId, runNumber) {
  return [...jobs.values()]
    .filter((item) => item.sessionId === sessionId && Number(item.runNumber) === Number(runNumber))
    .sort((a, b) => Date.parse(b.startedAt || 0) - Date.parse(a.startedAt || 0))[0] || null;
}

function startedButIncomplete(job) {
  const completed = new Set((job.results || []).map((item) => String(item.testCase || "").toUpperCase()));
  const started = [];
  const seen = new Set();
  for (const event of job.events || []) {
    if (event.type !== "ANALYSIS_ITEM_STARTED") continue;
    const id = String(event.testCase || "").toUpperCase();
    if (!id || completed.has(id) || seen.has(id)) continue;
    seen.add(id);
    started.push(event.testCase);
  }
  return started;
}

function liveItems(session, results) {
  return (results || []).map((analysis) => {
    const test = testForAnalysis(session, analysis);
    return {
      testCase: analysis.testCase,
      analysis,
      analysisHtml: analysisHtml(analysis, test),
    };
  });
}

function updateReport(sessionId, session, analyses) {
  if (!session.lastResults?.summary) return;
  session.failureAnalyses = analyses;
  session.reportHtml = buildAnalyticsReport({
    sessionId,
    story: session.story,
    targetUrl: session.targetUrl,
    environment: session.environment,
    summary: session.lastResults.summary,
    analyses,
    model: session.aiModelTier || "strong",
  });
}

function cancelAnalysisForSession(sessionId, reason = "AI failure analysis cancelled.") {
  const job = [...jobs.values()].find((item) =>
    item.sessionId === sessionId && ["QUEUED", "RUNNING", "CANCELLING"].includes(item.state)
  );
  if (!job) return { cancelled: false, jobId: null };
  job.cancelRequested = true;
  job.cancelReason = reason;
  if (job.state !== "CANCELLING") {
    job.state = "CANCELLING";
    send(job, "ANALYSIS_CANCEL_REQUESTED", {
      runNumber: job.runNumber,
      completed: job.completed,
      totalFailed: job.totalFailed,
      reason,
    });
  }
  return { cancelled: true, jobId: job.jobId, runNumber: job.runNumber };
}

async function analyzeOne(session, test) {
  const tc = testCaseFor(session, test);
  const expected = Array.isArray(tc.expectedResults) ? tc.expectedResults.join("; ") : "";
  const actual = actualFor(session, test, tc.id);
  const analysis = await qwen.analyzeFailure({
    story: session.story,
    testCase: tc,
    expected,
    actual,
    modelTier: session.aiModelTier || "strong",
  });
  return { testCase: tc.id, ...analysis, actual: analysis.actual || actual };
}

async function runJob(job, sessionId, session, failures) {
  job.state = "RUNNING";
  send(job, "ANALYSIS_STARTED", {
    runNumber: job.runNumber,
    totalFailed: failures.length,
    concurrency: job.concurrency,
  });

  let cursor = 0;
  const workers = Array.from({ length: Math.min(job.concurrency, failures.length) }, (_, workerIndex) => (async () => {
    while (true) {
      if (job.cancelRequested) break;
      const index = cursor++;
      if (index >= failures.length) break;
      const test = failures[index];
      const tc = testCaseFor(session, test);
      send(job, "ANALYSIS_ITEM_STARTED", {
        runNumber: job.runNumber,
        index,
        workerNumber: workerIndex + 1,
        testCase: tc.id,
        title: tc.title,
        completed: job.completed,
        totalFailed: failures.length,
      });
      try {
        const analysis = await analyzeOne(session, test);
        if (job.cancelRequested) break;
        job.results.push(analysis);
        job.completed += 1;
        send(job, "ANALYSIS_ITEM_COMPLETED", {
          runNumber: job.runNumber,
          index,
          workerNumber: workerIndex + 1,
          testCase: tc.id,
          title: tc.title,
          analysis,
          analysisHtml: analysisHtml(analysis, test),
          completed: job.completed,
          totalFailed: failures.length,
        });
      } catch (err) {
        if (job.cancelRequested) break;
        job.completed += 1;
        job.failedAnalysisCount += 1;
        const fallback = {
          testCase: tc.id,
          classification: "ANALYSIS_ERROR",
          summary: "AI failure analysis could not complete for this test case.",
          actual: actualFor(session, test, tc.id),
          probableCause: err.message,
          severity: "medium",
          confidence: 0,
        };
        job.results.push(fallback);
        send(job, "ANALYSIS_ITEM_FAILED", {
          runNumber: job.runNumber,
          index,
          workerNumber: workerIndex + 1,
          testCase: tc.id,
          title: tc.title,
          analysis: fallback,
          analysisHtml: analysisHtml(fallback, test),
          error: err.message,
          completed: job.completed,
          totalFailed: failures.length,
        });
      }

      if (!job.cancelRequested && (job.completed % 5 === 0 || job.completed === failures.length)) {
        updateReport(sessionId, session, job.results);
        send(job, "ANALYSIS_CHECKPOINT", {
          runNumber: job.runNumber,
          completed: job.completed,
          totalFailed: failures.length,
          reportUrl: `/api/reports/${encodeURIComponent(sessionId)}`,
        });
      }
    }
  })());

  await Promise.all(workers);

  if (job.cancelRequested) {
    job.state = "CANCELLED";
    job.completedAt = new Date().toISOString();
    send(job, "ANALYSIS_CANCELLED", {
      runNumber: job.runNumber,
      completed: job.completed,
      totalFailed: failures.length,
      reason: job.cancelReason || "AI failure analysis cancelled.",
    });
    closeClients(job);
    scheduleExpiry(job);
    return;
  }

  updateReport(sessionId, session, job.results);

  const history = (session.runHistory || []).find((item) => item.runNumber === job.runNumber);
  if (history) {
    history.analysisStatus = "COMPLETED";
    history.failureAnalyses = job.results;
    history.analyzedAt = new Date().toISOString();
  }

  job.state = "COMPLETED";
  job.completedAt = new Date().toISOString();
  send(job, "ANALYSIS_COMPLETED", {
    runNumber: job.runNumber,
    completed: job.completed,
    totalFailed: failures.length,
    failedAnalysisCount: job.failedAnalysisCount,
    failureAnalyses: job.results,
    summary: session.lastResults.summary,
    reportUrl: `/api/reports/${encodeURIComponent(sessionId)}`,
  });

  closeClients(job);
  scheduleExpiry(job);
}

router.post("/api/test-results/analyze/start", (req, res) => {
  const { sessionId = "default" } = req.body || {};
  const session = getSession(sessionId);
  if (!session.lastResults?.summary) return res.status(409).json({ reply: "Run approved tests before requesting AI result analysis." });
  if (session.state === "RUNNING") return res.status(409).json({ reply: "Automation is still running. AI analysis starts only after execution completes." });

  const failures = failedTestsFor(session);
  if (!failures.length) {
    return res.json({ ok: true, analysisNeeded: false, totalFailed: 0, failureAnalyses: [] });
  }

  const runNumber = session.lastResults?.runNumber;
  const active = [...jobs.values()].find((item) =>
    item.sessionId === sessionId &&
    Number(item.runNumber) === Number(runNumber) &&
    ["QUEUED", "RUNNING", "CANCELLING"].includes(item.state)
  );
  if (active) {
    return res.status(202).json({
      ok: true,
      reused: true,
      jobId: active.jobId,
      runNumber: active.runNumber,
      totalFailed: active.totalFailed,
      concurrency: active.concurrency,
      eventsUrl: `/api/test-results/analyze/events/${encodeURIComponent(sessionId)}/${encodeURIComponent(active.jobId)}`,
    });
  }

  const jobId = `analysis-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const job = {
    jobId,
    sessionId,
    runNumber,
    state: "QUEUED",
    concurrency: analysisConcurrency(),
    totalFailed: failures.length,
    completed: 0,
    failedAnalysisCount: 0,
    results: [],
    events: [],
    clients: new Set(),
    startedAt: new Date().toISOString(),
    cancelRequested: false,
    cancelReason: null,
  };
  jobs.set(key(sessionId, jobId), job);
  session.failureAnalyses = [];

  setImmediate(() => runJob(job, sessionId, session, failures).catch((err) => {
    job.state = "FAILED";
    send(job, "ANALYSIS_FAILED", { runNumber: job.runNumber, error: err.message, completed: job.completed, totalFailed: failures.length });
    closeClients(job);
    scheduleExpiry(job);
  }));

  return res.status(202).json({
    ok: true,
    jobId,
    runNumber,
    totalFailed: failures.length,
    concurrency: job.concurrency,
    eventsUrl: `/api/test-results/analyze/events/${encodeURIComponent(sessionId)}/${encodeURIComponent(jobId)}`,
  });
});

router.get("/api/test-results/analyze/current/:sessionId", (req, res) => {
  const sessionId = req.params.sessionId || "default";
  const session = getSession(sessionId);
  const failures = failedTestsFor(session);
  if (!failures.length) {
    return res.json({
      ok: true,
      state: "NOT_REQUIRED",
      runNumber: session.lastResults?.runNumber || null,
      totalFailed: 0,
      completed: 0,
      items: [],
      startedTestCases: [],
    });
  }

  const runNumber = session.lastResults?.runNumber;
  const job = latestJobForSession(sessionId, runNumber);
  if (!job) {
    const stored = Array.isArray(session.failureAnalyses) ? session.failureAnalyses : [];
    return res.json({
      ok: true,
      state: stored.length >= failures.length ? "COMPLETED" : "PENDING",
      runNumber,
      totalFailed: failures.length,
      completed: stored.length,
      items: liveItems(session, stored),
      startedTestCases: [],
      eventsUrl: null,
      jobId: null,
    });
  }

  return res.json({
    ok: true,
    jobId: job.jobId,
    runNumber: job.runNumber,
    state: job.state,
    totalFailed: job.totalFailed,
    completed: job.completed,
    failedAnalysisCount: job.failedAnalysisCount,
    concurrency: job.concurrency,
    items: liveItems(session, job.results),
    startedTestCases: startedButIncomplete(job),
    eventsUrl: `/api/test-results/analyze/events/${encodeURIComponent(sessionId)}/${encodeURIComponent(job.jobId)}`,
  });
});

router.get("/api/test-results/analyze/events/:sessionId/:jobId", (req, res) => {
  const job = jobs.get(key(req.params.sessionId, req.params.jobId));
  if (!job) return res.status(404).json({ reply: "Analysis job was not found." });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  for (const event of job.events) {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  }

  if (["COMPLETED", "FAILED", "CANCELLED"].includes(job.state)) return res.end();
  job.clients.add(res);
  const keepAlive = setInterval(() => {
    try { res.write(": keep-alive\n\n"); } catch {}
  }, 15000);
  req.on("close", () => {
    clearInterval(keepAlive);
    job.clients.delete(res);
  });
});

router.get("/api/test-results/analyze/status/:sessionId/:jobId", (req, res) => {
  const job = jobs.get(key(req.params.sessionId, req.params.jobId));
  if (!job) return res.status(404).json({ reply: "Analysis job was not found." });
  return res.json({
    ok: true,
    jobId: job.jobId,
    runNumber: job.runNumber,
    state: job.state,
    totalFailed: job.totalFailed,
    completed: job.completed,
    failedAnalysisCount: job.failedAnalysisCount,
    concurrency: job.concurrency,
    failureAnalyses: job.results,
  });
});

router.cancelAnalysisForSession = cancelAnalysisForSession;
module.exports = router;

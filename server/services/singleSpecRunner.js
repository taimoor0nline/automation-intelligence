const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const { spawn, execFile } = require("child_process");
const { cleanupAutomationBrowsers } = require("./browserProcessCleanup");

const AUTOMATION_DIR = path.join(__dirname, "..", "..", "automation-system");
const SPEC_DIR = path.join(AUTOMATION_DIR, "tests", "e2e", "generated");
const ARTIFACT_DIR = path.join(AUTOMATION_DIR, "artifacts");
const VIDEO_DIR = path.join(ARTIFACT_DIR, "videos");
const SCREENSHOT_DIR = path.join(ARTIFACT_DIR, "screenshots");
const PROGRESS_DIR = path.join(ARTIFACT_DIR, "progress");
const ENGINE_CONFIG = path.join(AUTOMATION_DIR, "engine.config.js");
const REPORTER_PATH = path.join(AUTOMATION_DIR, "reporters", "result-file-reporter.js");
const RESULT_FILE = path.join(ARTIFACT_DIR, "latest-run-result.json");
const TEST_ID_REGEX = /TC(?:\d{3}|-H\d{3})/i;

function boolEnv(value, fallback) {
  if (value == null || value === "") return fallback;
  return !["false", "0", "no", "off"].includes(String(value).toLowerCase());
}

function numberEnv(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tcIdFromText(value) {
  return String(value || "").match(TEST_ID_REGEX)?.[0]?.toUpperCase() || null;
}

function prepareSpec(generated) {
  fs.rmSync(SPEC_DIR, { recursive: true, force: true });
  fs.mkdirSync(SPEC_DIR, { recursive: true });

  const fileName = "ai-generated.cy.js";
  const specPath = path.join(SPEC_DIR, fileName);
  fs.writeFileSync(specPath, generated.script, "utf8");

  if (!fs.existsSync(specPath)) throw new Error(`Generated automation spec was not written: ${specPath}`);

  return {
    fileName,
    specPath,
    automationRelativeSpecPath: path.relative(AUTOMATION_DIR, specPath).replace(/\\/g, "/"),
  };
}

function removeOldArtifacts(progressFile) {
  fs.rmSync(VIDEO_DIR, { recursive: true, force: true });
  fs.rmSync(SCREENSHOT_DIR, { recursive: true, force: true });
  fs.rmSync(RESULT_FILE, { force: true });
  fs.rmSync(`${RESULT_FILE}.tmp`, { force: true });
  if (progressFile) {
    fs.rmSync(progressFile, { force: true });
    fs.rmSync(`${progressFile}.tmp`, { force: true });
  }
}

function findFiles(root, extension) {
  if (!fs.existsSync(root)) return [];
  const out = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && full.toLowerCase().endsWith(extension)) out.push(full);
    }
  }
  return out;
}

function collectArtifacts(tests, forcedTeardown) {
  const screenshotsByTestCase = {};
  for (const filePath of findFiles(SCREENSHOT_DIR, ".png")) {
    const id = tcIdFromText(filePath);
    if (id) screenshotsByTestCase[id] = path.resolve(filePath);
  }
  const videoFiles = forcedTeardown ? [] : findFiles(VIDEO_DIR, ".mp4");
  const sharedVideo = videoFiles.length ? path.resolve(videoFiles[0]) : null;
  const videosByTestCase = {};
  for (const test of tests) if (test.fail && test.testCaseId && sharedVideo) videosByTestCase[test.testCaseId] = sharedVideo;
  return { sharedVideo, videosByTestCase, screenshotsByTestCase };
}

function summarizeReporterResult(raw, browser, forcedTeardown) {
  const tests = (raw.tests || []).map((test) => {
    const testCaseId = tcIdFromText(test.title);
    const failed = test.state === "failed";
    return {
      title: test.title,
      testCaseId,
      pass: test.state === "passed",
      fail: failed,
      state: test.state,
      durationMs: Number.isFinite(Number(test.durationMs)) ? Math.round(Number(test.durationMs)) : null,
      err: test.err?.message ? { message: test.err.message } : null,
      evidence: {},
    };
  });

  const artifacts = collectArtifacts(tests, forcedTeardown);
  for (const test of tests) {
    test.evidence = {
      videoAvailable: Boolean(test.testCaseId && artifacts.videosByTestCase[test.testCaseId]),
      screenshotAvailable: Boolean(test.testCaseId && artifacts.screenshotsByTestCase[test.testCaseId]),
      videoScope: test.fail && artifacts.sharedVideo ? "full-run" : null,
    };
  }

  return {
    summary: {
      total: Number(raw.total || tests.length),
      passed: Number(raw.passed || 0),
      failed: Number(raw.failed || 0),
      pending: Number(raw.pending || 0),
      skipped: Number(raw.skipped || 0),
      durationMs: Number.isFinite(Number(raw.durationMs)) ? Math.round(Number(raw.durationMs)) : null,
      browser,
      tests,
      forcedTeardown,
    },
    artifacts,
  };
}

function normalizeLiveProgress(raw, browser, expectedTotal) {
  const tests = (raw?.tests || []).map((test) => {
    const testCaseId = tcIdFromText(test.title);
    return {
      title: String(test.title || ""),
      testCaseId,
      pass: test.state === "passed",
      fail: test.state === "failed",
      state: String(test.state || "unknown"),
      durationMs: Number.isFinite(Number(test.durationMs)) ? Math.round(Number(test.durationMs)) : null,
      err: test.err?.message ? { message: String(test.err.message) } : null,
      evidence: {},
    };
  });
  return {
    complete: Boolean(raw?.complete),
    total: Number(expectedTotal || tests.length),
    completed: tests.length,
    passed: tests.filter((test) => test.pass).length,
    failed: tests.filter((test) => test.fail).length,
    pending: Math.max(0, Number(expectedTotal || tests.length) - tests.length),
    durationMs: Number.isFinite(Number(raw?.durationMs)) ? Math.round(Number(raw.durationMs)) : null,
    browser,
    tests,
    updatedAt: raw?.updatedAt || new Date().toISOString(),
  };
}

function killProcessTree(pid) {
  if (!pid) return Promise.resolve();
  if (process.platform === "win32") {
    return new Promise((resolve) => {
      execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => resolve());
    });
  }
  try { process.kill(pid, "SIGTERM"); } catch {}
  return Promise.resolve();
}

function validateRuntimeContext(executionContext = {}) {
  if (String(executionContext.targetType || 'WEB').toUpperCase() === 'REST') {
    const auth = executionContext.apiAuth || { type: 'NONE' };
    const type = String(auth.type || 'NONE').toUpperCase();
    if (!['NONE','BASIC','BEARER','API_KEY_HEADER'].includes(type)) throw new Error(`Unsupported REST authentication type: ${type}.`);
    if (type !== 'NONE' && !auth.secret) throw new Error('REST authentication secret is missing before API execution.');
    if (type === 'BASIC' && !auth.username) throw new Error('REST basic-auth username is missing before API execution.');
    if (type === 'API_KEY_HEADER' && !auth.headerName) throw new Error('REST API-key header name is missing before API execution.');
    console.log(`[runtime-preflight] target=REST auth=${type} base-url=${executionContext.baseUrl || '(missing)'}`);
    return;
  }

  const credentialsPresent = Boolean(executionContext.credentials?.username && executionContext.credentials?.password);
  const selectorsPresent = Boolean(
    executionContext.loginSelectors?.username &&
    executionContext.loginSelectors?.password &&
    executionContext.loginSelectors?.submit
  );

  console.log(
    `[runtime-preflight] credentials=${credentialsPresent ? "present" : "missing"} ` +
    `login-controls=${selectorsPresent ? "grounded" : "missing"} ` +
    `login-path=${executionContext.loginPath || "/"}`
  );

  if (executionContext.hasCredentials && !credentialsPresent) {
    throw new Error("Runtime credentials were expected by readiness validation but are missing before automation execution.");
  }
  if (executionContext.hasCredentials && !selectorsPresent) {
    throw new Error("Runtime login controls were expected but are missing before automation execution.");
  }
}

async function runAutomationCli({ prepared, executionContext, browser, headed, demoStepDelayMs, video, screenshotOnRunFailure, screenshotEachTest, completionPauseMs, runId, progressFile, expectedTotal, onProgress }) {
  const cypressBin = path.join(AUTOMATION_DIR, "node_modules", "cypress", "bin", "cypress");
  if (!fs.existsSync(cypressBin)) throw new Error("Automation engine dependency is not installed inside automation-system/. Run: cd automation-system && npm install.");
  if (!fs.existsSync(REPORTER_PATH)) throw new Error(`Automation result reporter is missing: ${REPORTER_PATH}`);

  validateRuntimeContext(executionContext);

  const args = [
    cypressBin,
    "run",
    "--project", AUTOMATION_DIR,
    "--config-file", ENGINE_CONFIG,
    "--spec", prepared.automationRelativeSpecPath,
    "--browser", browser,
    "--reporter", REPORTER_PATH,
  ];
  if (headed) args.push("--headed", "--no-runner-ui");
  else args.push("--headless");

  const apiAuth = executionContext.apiAuth || {};
  const env = {
    ...process.env,
    AUTOMATION_RUN_ID: runId,
    AUTOMATION_RESULT_FILE: RESULT_FILE,
    AUTOMATION_PROGRESS_FILE: progressFile,
    AUTOMATION_BASE_URL: executionContext.baseUrl || process.env.TEST_BASE_URL || "http://localhost:4000",
    AUTOMATION_VIDEO: String(video),
    AUTOMATION_SCREENSHOT_ON_FAILURE: String(screenshotOnRunFailure),
    AUTOMATION_SCREENSHOT_EACH_TEST: String(screenshotEachTest),
    AUTOMATION_TEST_COMPLETION_PAUSE_MS: String(completionPauseMs),
    TEST_USERNAME: executionContext.credentials?.username || "",
    TEST_PASSWORD: executionContext.credentials?.password || "",
    LOGIN_PATH: executionContext.loginPath || "/",
    LOGIN_USERNAME_SELECTOR: executionContext.loginSelectors?.username || "",
    LOGIN_PASSWORD_SELECTOR: executionContext.loginSelectors?.password || "",
    LOGIN_SUBMIT_SELECTOR: executionContext.loginSelectors?.submit || "",
    REST_AUTH_TYPE: String(apiAuth.type || 'NONE').toUpperCase(),
    REST_AUTH_USERNAME: apiAuth.username || '',
    REST_AUTH_SECRET: apiAuth.secret || '',
    REST_AUTH_HEADER: apiAuth.headerName || '',
    DEMO_STEP_DELAY_MS: String(demoStepDelayMs),
  };

  let child = null;
  let closed = false;
  let exitCode = null;
  let lastProgressCount = -1;
  try {
    child = spawn(process.execPath, args, {
      cwd: AUTOMATION_DIR,
      env,
      windowsHide: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => process.stdout.write(chunk));
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.on("close", (code) => { closed = true; exitCode = code; });

    const overallTimeoutMs = Math.max(30000, Math.min(numberEnv(process.env.AUTOMATION_ENGINE_TIMEOUT_MS, 120000), 600000));
    const exitGraceMs = Math.max(1000, Math.min(numberEnv(process.env.AUTOMATION_ENGINE_EXIT_GRACE_MS, 5000), 30000));
    const startedAt = Date.now();
    let reporterResult = null;

    while (Date.now() - startedAt < overallTimeoutMs) {
      if (progressFile && fs.existsSync(progressFile)) {
        try {
          const rawProgress = JSON.parse(fs.readFileSync(progressFile, "utf8"));
          const progress = normalizeLiveProgress(rawProgress, browser, expectedTotal);
          if (progress.completed !== lastProgressCount) {
            lastProgressCount = progress.completed;
            if (typeof onProgress === "function") onProgress(progress);
          }
        } catch {}
      }
      if (fs.existsSync(RESULT_FILE)) {
        try { reporterResult = JSON.parse(fs.readFileSync(RESULT_FILE, "utf8")); break; } catch {}
      }
      if (closed) break;
      await delay(150);
    }

    if (!reporterResult) {
      await killProcessTree(child.pid);
      throw new Error(closed
        ? `Automation engine exited before producing test results (exit code ${exitCode}).`
        : `Automation engine did not produce test results within ${Math.round(overallTimeoutMs / 1000)}s.`);
    }

    console.log(`[single-spec-runner] Test results captured before teardown: ${reporterResult.passed} passed, ${reporterResult.failed} failed.`);
    const graceStartedAt = Date.now();
    while (!closed && Date.now() - graceStartedAt < exitGraceMs) await delay(200);

    let forcedTeardown = false;
    if (!closed) {
      forcedTeardown = true;
      console.warn(`[single-spec-runner] Browser teardown exceeded ${exitGraceMs}ms; closing the automation process tree so analytics can continue.`);
      await killProcessTree(child.pid);
      await delay(750);
    } else {
      console.log(`[single-spec-runner] Automation process exited cleanly with code ${exitCode}.`);
    }

    return { reporterResult, forcedTeardown };
  } finally {
    if (child && !closed) await killProcessTree(child.pid);
    await cleanupAutomationBrowsers({ runId, reason: `post-run ${runId}`, log: true });
  }
}

async function executeSingleGeneratedSpec(generated, executionContext = {}, options = {}) {
  let prepared = null;
  const runId = `run-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const progressFile = path.join(PROGRESS_DIR, `${runId}.json`);
  try {
    prepared = prepareSpec(generated);
    const headed = options.headed == null ? boolEnv(process.env.AUTOMATION_HEADED, true) : Boolean(options.headed);
    const browser = options.browser || process.env.AUTOMATION_BROWSER || "chrome";
    const demoStepDelayMs = Math.max(0, Math.min(numberEnv(options.demoStepDelayMs, numberEnv(process.env.AUTOMATION_STEP_DELAY_MS, 0)), 3000));
    const video = options.video == null ? boolEnv(process.env.AUTOMATION_VIDEO, true) : Boolean(options.video);
    const screenshotOnRunFailure = options.screenshotOnRunFailure == null ? boolEnv(process.env.AUTOMATION_SCREENSHOT_ON_FAILURE, true) : Boolean(options.screenshotOnRunFailure);
    const screenshotEachTest = options.screenshotEachTest == null ? boolEnv(process.env.AUTOMATION_SCREENSHOT_EACH_TEST, true) : Boolean(options.screenshotEachTest);
    const completionPauseMs = Math.max(0, Math.min(numberEnv(options.completionPauseMs, numberEnv(process.env.AUTOMATION_TEST_COMPLETION_PAUSE_MS, 5000)), 30000));
    const expectedTotal = Array.isArray(options.approvedIds) ? options.approvedIds.length : 0;

    removeOldArtifacts(progressFile);
    fs.mkdirSync(PROGRESS_DIR, { recursive: true });
    console.log(`[single-spec-runner] Running one spec containing all approved cases in ${browser} (${headed ? "headed" : "headless"})` + (demoStepDelayMs ? ` with ${demoStepDelayMs}ms demo step delay` : ""));
    console.log(`[single-spec-runner] Run ownership id: ${runId}`);
    console.log(`[single-spec-runner] Spec: ${prepared.automationRelativeSpecPath}`);
    console.log("[single-spec-runner] Results are captured incrementally after each test while the same browser session continues.");

    if (typeof options.onStart === "function") options.onStart({ runId, browser, total: expectedTotal });
    const run = await runAutomationCli({
      prepared,
      executionContext,
      browser,
      headed,
      demoStepDelayMs,
      video,
      screenshotOnRunFailure,
      screenshotEachTest,
      completionPauseMs,
      runId,
      progressFile,
      expectedTotal,
      onProgress: options.onProgress,
    });
    const summarized = summarizeReporterResult(run.reporterResult, browser, run.forcedTeardown);
    if (typeof options.onProgress === "function") {
      options.onProgress({
        ...summarized.summary,
        completed: summarized.summary.tests.length,
        complete: true,
        updatedAt: new Date().toISOString(),
      });
    }
    return { ok: true, runId, specPath: prepared.specPath, summary: summarized.summary, artifacts: summarized.artifacts, error: null };
  } catch (err) {
    console.error("[single-spec-runner] Automation execution failed:", err);
    await cleanupAutomationBrowsers({ runId, reason: `failed run ${runId}`, log: true });
    return { ok: false, runId, specPath: prepared?.specPath || null, summary: null, artifacts: null, error: err.message || String(err) };
  }
}

module.exports = { executeSingleGeneratedSpec };

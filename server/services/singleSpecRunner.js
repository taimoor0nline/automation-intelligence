const fs = require("fs");
const path = require("path");
const { spawn, execFile } = require("child_process");

const AUTOMATION_DIR = path.join(__dirname, "..", "..", "automation-system");
const SPEC_DIR = path.join(AUTOMATION_DIR, "tests", "e2e", "generated");
const ARTIFACT_DIR = path.join(AUTOMATION_DIR, "artifacts");
const VIDEO_DIR = path.join(ARTIFACT_DIR, "videos");
const SCREENSHOT_DIR = path.join(ARTIFACT_DIR, "screenshots");
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

  if (!fs.existsSync(specPath)) {
    throw new Error(`Generated automation spec was not written: ${specPath}`);
  }

  return {
    fileName,
    specPath,
    automationRelativeSpecPath: path.relative(AUTOMATION_DIR, specPath).replace(/\\/g, "/"),
  };
}

function removeOldArtifacts() {
  fs.rmSync(VIDEO_DIR, { recursive: true, force: true });
  fs.rmSync(SCREENSHOT_DIR, { recursive: true, force: true });
  fs.rmSync(RESULT_FILE, { force: true });
  fs.rmSync(`${RESULT_FILE}.tmp`, { force: true });
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

  // A video is considered usable only when the engine exits cleanly. If the
  // Windows teardown watchdog has to terminate the process tree, the video may
  // not have been finalized, so do not expose a potentially corrupt file.
  const videoFiles = forcedTeardown ? [] : findFiles(VIDEO_DIR, ".mp4");
  const sharedVideo = videoFiles.length ? path.resolve(videoFiles[0]) : null;
  const videosByTestCase = {};

  for (const test of tests) {
    if (test.fail && test.testCaseId && sharedVideo) {
      videosByTestCase[test.testCaseId] = sharedVideo;
    }
  }

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

function killProcessTree(pid) {
  if (!pid) return Promise.resolve();

  if (process.platform === "win32") {
    return new Promise((resolve) => {
      execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => resolve());
    });
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Process may already have exited.
  }
  return Promise.resolve();
}

async function runAutomationCli({ prepared, executionContext, browser, headed, demoStepDelayMs, video, screenshotOnRunFailure }) {
  const cypressBin = path.join(AUTOMATION_DIR, "node_modules", "cypress", "bin", "cypress");
  if (!fs.existsSync(cypressBin)) {
    throw new Error("Automation engine dependency is not installed inside automation-system/. Run: cd automation-system && npm install.");
  }
  if (!fs.existsSync(REPORTER_PATH)) {
    throw new Error(`Automation result reporter is missing: ${REPORTER_PATH}`);
  }

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

  const env = {
    ...process.env,
    AUTOMATION_RESULT_FILE: RESULT_FILE,
    AUTOMATION_BASE_URL: executionContext.baseUrl || process.env.TEST_BASE_URL || "http://localhost:4000",
    AUTOMATION_VIDEO: String(video),
    AUTOMATION_SCREENSHOT_ON_FAILURE: String(screenshotOnRunFailure),
    TEST_USERNAME: executionContext.credentials?.username || "",
    TEST_PASSWORD: executionContext.credentials?.password || "",
    DEMO_STEP_DELAY_MS: String(demoStepDelayMs),
  };

  const child = spawn(process.execPath, args, {
    cwd: AUTOMATION_DIR,
    env,
    windowsHide: false,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));

  let closed = false;
  let exitCode = null;
  child.on("close", (code) => {
    closed = true;
    exitCode = code;
  });

  const overallTimeoutMs = Math.max(30000, Math.min(numberEnv(process.env.AUTOMATION_ENGINE_TIMEOUT_MS, 120000), 600000));
  const exitGraceMs = Math.max(1000, Math.min(numberEnv(process.env.AUTOMATION_ENGINE_EXIT_GRACE_MS, 5000), 30000));
  const startedAt = Date.now();
  let reporterResult = null;

  while (Date.now() - startedAt < overallTimeoutMs) {
    if (fs.existsSync(RESULT_FILE)) {
      try {
        reporterResult = JSON.parse(fs.readFileSync(RESULT_FILE, "utf8"));
        break;
      } catch {
        // Reporter writes atomically, but retry if antivirus/file locking races.
      }
    }

    if (closed) break;
    await delay(200);
  }

  if (!reporterResult) {
    await killProcessTree(child.pid);
    throw new Error(
      closed
        ? `Automation engine exited before producing test results (exit code ${exitCode}).`
        : `Automation engine did not produce test results within ${Math.round(overallTimeoutMs / 1000)}s.`
    );
  }

  console.log(`[single-spec-runner] Test results captured before teardown: ${reporterResult.passed} passed, ${reporterResult.failed} failed.`);

  const graceStartedAt = Date.now();
  while (!closed && Date.now() - graceStartedAt < exitGraceMs) {
    await delay(200);
  }

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
}

async function executeSingleGeneratedSpec(generated, executionContext = {}) {
  let prepared = null;

  try {
    prepared = prepareSpec(generated);
    const headed = boolEnv(process.env.AUTOMATION_HEADED, true);
    const browser = process.env.AUTOMATION_BROWSER || "chrome";
    const demoStepDelayMs = Math.max(0, Math.min(numberEnv(process.env.AUTOMATION_STEP_DELAY_MS, 0), 3000));
    const video = boolEnv(process.env.AUTOMATION_VIDEO, true);
    const screenshotOnRunFailure = boolEnv(process.env.AUTOMATION_SCREENSHOT_ON_FAILURE, true);

    removeOldArtifacts();

    console.log(
      `[single-spec-runner] Running one spec containing all approved cases in ${browser} (${headed ? "headed" : "headless"})` +
      (demoStepDelayMs ? ` with ${demoStepDelayMs}ms demo step delay` : "")
    );
    console.log(`[single-spec-runner] Spec: ${prepared.automationRelativeSpecPath}`);
    console.log("[single-spec-runner] Results are captured as soon as the tests finish; browser teardown cannot block analytics/report generation.");

    const run = await runAutomationCli({
      prepared,
      executionContext,
      browser,
      headed,
      demoStepDelayMs,
      video,
      screenshotOnRunFailure,
    });

    const summarized = summarizeReporterResult(run.reporterResult, browser, run.forcedTeardown);
    return {
      ok: true,
      specPath: prepared.specPath,
      summary: summarized.summary,
      artifacts: summarized.artifacts,
      error: null,
    };
  } catch (err) {
    console.error("[single-spec-runner] Automation execution failed:", err);
    return {
      ok: false,
      specPath: prepared?.specPath || null,
      summary: null,
      artifacts: null,
      error: err.message || String(err),
    };
  }
}

module.exports = { executeSingleGeneratedSpec };

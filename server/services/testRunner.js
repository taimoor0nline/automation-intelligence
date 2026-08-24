const fs = require("fs");
const path = require("path");

const AUTOMATION_DIR = path.join(__dirname, "..", "..", "automation-system");
const SPEC_DIR = path.join(AUTOMATION_DIR, "tests", "e2e", "generated");
const VIDEO_DIR = path.join(AUTOMATION_DIR, "artifacts", "videos");
const SCREENSHOT_DIR = path.join(AUTOMATION_DIR, "artifacts", "screenshots");
const ENGINE_CONFIG = path.join(AUTOMATION_DIR, "engine.config.js");
const TEST_ID_REGEX = /TC(?:\d{3}|-H\d{3})/i;

function boolEnv(value, fallback) {
  if (value == null || value === "") return fallback;
  return !["false", "0", "no", "off"].includes(String(value).toLowerCase());
}

function numberEnv(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function tcIdFromText(value) {
  return String(value || "").match(TEST_ID_REGEX)?.[0]?.toUpperCase() || null;
}

function clearGeneratedSpecs() {
  fs.rmSync(SPEC_DIR, { recursive: true, force: true });
  fs.mkdirSync(SPEC_DIR, { recursive: true });
}

function writeSpecs(generatedSpecs) {
  clearGeneratedSpecs();
  return generatedSpecs.map((spec, index) => {
    const testCaseId = String(
      spec.testCaseId || tcIdFromText(spec.fileName) || `TC-H${String(index + 1).padStart(3, "0")}`
    ).toUpperCase();
    const safeName = path.basename(spec.fileName || `${testCaseId}.cy.js`);
    const specPath = path.join(SPEC_DIR, safeName);
    fs.writeFileSync(specPath, spec.script, "utf8");

    if (!fs.existsSync(specPath)) {
      throw new Error(`Generated automation spec was not written: ${specPath}`);
    }

    return {
      ...spec,
      testCaseId,
      safeName,
      specPath,
      relativeSpecPath: path.relative(AUTOMATION_DIR, specPath).replace(/\\/g, "/"),
    };
  });
}

function removeOldArtifacts() {
  fs.rmSync(VIDEO_DIR, { recursive: true, force: true });
  fs.rmSync(SCREENSHOT_DIR, { recursive: true, force: true });
}

async function loadAutomationEngine() {
  const engineModulePath = path.join(AUTOMATION_DIR, "node_modules", "cypress");
  try {
    return require(engineModulePath);
  } catch (err) {
    throw new Error(
      `Automation engine dependency is not installed inside automation-system/. Run: cd automation-system && npm install. Details: ${err.message}`
    );
  }
}

function resolveDurationMs(test, attempt, run) {
  const candidates = [
    attempt?.wallClockDuration,
    attempt?.duration,
    test?.duration,
    run?.stats?.duration,
  ];

  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return Math.round(n);
  }

  return null;
}

function engineFailureMessage(result) {
  if (!result) return "Automation engine returned no result.";
  if (typeof result.message === "string" && result.message.trim()) return result.message.trim();
  if (typeof result.error === "string" && result.error.trim()) return result.error.trim();
  if (result.status === "failed") {
    const failures = Number(result.failures);
    return Number.isFinite(failures)
      ? `Automation engine failed before test execution (${failures} failure${failures === 1 ? "" : "s"}).`
      : "Automation engine failed before test execution.";
  }
  return `Automation engine returned an unexpected result shape (keys: ${Object.keys(result).join(", ") || "none"}).`;
}

function summarize(result) {
  if (!result || typeof result.totalTests !== "number") {
    return { summary: null, diagnostic: engineFailureMessage(result), artifacts: null };
  }

  const runs = Array.isArray(result.runs) ? result.runs : [];
  if (!runs.length) {
    return { summary: null, diagnostic: "Automation completed without run details.", artifacts: null };
  }

  const tests = [];
  const videosByTestCase = {};
  const screenshotsByTestCase = {};

  for (const run of runs) {
    const runSpecText = `${run.spec?.name || ""} ${run.spec?.relative || ""} ${run.spec?.absolute || ""}`;
    const runTestCaseId = tcIdFromText(runSpecText);
    const videoPath = run.video && fs.existsSync(run.video) ? path.resolve(run.video) : null;
    if (runTestCaseId && videoPath) videosByTestCase[runTestCaseId] = videoPath;

    const screenshotEntries = (run.screenshots || [])
      .filter((item) => item?.path && fs.existsSync(item.path))
      .map((item) => ({
        path: path.resolve(item.path),
        testCaseId: tcIdFromText(`${item.path} ${item.name || ""}`) || runTestCaseId,
      }));

    for (const item of screenshotEntries) {
      if (item.testCaseId) screenshotsByTestCase[item.testCaseId] = item.path;
    }

    for (const test of run.tests || []) {
      const attempt = test.attempts?.[test.attempts.length - 1] || {};
      const title = Array.isArray(test.title) ? test.title.join(" ") : test.title;
      const testCaseId = tcIdFromText(title) || runTestCaseId;
      tests.push({
        title,
        testCaseId,
        pass: test.state === "passed",
        fail: test.state === "failed",
        state: test.state,
        durationMs: resolveDurationMs(test, attempt, run),
        err: test.displayError ? { message: test.displayError } : null,
        evidence: {
          videoAvailable: Boolean(testCaseId && videosByTestCase[testCaseId]),
          screenshotAvailable: Boolean(testCaseId && screenshotsByTestCase[testCaseId]),
        },
      });
    }
  }

  return {
    summary: {
      total: result.totalTests,
      passed: result.totalPassed,
      failed: result.totalFailed,
      pending: result.totalPending || 0,
      skipped: result.totalSkipped || 0,
      durationMs: Number.isFinite(Number(result.totalDuration)) ? Math.round(Number(result.totalDuration)) : null,
      browser: result.browser?.displayName || result.browser?.name || runs[0]?.browser?.displayName || runs[0]?.browser?.name || null,
      tests,
    },
    artifacts: {
      videosByTestCase,
      screenshotsByTestCase,
    },
    diagnostic: null,
  };
}

async function executeGeneratedTests(generatedSpecs, executionContext = {}) {
  let writtenSpecs = [];

  try {
    writtenSpecs = writeSpecs(generatedSpecs);
    const automationEngine = await loadAutomationEngine();
    const headed = boolEnv(process.env.AUTOMATION_HEADED, true);
    const browser = process.env.AUTOMATION_BROWSER || "chrome";
    const baseUrl = executionContext.baseUrl || process.env.TEST_BASE_URL || "http://localhost:4000";
    const demoStepDelayMs = Math.max(0, Math.min(numberEnv(process.env.AUTOMATION_STEP_DELAY_MS, 0), 3000));
    const video = boolEnv(process.env.AUTOMATION_VIDEO, true);
    const screenshotOnRunFailure = boolEnv(process.env.AUTOMATION_SCREENSHOT_ON_FAILURE, true);

    removeOldArtifacts();

    // Cypress resolves `spec` from the Node process working directory, not from
    // the `project` option. npm start runs from the repository root, so include
    // automation-system/ in the spec path. All specs run in one Cypress run;
    // Cypress still creates a separate video for each spec/test case.
    const cwdRelativeSpecPattern = path
      .join(path.relative(process.cwd(), SPEC_DIR), "*.cy.js")
      .replace(/\\/g, "/");

    console.log(
      `[test-runner] Running ${writtenSpecs.length} test case(s) in ${browser} (${headed ? "headed" : "headless"})` +
      (demoStepDelayMs ? ` with ${demoStepDelayMs}ms demo step delay` : "")
    );
    console.log(`[test-runner] Spec pattern: ${cwdRelativeSpecPattern}`);

    const result = await automationEngine.run({
      project: AUTOMATION_DIR,
      configFile: ENGINE_CONFIG,
      testingType: "e2e",
      spec: cwdRelativeSpecPattern,
      browser,
      headed,
      env: {
        TEST_USERNAME: executionContext.credentials?.username || "",
        TEST_PASSWORD: executionContext.credentials?.password || "",
        DEMO_STEP_DELAY_MS: demoStepDelayMs,
      },
      config: {
        baseUrl,
        video,
        screenshotOnRunFailure,
        videosFolder: "artifacts/videos",
        screenshotsFolder: "artifacts/screenshots",
      },
    });

    const { summary, diagnostic, artifacts } = summarize(result);
    if (!summary) {
      console.error("[test-runner] Engine result:", result);
      return {
        specPaths: writtenSpecs.map((item) => item.specPath),
        ok: false,
        summary: null,
        artifacts: null,
        error: diagnostic,
      };
    }

    return {
      specPaths: writtenSpecs.map((item) => item.specPath),
      ok: true,
      summary,
      artifacts,
      error: null,
    };
  } catch (err) {
    console.error("[test-runner] Automation execution failed:", err);
    return {
      specPaths: writtenSpecs.map((item) => item.specPath),
      ok: false,
      summary: null,
      artifacts: null,
      error: err.message || String(err),
    };
  }
}

module.exports = { executeGeneratedTests, SPEC_DIR };

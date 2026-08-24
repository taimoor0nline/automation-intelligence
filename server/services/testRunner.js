const fs = require("fs");
const path = require("path");

const AUTOMATION_DIR = path.join(__dirname, "..", "..", "automation");
const SPEC_DIR = path.join(AUTOMATION_DIR, "cypress", "e2e", "generated");
const VIDEO_DIR = path.join(AUTOMATION_DIR, "cypress", "videos");
const SCREENSHOT_DIR = path.join(AUTOMATION_DIR, "cypress", "screenshots");
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
    const testCaseId = String(spec.testCaseId || tcIdFromText(spec.fileName) || `TC-H${String(index + 1).padStart(3, "0")}`).toUpperCase();
    const safeName = path.basename(spec.fileName || `${testCaseId}.cy.js`);
    const specPath = path.join(SPEC_DIR, safeName);
    fs.writeFileSync(specPath, spec.script, "utf8");
    return { ...spec, testCaseId, safeName, specPath };
  });
}

function removeOldArtifacts() {
  fs.rmSync(VIDEO_DIR, { recursive: true, force: true });
  fs.rmSync(SCREENSHOT_DIR, { recursive: true, force: true });
}

async function loadCypress() {
  const cypressModulePath = path.join(AUTOMATION_DIR, "node_modules", "cypress");
  try {
    return require(cypressModulePath);
  } catch (err) {
    throw new Error(
      `Cypress is not installed inside automation/. Run: cd automation && npm install. Details: ${err.message}`
    );
  }
}

function summarize(result) {
  if (!result || typeof result.totalTests !== "number") {
    return { summary: null, diagnostic: "Cypress returned an unexpected result shape.", artifacts: null };
  }

  const runs = Array.isArray(result.runs) ? result.runs : [];
  if (!runs.length) return { summary: null, diagnostic: "Cypress completed without run details.", artifacts: null };

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
        durationMs: attempt.wallClockDuration ?? null,
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
      durationMs: result.totalDuration || null,
      browser: runs[0]?.browser?.displayName || runs[0]?.browser?.name || null,
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
  const writtenSpecs = writeSpecs(generatedSpecs);

  try {
    const cypress = await loadCypress();
    const headed = boolEnv(process.env.CYPRESS_HEADED, true);
    const browser = process.env.CYPRESS_BROWSER || "chrome";
    const baseUrl = executionContext.baseUrl || process.env.TEST_BASE_URL || "http://localhost:4000";
    const demoStepDelayMs = Math.max(0, Math.min(numberEnv(process.env.CYPRESS_STEP_DELAY_MS, 0), 3000));
    const video = boolEnv(process.env.CYPRESS_VIDEO, true);
    const screenshotOnRunFailure = boolEnv(process.env.CYPRESS_SCREENSHOT_ON_FAILURE, true);

    removeOldArtifacts();

    console.log(
      `[test-runner] Running ${writtenSpecs.length} Cypress test-case spec(s) in ${browser} (${headed ? "headed" : "headless"})` +
      (demoStepDelayMs ? ` with ${demoStepDelayMs}ms demo step delay` : "")
    );

    const specPattern = path.join(SPEC_DIR, "*.cy.js").replace(/\\/g, "/");
    const result = await cypress.run({
      project: AUTOMATION_DIR,
      spec: specPattern,
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
      },
    });

    const { summary, diagnostic, artifacts } = summarize(result);
    return {
      specPaths: writtenSpecs.map((item) => item.specPath),
      ok: Boolean(summary),
      summary,
      artifacts,
      error: diagnostic,
    };
  } catch (err) {
    console.error("[test-runner] Cypress execution failed:", err);
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
const fs = require("fs");
const path = require("path");

const AUTOMATION_DIR = path.join(__dirname, "..", "..", "automation");
const SPEC_DIR = path.join(AUTOMATION_DIR, "cypress", "e2e", "generated");
const VIDEO_DIR = path.join(AUTOMATION_DIR, "cypress", "videos");
const SCREENSHOT_DIR = path.join(AUTOMATION_DIR, "cypress", "screenshots");
const TEST_ID_REGEX = /TC(?:\d{3}|-H\d{3})/i;

function writeSpec(fileName, script) {
  if (!fs.existsSync(SPEC_DIR)) fs.mkdirSync(SPEC_DIR, { recursive: true });
  const safeName = path.basename(fileName || "ai-generated.cy.js");
  const specPath = path.join(SPEC_DIR, safeName);
  fs.writeFileSync(specPath, script, "utf8");
  return { specPath, safeName };
}

function boolEnv(value, fallback) {
  if (value == null || value === "") return fallback;
  return !["false", "0", "no", "off"].includes(String(value).toLowerCase());
}

function numberEnv(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function removeOldArtifacts() {
  // The demo always generates one active spec, so clear stale run evidence before a new run.
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

function tcIdFromText(value) {
  return String(value || "").match(TEST_ID_REGEX)?.[0]?.toUpperCase() || null;
}

function summarize(result) {
  if (!result || typeof result.totalTests !== "number") {
    return { summary: null, diagnostic: "Cypress returned an unexpected result shape.", artifacts: null };
  }

  const run = result.runs?.[0];
  if (!run) return { summary: null, diagnostic: "Cypress completed without run details.", artifacts: null };

  const screenshotEntries = (run.screenshots || [])
    .filter((item) => item?.path && fs.existsSync(item.path))
    .map((item) => ({
      path: path.resolve(item.path),
      testCaseId: tcIdFromText(`${item.path} ${item.name || ""}`),
    }));

  const videoPath = run.video && fs.existsSync(run.video) ? path.resolve(run.video) : null;

  const tests = (run.tests || []).map((test) => {
    const attempt = test.attempts?.[test.attempts.length - 1] || {};
    const title = Array.isArray(test.title) ? test.title.join(" ") : test.title;
    const testCaseId = tcIdFromText(title);
    const screenshot = testCaseId
      ? screenshotEntries.find((item) => item.testCaseId === testCaseId)
      : null;

    return {
      title,
      testCaseId,
      pass: test.state === "passed",
      fail: test.state === "failed",
      state: test.state,
      durationMs: attempt.wallClockDuration ?? null,
      err: test.displayError ? { message: test.displayError } : null,
      evidence: {
        videoAvailable: Boolean(videoPath),
        screenshotAvailable: Boolean(screenshot?.path),
      },
    };
  });

  return {
    summary: {
      total: result.totalTests,
      passed: result.totalPassed,
      failed: result.totalFailed,
      pending: result.totalPending || 0,
      skipped: result.totalSkipped || 0,
      durationMs: result.totalDuration || null,
      browser: run.browser?.displayName || run.browser?.name || null,
      tests,
    },
    artifacts: {
      videoPath,
      screenshotsByTestCase: Object.fromEntries(
        screenshotEntries
          .filter((item) => item.testCaseId)
          .map((item) => [item.testCaseId, item.path])
      ),
    },
    diagnostic: null,
  };
}

async function executeGeneratedTest({ fileName, script }, executionContext = {}) {
  const { specPath, safeName } = writeSpec(fileName, script);

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
      `[test-runner] Running ${safeName} in ${browser} (${headed ? "headed" : "headless"})` +
      (demoStepDelayMs ? ` with ${demoStepDelayMs}ms demo step delay` : "")
    );

    const result = await cypress.run({
      project: AUTOMATION_DIR,
      spec: specPath,
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
    return { specPath, ok: Boolean(summary), summary, artifacts, error: diagnostic };
  } catch (err) {
    console.error("[test-runner] Cypress execution failed:", err);
    return { specPath, ok: false, summary: null, artifacts: null, error: err.message || String(err) };
  }
}

module.exports = { executeGeneratedTest, SPEC_DIR };

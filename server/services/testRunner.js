const fs = require("fs");
const path = require("path");

const AUTOMATION_DIR = path.join(__dirname, "..", "..", "automation");
const SPEC_DIR = path.join(AUTOMATION_DIR, "cypress", "e2e", "generated");

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
    return { summary: null, diagnostic: "Cypress returned an unexpected result shape." };
  }

  const run = result.runs?.[0];
  if (!run) return { summary: null, diagnostic: "Cypress completed without run details." };

  const tests = (run.tests || []).map((test) => {
    const attempt = test.attempts?.[test.attempts.length - 1] || {};
    return {
      title: Array.isArray(test.title) ? test.title.join(" ") : test.title,
      pass: test.state === "passed",
      fail: test.state === "failed",
      state: test.state,
      durationMs: attempt.wallClockDuration ?? null,
      err: test.displayError ? { message: test.displayError } : null,
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
        video: false,
        screenshotOnRunFailure: true,
      },
    });

    const { summary, diagnostic } = summarize(result);
    return { specPath, ok: Boolean(summary), summary, error: diagnostic };
  } catch (err) {
    console.error("[test-runner] Cypress execution failed:", err);
    return { specPath, ok: false, summary: null, error: err.message || String(err) };
  }
}

module.exports = { executeGeneratedTest, SPEC_DIR };

const { defineConfig } = require("cypress");
const fs = require("fs");
const path = require("path");

function boolEnv(value, fallback) {
  if (value == null || value === "") return fallback;
  return !["false", "0", "no", "off"].includes(String(value).toLowerCase());
}

function numberEnv(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const RESULT_FILE = process.env.AUTOMATION_RESULT_FILE || path.join(__dirname, "artifacts", "latest-run-result.json");
const LIVE_INFO_FILE = process.env.AUTOMATION_CDP_INFO_FILE || path.join(__dirname, "artifacts", "live-browser-cdp.json");
const LIVE_STATE_FILE = process.env.AUTOMATION_LIVE_STATE_FILE || path.join(__dirname, "artifacts", "live-browser-state.json");
const AUTOMATION_RUN_ID = String(process.env.AUTOMATION_RUN_ID || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);

function writeJsonAtomic(filePath, payload) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempFile = `${filePath}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(payload, null, 2), "utf8");
    fs.renameSync(tempFile, filePath);
    return true;
  } catch (err) {
    console.warn(`[automation-engine] Could not write ${path.basename(filePath)}: ${err.message}`);
    return false;
  }
}

function publishLiveState(status, details = {}) {
  if (!boolEnv(process.env.AUTOMATION_LIVE_STREAM, false)) return;
  writeJsonAtomic(LIVE_STATE_FILE, {
    status,
    at: new Date().toISOString(),
    ...details,
  });
}

function errorFromAttempt(test, attempt) {
  const error = attempt?.error || null;
  const message = error?.message || test?.displayError || null;
  if (!message && !error?.stack) return null;
  return {
    message: String(message || error?.stack || "Test failed."),
    stack: error?.stack ? String(error.stack) : null,
  };
}

function normalizeCypressTest(test) {
  const attempts = Array.isArray(test?.attempts) ? test.attempts : [];
  const attempt = attempts.length ? attempts[attempts.length - 1] : {};
  const rawState = String(test?.state || attempt?.state || "").toLowerCase();
  const state = ["passed", "failed", "pending", "skipped"].includes(rawState) ? rawState : "pending";
  const title = Array.isArray(test?.title)
    ? test.title.filter(Boolean).join(" ")
    : String(test?.title || "");
  const duration = Number(attempt?.duration ?? test?.duration);
  return {
    title,
    state,
    durationMs: Number.isFinite(duration) ? Math.round(duration) : null,
    err: state === "failed" ? errorFromAttempt(test, attempt) : null,
  };
}

function finalSpecPayload(results) {
  const tests = (Array.isArray(results?.tests) ? results.tests : []).map(normalizeCypressTest);
  const stats = results?.stats || {};
  const passed = Number.isFinite(Number(stats.passes)) ? Number(stats.passes) : tests.filter((test) => test.state === "passed").length;
  const failed = Number.isFinite(Number(stats.failures)) ? Number(stats.failures) : tests.filter((test) => test.state === "failed").length;
  const pending = Number.isFinite(Number(stats.pending)) ? Number(stats.pending) : tests.filter((test) => test.state === "pending").length;
  const skipped = Number.isFinite(Number(stats.skipped)) ? Number(stats.skipped) : tests.filter((test) => test.state === "skipped").length;
  return {
    source: "cypress-after-spec-final",
    total: Number.isFinite(Number(stats.tests)) ? Number(stats.tests) : tests.length,
    passed,
    failed,
    pending,
    skipped,
    durationMs: Number.isFinite(Number(stats.duration)) ? Math.round(Number(stats.duration)) : null,
    tests,
  };
}

module.exports = defineConfig({
  allowCypressEnv: true,
  experimentalMemoryManagement: true,
  numTestsKeptInMemory: 0,
  e2e: {
    baseUrl: process.env.AUTOMATION_BASE_URL || process.env.TEST_BASE_URL || "http://localhost:4000",
    specPattern: "tests/e2e/**/*.cy.js",
    supportFile: "tests/support/e2e.js",
    videosFolder: "artifacts/videos",
    screenshotsFolder: "artifacts/screenshots",
    downloadsFolder: "artifacts/downloads",
    video: boolEnv(process.env.AUTOMATION_VIDEO, false),
    screenshotOnRunFailure: boolEnv(process.env.AUTOMATION_SCREENSHOT_ON_FAILURE, true),
    env: {
      TEST_USERNAME: process.env.TEST_USERNAME || "",
      TEST_PASSWORD: process.env.TEST_PASSWORD || "",
      LOGIN_PATH: process.env.LOGIN_PATH || "/",
      LOGIN_USERNAME_SELECTOR: process.env.LOGIN_USERNAME_SELECTOR || "",
      LOGIN_PASSWORD_SELECTOR: process.env.LOGIN_PASSWORD_SELECTOR || "",
      LOGIN_SUBMIT_SELECTOR: process.env.LOGIN_SUBMIT_SELECTOR || "",
      REST_AUTH_TYPE: process.env.REST_AUTH_TYPE || "NONE",
      REST_AUTH_USERNAME: process.env.REST_AUTH_USERNAME || "",
      REST_AUTH_SECRET: process.env.REST_AUTH_SECRET || "",
      REST_AUTH_HEADER: process.env.REST_AUTH_HEADER || "",
      DEMO_STEP_DELAY_MS: Math.max(0, Math.min(numberEnv(process.env.DEMO_STEP_DELAY_MS, 0), 3000)),
      SCREENSHOT_EACH_TEST: boolEnv(process.env.AUTOMATION_SCREENSHOT_EACH_TEST, true),
      TEST_COMPLETION_PAUSE_MS: Math.max(0, Math.min(numberEnv(process.env.AUTOMATION_TEST_COMPLETION_PAUSE_MS, 5000), 30000)),
    },
    setupNodeEvents(on, config) {
      on("before:browser:launch", (browser, launchOptions) => {
        if (browser.family === "chromium" && AUTOMATION_RUN_ID) {
          const marker = `--ai-testpilot-run-id=${AUTOMATION_RUN_ID}`;
          if (!launchOptions.args.includes(marker)) launchOptions.args.push(marker);
        }

        const streamingEnabled = boolEnv(process.env.AUTOMATION_LIVE_STREAM, false);
        if (!streamingEnabled || browser.family !== "chromium") return launchOptions;

        const fallbackPort = Math.max(1024, Math.min(numberEnv(process.env.AUTOMATION_LIVE_STREAM_PORT, 9223), 65535));
        const existingIndex = launchOptions.args.findIndex((arg) => String(arg).startsWith("--remote-debugging-port="));
        let debugPort = null;

        if (existingIndex >= 0) {
          const existingArg = String(launchOptions.args[existingIndex]);
          const parsed = Number(existingArg.split("=")[1]);
          if (Number.isFinite(parsed) && parsed > 0) debugPort = parsed;
        }

        if (!debugPort) {
          debugPort = fallbackPort;
          launchOptions.args.push(`--remote-debugging-port=${debugPort}`);
        }

        if (!launchOptions.args.some((arg) => String(arg).startsWith("--remote-debugging-address="))) {
          launchOptions.args.push("--remote-debugging-address=127.0.0.1");
        }

        writeJsonAtomic(LIVE_INFO_FILE, { port: debugPort, browser: browser.name, runId: AUTOMATION_RUN_ID || null, at: new Date().toISOString() });
        publishLiveState("running", { browser: browser.name, port: debugPort, passed: 0, failed: 0, total: 0 });

        console.log(`[automation-engine] Live browser stream attached to Cypress Chrome DevTools port ${debugPort}.`);
        return launchOptions;
      });

      on("after:spec", (_spec, results) => {
        if (!results) return;
        const payload = finalSpecPayload(results);
        if (writeJsonAtomic(RESULT_FILE, payload)) {
          console.log(`[automation-result] Final spec results captured: ${payload.passed} passed, ${payload.failed} failed.`);
        }
        publishLiveState("finalizing", {
          passed: payload.passed,
          failed: payload.failed,
          total: payload.total,
        });
        console.log(`[automation-engine] Spec teardown finished: ${payload.passed} passed, ${payload.failed} failed`);
      });

      on("after:run", (results) => {
        const passed = Number(results?.totalPassed || 0);
        const failed = Number(results?.totalFailed || 0);
        const total = Number(results?.totalTests || (passed + failed + Number(results?.totalPending || 0)));
        publishLiveState("finished", { passed, failed, total });
        try { fs.rmSync(LIVE_INFO_FILE, { force: true }); } catch {}
        console.log(`[automation-engine] Run teardown finished: ${passed} passed, ${failed} failed`);
      });
      return config;
    },
  },
});

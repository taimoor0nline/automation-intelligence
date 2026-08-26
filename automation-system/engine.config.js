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
      DEMO_STEP_DELAY_MS: Math.max(0, Math.min(numberEnv(process.env.DEMO_STEP_DELAY_MS, 0), 3000)),
    },
    setupNodeEvents(on, config) {
      on("before:browser:launch", (browser, launchOptions) => {
        const streamingEnabled = boolEnv(process.env.AUTOMATION_LIVE_STREAM, false);
        if (!streamingEnabled || browser.family !== "chromium") return launchOptions;

        const preferredPort = Math.max(1024, Math.min(numberEnv(process.env.AUTOMATION_LIVE_STREAM_PORT, 9223), 65535));
        const existingIndex = launchOptions.args.findIndex((arg) => String(arg).startsWith("--remote-debugging-port="));
        const debugArg = `--remote-debugging-port=${preferredPort}`;
        if (existingIndex >= 0) launchOptions.args[existingIndex] = debugArg;
        else launchOptions.args.push(debugArg);
        launchOptions.args.push("--remote-debugging-address=127.0.0.1");

        const infoFile = process.env.AUTOMATION_CDP_INFO_FILE || path.join(__dirname, "artifacts", "live-browser-cdp.json");
        try {
          fs.mkdirSync(path.dirname(infoFile), { recursive: true });
          fs.writeFileSync(infoFile, JSON.stringify({ port: preferredPort, browser: browser.name, at: new Date().toISOString() }), "utf8");
        } catch (err) {
          console.warn(`[automation-engine] Could not publish live-stream debugger info: ${err.message}`);
        }

        console.log(`[automation-engine] Live browser stream enabled on Chrome DevTools port ${preferredPort}.`);
        return launchOptions;
      });

      on("after:spec", (_spec, results) => {
        if (results) console.log(`[automation-engine] Spec teardown finished: ${results.stats?.passes || 0} passed, ${results.stats?.failures || 0} failed`);
      });
      on("after:run", (results) => {
        console.log(`[automation-engine] Run teardown finished: ${results?.totalPassed || 0} passed, ${results?.totalFailed || 0} failed`);
      });
      return config;
    },
  },
});

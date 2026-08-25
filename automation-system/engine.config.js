const { defineConfig } = require("cypress");

function boolEnv(value, fallback) {
  if (value == null || value === "") return fallback;
  return !["false", "0", "no", "off"].includes(String(value).toLowerCase());
}

function numberEnv(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

module.exports = defineConfig({
  allowCypressEnv: false,
  experimentalMemoryManagement: true,
  numTestsKeptInMemory: 0,
  e2e: {
    baseUrl: process.env.AUTOMATION_BASE_URL || process.env.TEST_BASE_URL || "http://localhost:4000",
    specPattern: "tests/e2e/**/*.cy.js",
    supportFile: "tests/support/e2e.js",
    videosFolder: "artifacts/videos",
    screenshotsFolder: "artifacts/screenshots",
    video: boolEnv(process.env.AUTOMATION_VIDEO, false),
    screenshotOnRunFailure: boolEnv(process.env.AUTOMATION_SCREENSHOT_ON_FAILURE, true),
    env: {
      TEST_USERNAME: process.env.TEST_USERNAME || "",
      TEST_PASSWORD: process.env.TEST_PASSWORD || "",
      LOGIN_USERNAME_SELECTOR: process.env.LOGIN_USERNAME_SELECTOR || "",
      LOGIN_PASSWORD_SELECTOR: process.env.LOGIN_PASSWORD_SELECTOR || "",
      LOGIN_SUBMIT_SELECTOR: process.env.LOGIN_SUBMIT_SELECTOR || "",
      DEMO_STEP_DELAY_MS: Math.max(0, Math.min(numberEnv(process.env.DEMO_STEP_DELAY_MS, 0), 3000)),
    },
    setupNodeEvents(on, config) {
      on("after:spec", (_spec, results) => {
        if (results) {
          console.log(`[automation-engine] Spec teardown finished: ${results.stats?.passes || 0} passed, ${results.stats?.failures || 0} failed`);
        }
      });

      on("after:run", (results) => {
        console.log(`[automation-engine] Run teardown finished: ${results?.totalPassed || 0} passed, ${results?.totalFailed || 0} failed`);
      });

      return config;
    },
  },
});

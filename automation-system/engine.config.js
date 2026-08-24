const { defineConfig } = require("cypress");

module.exports = defineConfig({
  allowCypressEnv: false,
  e2e: {
    baseUrl: process.env.TEST_BASE_URL || "http://localhost:4000",
    specPattern: "tests/e2e/**/*.cy.js",
    supportFile: "tests/support/e2e.js",
    videosFolder: "artifacts/videos",
    screenshotsFolder: "artifacts/screenshots",
    screenshotOnRunFailure: true,
    setupNodeEvents(on, config) {
      on("after:spec", (_spec, results) => {
        if (results) {
          console.log(`[automation-engine] Spec execution finished: ${results.stats?.passes || 0} passed, ${results.stats?.failures || 0} failed`);
        }
      });

      on("after:run", (results) => {
        console.log(`[automation-engine] Run teardown finished: ${results?.totalPassed || 0} passed, ${results?.totalFailed || 0} failed`);
      });

      return config;
    },
  },
});

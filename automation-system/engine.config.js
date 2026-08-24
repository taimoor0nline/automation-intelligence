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
      return config;
    },
  },
});

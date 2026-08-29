// AI TestPilot — automation support file
// Global behaviour for deterministic browser automation specs.

require("cypress-axe");

function boolEnv(name, fallback = false) {
  const raw = Cypress.env(name);
  if (raw == null || raw === "") return fallback;
  return !["false", "0", "no", "off"].includes(String(raw).toLowerCase());
}

function boundedNumberEnv(name, fallback, min, max) {
  const value = Number(Cypress.env(name));
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(value, max));
}

function getDemoStepDelayMs() {
  return boundedNumberEnv("DEMO_STEP_DELAY_MS", 0, 0, 3000);
}

function getCompletionPauseMs() {
  return boundedNumberEnv("TEST_COMPLETION_PAUSE_MS", 5000, 0, 30000);
}

function withDemoDelay(chain) {
  const delayMs = getDemoStepDelayMs();
  if (!delayMs) return chain;
  return chain.then((subject) => Cypress.Promise.delay(delayMs).then(() => subject));
}

function safeEvidenceName(title) {
  const raw = String(title || "test");
  const id = raw.match(/TC(?:\d{3}|-H\d{3})/i)?.[0]?.toUpperCase() || "TEST";
  const suffix = raw
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
  return `${id}-${suffix || "completion"}`;
}

Cypress.Commands.add("loginWithRuntimeCredentials", () => {
  const username = Cypress.env("TEST_USERNAME");
  const password = Cypress.env("TEST_PASSWORD");
  const loginPath = Cypress.env("LOGIN_PATH") || "/";
  const usernameSelector = Cypress.env("LOGIN_USERNAME_SELECTOR");
  const passwordSelector = Cypress.env("LOGIN_PASSWORD_SELECTOR");
  const submitSelector = Cypress.env("LOGIN_SUBMIT_SELECTOR");

  if (!username || !password) throw new Error("Runtime login credentials are not configured for this test run.");
  if (!usernameSelector || !passwordSelector || !submitSelector) throw new Error("Runtime login controls were not grounded from page discovery.");

  cy.visit(loginPath);
  cy.get(usernameSelector).clear({ log: false }).type(String(username), { log: false });
  cy.get(passwordSelector).clear({ log: false }).type(String(password), { log: false });
  cy.get(submitSelector).click();
});

["click", "type", "select", "check", "uncheck", "clear"].forEach((commandName) => {
  Cypress.Commands.overwrite(commandName, (originalFn, subject, ...args) => withDemoDelay(originalFn(subject, ...args)));
});

Cypress.Commands.overwrite("visit", (originalFn, url, options) => withDemoDelay(originalFn(url, options)));

beforeEach(function () {
  const title = this.currentTest?.fullTitle?.() || this.currentTest?.title || "test";
  const testCaseId = String(title).match(/TC(?:\d{3}|-H\d{3})/i)?.[0]?.toUpperCase() || "";
  cy.task("markTestStarted", { testTitle: String(title), testCaseId }, { log: false });
});

afterEach(function () {
  const screenshotEachTest = boolEnv("SCREENSHOT_EACH_TEST", true);
  const completionPauseMs = getCompletionPauseMs();

  if (screenshotEachTest) {
    const title = this.currentTest?.fullTitle?.() || this.currentTest?.title || "test";
    cy.screenshot(safeEvidenceName(title), {
      capture: "viewport",
      overwrite: true,
      log: false,
    });
  }

  if (completionPauseMs > 0) {
    cy.wait(completionPauseMs, { log: false });
  } else {
    const demoDelayMs = getDemoStepDelayMs();
    if (demoDelayMs > 0) cy.wait(Math.max(300, Math.min(demoDelayMs, 1200)), { log: false });
  }
});

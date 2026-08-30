// TestNexus AI — automation support file
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

function loginRuntime() {
  return {
    loginPath: Cypress.env("LOGIN_PATH") || "/",
    successPath: Cypress.env("LOGIN_SUCCESS_PATH") || "",
    usernameSelector: Cypress.env("LOGIN_USERNAME_SELECTOR"),
    passwordSelector: Cypress.env("LOGIN_PASSWORD_SELECTOR"),
    submitSelector: Cypress.env("LOGIN_SUBMIT_SELECTOR"),
  };
}

function performGroundedLogin(username, password) {
  const runtime = loginRuntime();
  if (!username || !password) throw new Error("Runtime login credentials are not configured for this test run.");
  if (!runtime.usernameSelector || !runtime.passwordSelector || !runtime.submitSelector) throw new Error("Runtime login controls were not grounded from page discovery.");

  cy.visit(runtime.loginPath);
  cy.get(runtime.usernameSelector).clear({ log: false }).type(String(username), { log: false });
  cy.get(runtime.passwordSelector).clear({ log: false }).type(String(password), { log: false });
  cy.get(runtime.submitSelector).click();
  if (runtime.successPath && runtime.successPath !== runtime.loginPath) {
    cy.location("pathname", { timeout: 15000 }).should("eq", runtime.successPath);
  }
}

function configuredActors() {
  const raw = Cypress.env("TEST_ACTORS_JSON");
  if (!raw) return {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    throw new Error("Runtime test actor configuration is malformed.");
  }
}

Cypress.Commands.add("loginWithRuntimeCredentials", () => {
  performGroundedLogin(Cypress.env("TEST_USERNAME"), Cypress.env("TEST_PASSWORD"));
});

Cypress.Commands.add("typeRuntimeCredential", (selector, credential) => {
  const kind = String(credential || "").trim().toLowerCase();
  const value = kind === "username" ? Cypress.env("TEST_USERNAME") : kind === "password" ? Cypress.env("TEST_PASSWORD") : null;
  if (!selector || !value) throw new Error(`Runtime ${kind || "credential"} is not configured for this test run.`);
  cy.get(String(selector)).clear({ log: false }).type(String(value), { log: false });
});

Cypress.Commands.add("loginAsTestActor", (actorRef) => {
  const ref = String(actorRef || "").trim();
  const actor = configuredActors()[ref] || null;
  if (!ref || !actor?.username || !actor?.password) throw new Error(`Runtime credentials are not configured for test actor ${ref || "(missing)"}.`);

  // A role handoff must not inherit another user's authenticated browser state.
  // Clear cookies/local/session storage before entering the common grounded login flow.
  cy.clearCookies({ log: false });
  cy.clearLocalStorage({ log: false });
  cy.window({ log: false }).then((win) => {
    try { win.sessionStorage.clear(); } catch {}
  });
  performGroundedLogin(actor.username, actor.password);
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

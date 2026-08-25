// AI TestPilot — automation support file
// Global behaviour for AI-generated browser automation specs.

function getDemoStepDelayMs() {
  const value = Number(Cypress.env("DEMO_STEP_DELAY_MS") || 0);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(value, 3000));
}

function withDemoDelay(chain) {
  const delayMs = getDemoStepDelayMs();
  if (!delayMs) return chain;

  return chain.then((subject) =>
    cy.wait(delayMs, { log: false }).then(() => subject)
  );
}

// Credentials, login path and login selectors are injected by the deterministic
// automation runtime. AI-generated specs never read credentials or choose the
// login page/controls. Calling this command is enough to establish a valid login.
Cypress.Commands.add("loginWithRuntimeCredentials", () => {
  // Runtime values configured under e2e.env must be read with Cypress.env().
  // Cypress.config("env") is not the runtime environment API and caused the
  // framework helper to see empty credentials even though the server injected them.
  const username = Cypress.env("TEST_USERNAME");
  const password = Cypress.env("TEST_PASSWORD");
  const loginPath = Cypress.env("LOGIN_PATH") || "/";
  const usernameSelector = Cypress.env("LOGIN_USERNAME_SELECTOR");
  const passwordSelector = Cypress.env("LOGIN_PASSWORD_SELECTOR");
  const submitSelector = Cypress.env("LOGIN_SUBMIT_SELECTOR");

  if (!username || !password) {
    throw new Error("Runtime login credentials are not configured for this test run.");
  }
  if (!usernameSelector || !passwordSelector || !submitSelector) {
    throw new Error("Runtime login controls were not grounded from page discovery.");
  }

  // Navigation is automation-system-owned too. This prevents generated tests from
  // attempting login while the browser is still on about:blank or another page.
  cy.visit(loginPath);
  cy.get(usernameSelector).clear({ log: false }).type(String(username), { log: false });
  cy.get(passwordSelector).clear({ log: false }).type(String(password), { log: false });
  cy.get(submitSelector).click();
});

// Slow only visible user interactions for presentation/demo purposes.
// Assertions and retry behaviour stay at normal speed.
["click", "type", "select", "check", "uncheck", "clear"].forEach((commandName) => {
  Cypress.Commands.overwrite(commandName, (originalFn, subject, ...args) =>
    withDemoDelay(originalFn(subject, ...args))
  );
});

Cypress.Commands.overwrite("visit", (originalFn, url, options) =>
  withDemoDelay(originalFn(url, options))
);

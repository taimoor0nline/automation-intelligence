// AI TestPilot — automation support file
// Global behaviour for deterministic browser automation specs.

function getDemoStepDelayMs() {
  const value = Number(Cypress.env("DEMO_STEP_DELAY_MS") || 0);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(value, 3000));
}

/**
 * Delay presentation without enqueueing another cy command from inside an
 * overwritten command. Cypress rejects patterns such as command.then(() =>
 * cy.wait(...)) because they mix the command queue with a returned promise.
 * Cypress.Promise.delay() pauses the yielded chain without creating a nested
 * browser command, so the original command lifecycle remains valid.
 */
function withDemoDelay(chain) {
  const delayMs = getDemoStepDelayMs();
  if (!delayMs) return chain;

  return chain.then((subject) =>
    Cypress.Promise.delay(delayMs).then(() => subject)
  );
}

// Credentials, login path and login selectors are injected by the deterministic
// automation runtime. Generated specs never read credentials or choose the
// login page/controls. Calling this command is enough to establish a valid login.
Cypress.Commands.add("loginWithRuntimeCredentials", () => {
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

  // Navigation is automation-system-owned too. This prevents tests from
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

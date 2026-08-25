// AI TestPilot — automation support file
// Global behaviour for AI-generated browser automation specs.

function getDemoStepDelayMs() {
  const env = Cypress.config("env") || {};
  const value = Number(env.DEMO_STEP_DELAY_MS || 0);
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

// Credentials are owned by the deterministic automation framework, not by the
// generated test code. AI-generated specs call this helper with selectors that
// came from page discovery; they never read, copy, assign or log credentials.
Cypress.Commands.add("loginWithRuntimeCredentials", ({ usernameSelector, passwordSelector, submitSelector }) => {
  const username = Cypress.env("TEST_USERNAME");
  const password = Cypress.env("TEST_PASSWORD");

  if (!username || !password) {
    throw new Error("Valid runtime test credentials were not supplied to the automation engine.");
  }
  if (!usernameSelector || !passwordSelector || !submitSelector) {
    throw new Error("Login helper requires discovered username, password and submit selectors.");
  }

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

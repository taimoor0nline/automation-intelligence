// AI TestPilot — Cypress support file
// Global behaviour for AI-generated Cypress specs.

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

// Slow only visible user interactions for presentation/demo purposes.
// Assertions and Cypress retry behaviour stay at normal speed.
["click", "type", "select", "check", "uncheck", "clear"].forEach((commandName) => {
  Cypress.Commands.overwrite(commandName, (originalFn, subject, ...args) =>
    withDemoDelay(originalFn(subject, ...args))
  );
});

Cypress.Commands.overwrite("visit", (originalFn, url, options) =>
  withDemoDelay(originalFn(url, options))
);

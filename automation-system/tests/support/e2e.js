// TestNexus AI — automation support file
// Global behaviour for deterministic browser automation specs.

require("cypress-axe");

let currentRuntimeItem = null;

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

function parseJsonEnv(name, fallback = {}) {
  const raw = Cypress.env(name);
  if (!raw) return fallback;
  if (typeof raw === "object") return raw;
  try { return JSON.parse(String(raw)); }
  catch { throw new Error(`${name} is malformed JSON.`); }
}

function enterpriseSsoConfig(provider) {
  const all = parseJsonEnv("ENTERPRISE_SSO_CONFIG_JSON", {});
  const key = String(provider || "ENTERPRISE").trim().toUpperCase();
  const cfg = all[key] || all.default || all;
  if (!cfg || typeof cfg !== "object") throw new Error(`Enterprise SSO configuration is missing for ${key}.`);
  const origin = String(cfg.origin || "").trim();
  if (!/^https?:\/\/[^/]+$/i.test(origin)) throw new Error(`Enterprise SSO origin must be an exact origin for ${key}.`);
  return { key, ...cfg, origin };
}

function installBrowserEvidence(win) {
  if (!win || win.__testNexusEvidenceInstalled) return;
  win.__testNexusEvidenceInstalled = true;
  win.__testNexusConsoleErrors = [];
  win.__testNexusConsoleWarnings = [];
  win.__testNexusRuntimeErrors = [];
  const originalError = win.console?.error?.bind(win.console);
  const originalWarn = win.console?.warn?.bind(win.console);
  if (win.console) {
    win.console.error = (...args) => {
      try { win.__testNexusConsoleErrors.push(args.map((item) => String(item)).join(" ").slice(0, 2000)); } catch {}
      return originalError?.(...args);
    };
    win.console.warn = (...args) => {
      try { win.__testNexusConsoleWarnings.push(args.map((item) => String(item)).join(" ").slice(0, 2000)); } catch {}
      return originalWarn?.(...args);
    };
  }
  win.addEventListener?.("error", (event) => {
    try { win.__testNexusRuntimeErrors.push(String(event?.error?.message || event?.message || "window error").slice(0, 2000)); } catch {}
  });
  win.addEventListener?.("unhandledrejection", (event) => {
    try { win.__testNexusRuntimeErrors.push(String(event?.reason?.message || event?.reason || "unhandled rejection").slice(0, 2000)); } catch {}
  });
}

Cypress.on("window:before:load", (win) => {
  if (boolEnv("CAPTURE_BROWSER_EVIDENCE", true)) installBrowserEvidence(win);
});

Cypress.on("fail", (err) => {
  if (currentRuntimeItem?.itemId) {
    const marker = `[TN_ITEM=${currentRuntimeItem.itemId};KIND=${currentRuntimeItem.kind};OP=${currentRuntimeItem.operation}]`;
    if (!String(err.message || "").includes(marker)) err.message = `${marker} ${err.message || "Automation command failed."}`;
  }
  throw err;
});

Cypress.Commands.add("testNexusSetCurrentItem", (item) => {
  currentRuntimeItem = item && typeof item === "object" ? { ...item } : null;
  return cy.wrap(null, { log: false });
});

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

  cy.clearCookies({ log: false });
  cy.clearLocalStorage({ log: false });
  cy.window({ log: false }).then((win) => {
    try { win.sessionStorage.clear(); } catch {}
  });
  performGroundedLogin(actor.username, actor.password);
});

Cypress.Commands.add("loginEnterpriseSso", (provider = "ENTERPRISE") => {
  const cfg = enterpriseSsoConfig(provider);
  const username = Cypress.env("TEST_USERNAME");
  const password = Cypress.env("TEST_PASSWORD");
  if (!username || !password) throw new Error(`Enterprise SSO ${cfg.key} requires configured runtime username/password test credentials.`);

  const execute = () => {
    if (cfg.startPath) cy.visit(String(cfg.startPath));
    if (cfg.triggerSelector) cy.get(String(cfg.triggerSelector)).should("have.length", 1).click();

    const args = {
      username: String(username),
      password: String(password),
      usernameSelector: String(cfg.usernameSelector || ""),
      usernameSubmitSelector: String(cfg.usernameSubmitSelector || cfg.submitSelector || ""),
      passwordSelector: String(cfg.passwordSelector || ""),
      passwordSubmitSelector: String(cfg.passwordSubmitSelector || cfg.submitSelector || ""),
      continueSelector: String(cfg.continueSelector || ""),
      originPath: String(cfg.originPath || ""),
    };
    if (!args.usernameSelector || !args.passwordSelector || !args.passwordSubmitSelector) {
      throw new Error(`Enterprise SSO ${cfg.key} requires configured username/password/submit selectors; TestNexus will not invent identity-provider selectors.`);
    }

    cy.origin(cfg.origin, { args }, ({ username, password, usernameSelector, usernameSubmitSelector, passwordSelector, passwordSubmitSelector, continueSelector, originPath }) => {
      if (originPath) cy.visit(originPath);
      cy.get(usernameSelector).should("have.length", 1).clear({ log: false }).type(username, { log: false });
      if (usernameSubmitSelector) cy.get(usernameSubmitSelector).should("have.length", 1).click();
      cy.get(passwordSelector, { timeout: 20000 }).should("have.length", 1).clear({ log: false }).type(password, { log: false });
      cy.get(passwordSubmitSelector).should("have.length", 1).click();
      if (continueSelector) {
        cy.get("body").then(($body) => {
          const $continue = $body.find(continueSelector);
          if ($continue.length === 1 && $continue.is(":visible")) cy.wrap($continue).click();
        });
      }
    });

    if (cfg.returnPath) cy.location("pathname", { timeout: Number(cfg.returnTimeoutMs || 30000) }).should("eq", String(cfg.returnPath));
  };

  if (cfg.cacheSession === true) {
    cy.session([cfg.key, String(username)], execute, {
      cacheAcrossSpecs: false,
      validate: () => {
        if (cfg.sessionCookie) cy.getCookie(String(cfg.sessionCookie)).should("exist");
        else if (cfg.returnPath) cy.location("pathname").should("eq", String(cfg.returnPath));
      },
    });
  } else execute();
});

Cypress.Commands.add("pressNativeKey", (key) => {
  const name = String(key || "").trim().toUpperCase();
  const keys = Cypress.Keyboard?.Keys || {};
  const aliases = {
    TAB: keys.TAB,
    ENTER: keys.ENTER,
    ESC: keys.ESC,
    ESCAPE: keys.ESC,
    UP: keys.UP,
    DOWN: keys.DOWN,
    LEFT: keys.LEFT,
    RIGHT: keys.RIGHT,
    HOME: keys.HOME,
    END: keys.END,
    PAGEUP: keys.PAGE_UP,
    PAGEDOWN: keys.PAGE_DOWN,
  };
  const resolved = aliases[name];
  if (!resolved || typeof cy.press !== "function") throw new Error(`Native key ${name || "(missing)"} is not supported by the installed automation runtime.`);
  cy.press(resolved, { log: false });
});

["click", "type", "select", "check", "uncheck", "clear"].forEach((commandName) => {
  Cypress.Commands.overwrite(commandName, (originalFn, subject, ...args) => withDemoDelay(originalFn(subject, ...args)));
});

Cypress.Commands.overwrite("visit", (originalFn, url, options) => withDemoDelay(originalFn(url, options)));

beforeEach(function () {
  currentRuntimeItem = null;
  const title = this.currentTest?.fullTitle?.() || this.currentTest?.title || "test";
  const testCaseId = String(title).match(/TC(?:\d{3}|-H\d{3})/i)?.[0]?.toUpperCase() || "";
  cy.task("markTestStarted", { testTitle: String(title), testCaseId }, { log: false });
  cy.task("testNexusRuntimeEvent", {
    kind: "TEST",
    phase: "STARTED",
    testCaseId,
    testTitle: String(title),
    browser: Cypress.browser?.name || null,
    browserVersion: Cypress.browser?.version || null,
  }, { log: false });
});

afterEach(function () {
  const screenshotEachTest = boolEnv("SCREENSHOT_EACH_TEST", true);
  const completionPauseMs = getCompletionPauseMs();
  const title = this.currentTest?.fullTitle?.() || this.currentTest?.title || "test";
  const testCaseId = String(title).match(/TC(?:\d{3}|-H\d{3})/i)?.[0]?.toUpperCase() || "";
  const state = String(this.currentTest?.state || "unknown");

  if (boolEnv("CAPTURE_BROWSER_EVIDENCE", true)) {
    cy.window({ log: false }).then((win) => {
      const resources = Array.from(win.performance?.getEntriesByType?.("resource") || []).slice(-200).map((entry) => ({
        name: String(entry.name || "").slice(0, 1500),
        initiatorType: String(entry.initiatorType || ""),
        durationMs: Number.isFinite(Number(entry.duration)) ? Math.round(Number(entry.duration)) : null,
      }));
      cy.task("testNexusRuntimeEvent", {
        kind: "BROWSER_EVIDENCE",
        phase: "CAPTURED",
        testCaseId,
        url: String(win.location?.href || ""),
        consoleErrors: Array.isArray(win.__testNexusConsoleErrors) ? win.__testNexusConsoleErrors.slice(-50) : [],
        consoleWarnings: Array.isArray(win.__testNexusConsoleWarnings) ? win.__testNexusConsoleWarnings.slice(-50) : [],
        runtimeErrors: Array.isArray(win.__testNexusRuntimeErrors) ? win.__testNexusRuntimeErrors.slice(-50) : [],
        resources,
      }, { log: false });
    });
  }

  cy.task("testNexusRuntimeEvent", { kind: "TEST", phase: "FINISHED", testCaseId, testTitle: String(title), state }, { log: false });

  if (screenshotEachTest) {
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
  currentRuntimeItem = null;
});

const SUPPORTED_OPERATIONS = new Set([
  "LOGIN_VALID",
  "NAVIGATE",
  "TYPE",
  "CLEAR",
  "CLICK",
  "SELECT",
  "CHECK",
  "UNCHECK",
  "ASSERT_VISIBLE",
  "ASSERT_HIDDEN_OR_ABSENT",
  "ASSERT_TEXT_NOT_EMPTY",
  "ASSERT_URL_INCLUDES",
  "ASSERT_URL_NOT_INCLUDES",
]);

function selectorFor(item) {
  if (!item) return "";
  if (item.selector) return String(item.selector);
  if (item.testId) return `[data-testid="${item.testId}"]`;
  if (item.id) return `#${item.id}`;
  if (item.name) return `[name="${item.name}"]`;
  return "";
}

function buildDiscoveryIndex(pageDiscoveries = []) {
  const selectors = new Map();
  const paths = new Set();
  for (const page of pageDiscoveries || []) {
    try {
      const url = new URL(page?.finalUrl || page?.url || "http://local/");
      paths.add(`${url.pathname}${url.search}` || "/");
    } catch {}
    for (const item of page?.elements || []) {
      const selector = selectorFor(item);
      if (selector) selectors.set(selector, item);
      if (item?.errorElement) {
        const errSelector = selectorFor(item.errorElement);
        if (errSelector) selectors.set(errSelector, item.errorElement);
      }
    }
    for (const message of page?.messages || []) {
      const selector = selectorFor(message);
      if (selector) selectors.set(selector, message);
    }
  }
  return { selectors, paths };
}

function findSelector(text) {
  const source = String(text || "");
  const literal = source.match(/\[data-testid=(?:"[^"]+"|'[^']+')\]|#[A-Za-z0-9_-]+|\[name=(?:"[^"]+"|'[^']+')\]/)?.[0];
  if (literal) return literal.replace(/\[data-testid='([^']+)'\]/, '[data-testid="$1"]').replace(/\[name='([^']+)'\]/, '[name="$1"]');

  const testId = source.match(/(?:data-testid|data testid|test id)\s*(?:=|is|of|named|called|:)?\s*["']([^"']+)["']/i)?.[1];
  if (testId) return `[data-testid="${testId}"]`;

  const name = source.match(/(?:name attribute|name)\s*(?:=|is|of|named|called|:)?\s*["']([^"']+)["']/i)?.[1];
  if (name) return `[name="${name}"]`;

  const id = source.match(/(?:element\s+)?id\s*(?:=|is|of|named|called|:)?\s*["']([A-Za-z0-9_-]+)["']/i)?.[1];
  if (id) return `#${id}`;
  return "";
}

function looksLikeSelector(value) {
  const text = String(value || "").trim();
  return text.startsWith("[") || text.startsWith("#") || text.startsWith(".");
}

function normalizePath(value) {
  const text = String(value || "").trim();
  if (text.startsWith("/")) return text;
  try {
    const url = new URL(text);
    return `${url.pathname}${url.search}` || "/";
  } catch {
    return "";
  }
}

function isConfiguredCredentialStep(action) {
  return /configured test (?:username|password)|runtime credentials|valid credentials/i.test(action);
}

function requiresValidLogin(testCase) {
  return (testCase?.preconditions || []).some((x) => /valid test credentials|configured test credentials|runtime credentials/i.test(String(x))) ||
    (testCase?.steps || []).some((s) => isConfiguredCredentialStep(String(s?.action || "")));
}

function compileStep(step, discovery, state) {
  const actionRaw = String(step?.action || "").trim();
  const action = actionRaw.toLowerCase();
  const target = String(step?.target || "").trim();
  const value = step?.value === null || step?.value === undefined ? null : String(step.value);

  if (isConfiguredCredentialStep(action) || (/click|submit/.test(action) && /sign\s*in|log\s*in|login/i.test(actionRaw) && state.validLoginRequired)) {
    if (!state.loginInserted) {
      state.loginInserted = true;
      return { operation: "LOGIN_VALID" };
    }
    return null;
  }

  if (/navigate|open|visit|continue to/.test(action)) {
    const path = normalizePath(value || target);
    if (!path) return { error: `Navigation step does not contain a usable path: ${actionRaw}` };
    if (!discovery.paths.has(path)) return { error: `Navigation path is not grounded by discovery: ${path}` };
    return { operation: "NAVIGATE", path };
  }

  if (!target || !looksLikeSelector(target)) return { error: `Step is not expressed with a grounded executable target: ${actionRaw}` };
  const element = discovery.selectors.get(target);
  if (!element) return { error: `Selector is not grounded by discovery: ${target}` };
  const type = String(element?.type || "").toLowerCase();
  const tag = String(element?.tag || "").toLowerCase();

  if (/leave .*blank|clear|empty/.test(action)) return { operation: "CLEAR", selector: target };
  if (/enter|type|fill|input/.test(action)) {
    if (value === null || value === "") return { error: `Typing step is missing a value for ${target}` };
    return { operation: "TYPE", selector: target, value };
  }
  if (/uncheck|deselect/.test(action) && (type === "checkbox" || type === "radio")) return { operation: "UNCHECK", selector: target };
  if (/check|consent|select at least one|choose/.test(action) && type === "checkbox") return { operation: "CHECK", selector: target };
  if (/select/.test(action) && tag === "select") {
    if (value === null || value === "") return { error: `Select step is missing an option value for ${target}` };
    return { operation: "SELECT", selector: target, value };
  }
  if (/select|click|choose|submit|press|sign\s*in|log\s*in|login/.test(action)) return { operation: "CLICK", selector: target };
  return { error: `Unsupported or ambiguous automation action: ${actionRaw}` };
}

function compileExpected(expected, discovery) {
  const text = String(expected || "").trim();
  const lower = text.toLowerCase();
  const selector = findSelector(text);

  if (selector) {
    if (!discovery.selectors.has(selector)) return { error: `Expected-result selector is not grounded by discovery: ${selector}` };
    if (/non-empty|not empty|contains?\s+(?:non-empty|text|message)|message\s+['"].+['"]\s+is\s+(?:displayed|shown|visible)/i.test(text)) {
      return { operation: "ASSERT_TEXT_NOT_EMPTY", selector };
    }
    if (/absent|hidden|not visible|remains absent/.test(lower)) return { operation: "ASSERT_HIDDEN_OR_ABSENT", selector };
    if (/visible|shown|displayed|appears/.test(lower)) return { operation: "ASSERT_VISIBLE", selector };
  }

  const pathMatch = text.match(/\/(?:[A-Za-z0-9._~!$&'()*+,;=:@%-]+\/?)+/);
  const path = pathMatch?.[0] || "";
  if (path && discovery.paths.has(path)) {
    if (/not taken|not navigate|does not navigate|remain.*(?:login|page)/.test(lower)) return { operation: "ASSERT_URL_NOT_INCLUDES", path };
    if (/opened|navigate|taken|url|page/.test(lower)) return { operation: "ASSERT_URL_INCLUDES", path };
  }

  return { narrative: text };
}

function compileTestCase(testCase, { pageDiscoveries = [], hasCredentials = false } = {}) {
  const discovery = buildDiscoveryIndex(pageDiscoveries);
  const validLoginRequired = requiresValidLogin(testCase);
  if (validLoginRequired && !hasCredentials) {
    return { ok: false, reasonCode: "MISSING_CREDENTIALS", reason: "Valid runtime credentials are required before this test can compile into the automation contract." };
  }

  const state = { validLoginRequired, loginInserted: false };
  const actions = [];
  const errors = [];
  for (const step of testCase?.steps || []) {
    const compiled = compileStep(step, discovery, state);
    if (!compiled) continue;
    if (compiled.error) errors.push(compiled.error);
    else actions.push(compiled);
  }

  if (validLoginRequired && !state.loginInserted) actions.unshift({ operation: "LOGIN_VALID" });

  const assertions = [];
  const narratives = [];
  for (const expected of testCase?.expectedResults || []) {
    const compiled = compileExpected(expected, discovery);
    if (compiled.error) errors.push(compiled.error);
    else if (compiled.operation) assertions.push(compiled);
    else if (compiled.narrative) narratives.push(compiled.narrative);
  }

  if (!actions.length) errors.push("No deterministic executable actions could be compiled.");
  if (!assertions.length) errors.push("No deterministic assertion could be compiled from the expected results.");

  const unsupported = [...new Set(errors)];
  if (unsupported.length) {
    return { ok: false, reasonCode: "AUTOMATION_CONTRACT_INCOMPLETE", reason: unsupported[0], errors: unsupported, supportedOperations: [...SUPPORTED_OPERATIONS] };
  }

  return {
    ok: true,
    plan: { version: 1, testCaseId: testCase.id, title: testCase.title, actions, assertions, narrativeExpectations: narratives },
  };
}

module.exports = { SUPPORTED_OPERATIONS, buildDiscoveryIndex, compileTestCase };

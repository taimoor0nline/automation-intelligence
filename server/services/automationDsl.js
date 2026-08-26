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
  "ASSERT_URL_CONTAINS",
  "ASSERT_PATH_EQUALS",
  "ASSERT_VALUE_LENGTH_EQUALS",
  "ASSERT_VALUE_LENGTH_AT_MOST",
]);

function selectorFor(item) {
  if (!item) return "";
  if (item.selector) return String(item.selector);
  if (item.testId) return `[data-testid="${item.testId}"]`;
  if (item.id) return `#${item.id}`;
  if (item.name) return `[name="${item.name}"]`;
  return "";
}

function pathForPage(page) {
  try {
    const url = new URL(page?.finalUrl || page?.url || "http://local/");
    return `${url.pathname}${url.search}` || "/";
  } catch {
    return "/";
  }
}

function buildDiscoveryIndex(pageDiscoveries = []) {
  const selectors = new Map();
  const selectorPaths = new Map();
  const paths = new Set();
  for (const page of pageDiscoveries || []) {
    const pagePath = pathForPage(page);
    paths.add(pagePath);
    const register = (item) => {
      const selector = selectorFor(item);
      if (!selector) return;
      selectors.set(selector, item);
      selectorPaths.set(selector, pagePath);
    };
    for (const item of page?.elements || []) {
      register(item);
      if (item?.errorElement) register(item.errorElement);
    }
    for (const message of page?.messages || []) register(message);
  }
  return { selectors, selectorPaths, paths };
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
  let value = step?.value === null || step?.value === undefined ? null : String(step.value);

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
    if ((value === null || value === "") && /white\s*space|spaces?[- ]only|blank spaces?/i.test(actionRaw)) value = " ";
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
    if (/non-empty|not empty|contains?\s+(?:non-empty|text|message)|message\s+['"].+['"]\s+is\s+(?:displayed|shown|visible)/i.test(text)) return { operation: "ASSERT_TEXT_NOT_EMPTY", selector };
    if (/absent|hidden|not visible|remains absent/.test(lower)) return { operation: "ASSERT_HIDDEN_OR_ABSENT", selector };
    if (/visible|shown|displayed|appears/.test(lower)) return { operation: "ASSERT_VISIBLE", selector };
  }

  const queryFragment = text.match(/(?:url|query parameter|query string)[^'"`]*['"`]([^'"`=]+=[^'"`]+)['"`]/i)?.[1];
  if (queryFragment && /contain|contains|includes|include/.test(lower)) return { operation: "ASSERT_URL_CONTAINS", fragment: queryFragment };

  const pathMatch = text.match(/\/(?:[A-Za-z0-9._~!$&'()*+,;=:@%-]+\/?)+/);
  const path = pathMatch?.[0] || "";
  if (path && discovery.paths.has(path)) {
    if (/not taken|not navigate|does not navigate|remain.*(?:login|page)/.test(lower)) return { operation: "ASSERT_URL_NOT_INCLUDES", path };
    if (/opened|navigate|taken|url|page/.test(lower)) return { operation: "ASSERT_URL_INCLUDES", path };
  }

  return { narrative: text };
}

function ensureGroundedStartPage(actions, discovery) {
  if (!actions.length) return actions;
  if (actions[0].operation === "NAVIGATE" || actions[0].operation === "LOGIN_VALID") return actions;
  const firstSelectorAction = actions.find((action) => action.selector && discovery.selectorPaths.has(action.selector));
  if (!firstSelectorAction) return actions;
  const path = discovery.selectorPaths.get(firstSelectorAction.selector);
  if (!path || !discovery.paths.has(path)) return actions;
  return [{ operation: "NAVIGATE", path }, ...actions];
}

function addDeterministicFallbackAssertions(testCase, actions, assertions, narratives, discovery) {
  const primarySelector = actions.find((action) => action.operation === "TYPE" || action.operation === "CLEAR")?.selector || "";
  const element = primarySelector ? discovery.selectors.get(primarySelector) : null;
  const ownerPath = primarySelector ? discovery.selectorPaths.get(primarySelector) : null;

  for (const text of narratives) {
    const lower = String(text).toLowerCase();
    const quotedQuery = String(text).match(/['"`]([^'"`=]+=[^'"`]+)['"`]/)?.[1];
    if (quotedQuery && /url|query parameter|query string/.test(lower) && /contain|include/.test(lower)) {
      assertions.push({ operation: "ASSERT_URL_CONTAINS", fragment: quotedQuery });
      continue;
    }

    if (ownerPath && /remain|stays|not submitted|no search results page|homepage/.test(lower)) {
      assertions.push({ operation: "ASSERT_PATH_EQUALS", path: ownerPath.split("?")[0] || "/" });
      continue;
    }

    const length = Number(String(text).match(/\b(\d{2,6})\s*(?:characters?|chars?)\b/i)?.[1]);
    if (primarySelector && Number.isFinite(length) && /accepts? up to|does not accept more than|maximum|max length|truncated|boundary/.test(lower)) {
      const discoveredMax = Number(element?.maxlength);
      if (Number.isFinite(discoveredMax) && discoveredMax !== length) continue;
      assertions.push({ operation: /exactly|full query/.test(lower) ? "ASSERT_VALUE_LENGTH_EQUALS" : "ASSERT_VALUE_LENGTH_AT_MOST", selector: primarySelector, length });
    }
  }
}

function compileTestCase(testCase, { pageDiscoveries = [], hasCredentials = false } = {}) {
  const discovery = buildDiscoveryIndex(pageDiscoveries);
  const validLoginRequired = requiresValidLogin(testCase);
  if (validLoginRequired && !hasCredentials) return { ok: false, reasonCode: "MISSING_CREDENTIALS", reason: "Valid runtime credentials are required before this test can compile into the automation contract." };

  const state = { validLoginRequired, loginInserted: false };
  let actions = [];
  const errors = [];
  for (const step of testCase?.steps || []) {
    const compiled = compileStep(step, discovery, state);
    if (!compiled) continue;
    if (compiled.error) errors.push(compiled.error);
    else actions.push(compiled);
  }
  if (validLoginRequired && !state.loginInserted) actions.unshift({ operation: "LOGIN_VALID" });
  actions = ensureGroundedStartPage(actions, discovery);

  const assertions = [];
  const narratives = [];
  for (const expected of testCase?.expectedResults || []) {
    const compiled = compileExpected(expected, discovery);
    if (compiled.error) errors.push(compiled.error);
    else if (compiled.operation) assertions.push(compiled);
    else if (compiled.narrative) narratives.push(compiled.narrative);
  }
  addDeterministicFallbackAssertions(testCase, actions, assertions, narratives, discovery);

  if (!actions.length) errors.push("No deterministic executable actions could be compiled.");
  if (!assertions.length) errors.push("No deterministic assertion could be compiled from the expected results.");

  const unsupported = [...new Set(errors)];
  if (unsupported.length) return { ok: false, reasonCode: "AUTOMATION_CONTRACT_INCOMPLETE", reason: unsupported[0], errors: unsupported, supportedOperations: [...SUPPORTED_OPERATIONS] };
  return { ok: true, plan: { version: 1, testCaseId: testCase.id, title: testCase.title, actions, assertions, narrativeExpectations: narratives } };
}

module.exports = { SUPPORTED_OPERATIONS, buildDiscoveryIndex, compileTestCase };

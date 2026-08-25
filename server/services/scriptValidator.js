/**
 * Security and grounding gate for generated browser automation specs.
 * Generated output is validated before any code is written or executed.
 */
const vm = require("vm");

const DENYLIST_PATTERNS = [
  /require\(\s*['"]child_process['"]\s*\)/,
  /\bexec\s*\(/,
  /\bspawn\s*\(/,
  /\beval\s*\(/,
  /new\s+Function\s*\(/,
  /\bprocess\.env\b/,
  /require\(\s*['"]fs['"]\s*\)/,
  /require\(\s*['"]net['"]\s*\)/,
  /require\(\s*['"]http['"]\s*\)/,
  /require\(\s*['"]https['"]\s*\)/,
  /\bcy\.wait\(\s*\d+\s*\)/,
];

const ALLOWED_IMPORT_PATTERN = /require\(\s*['"]cypress['"]\s*\)/;
const MAX_SCRIPT_LENGTH = 200000;
const MIN_SCRIPT_LENGTH = 40;
const TEST_ID_REGEX = /TC(?:\d{3}|-H\d{3})/gi;

function validateScript(script) {
  const errors = [];
  if (typeof script !== "string" || !script.trim()) return { valid: false, errors: ["Script is empty."] };

  if (script.length > MAX_SCRIPT_LENGTH) errors.push(`Script is larger than ${MAX_SCRIPT_LENGTH} bytes.`);
  if (script.length < MIN_SCRIPT_LENGTH) errors.push("Script is too short to be a complete automation spec.");

  try {
    new vm.Script(script, { filename: "generated.cy.js" });
  } catch (err) {
    errors.push(`Syntax error: ${err.message}`);
  }

  if (!/describe\s*\(/.test(script)) errors.push("Missing describe() block.");
  if (!/\bit\s*\(/.test(script)) errors.push("Missing it() test blocks.");
  const testCount = (script.match(/\bit\s*\(/g) || []).length;
  if (testCount > 60) errors.push(`Too many it() blocks (${testCount}).`);

  for (const pattern of DENYLIST_PATTERNS) {
    if (pattern.test(script)) errors.push(`Denied pattern found: ${pattern}`);
  }

  const requires = script.match(/require\([^)]*\)/g) || [];
  for (const call of requires) {
    if (!ALLOWED_IMPORT_PATTERN.test(call)) errors.push(`Disallowed import: ${call}`);
  }

  return { valid: errors.length === 0, errors };
}

function addSelector(set, selector) {
  const value = String(selector || "").trim();
  if (value) set.add(value);
}

function discoveredGrounding(pageDiscoveries = []) {
  const selectors = new Set();
  const paths = new Set(["/"]);

  for (const page of pageDiscoveries || []) {
    try {
      const url = new URL(page?.finalUrl || page?.url || "http://local/");
      paths.add(`${url.pathname}${url.search}` || "/");
    } catch {}

    for (const item of page?.elements || []) {
      addSelector(selectors, item.selector);
      if (item.testId) addSelector(selectors, `[data-testid="${item.testId}"]`);
      if (item.id) addSelector(selectors, `#${item.id}`);
      if (item.name) addSelector(selectors, `[name="${item.name}"]`);

      const error = item.errorElement;
      addSelector(selectors, error?.selector);
      if (error?.testId) addSelector(selectors, `[data-testid="${error.testId}"]`);
      if (error?.id) addSelector(selectors, `#${error.id}`);
    }

    for (const message of page?.messages || []) {
      addSelector(selectors, message.selector);
      if (message.testId) addSelector(selectors, `[data-testid="${message.testId}"]`);
      if (message.id) addSelector(selectors, `#${message.id}`);
    }
  }

  return { selectors, paths };
}

function decodeLiteral(literal) {
  try {
    return vm.runInNewContext(literal, Object.create(null), { timeout: 25 });
  } catch {
    return null;
  }
}

function extractLiteralArgs(script, command) {
  // Match complete JavaScript string literals, including escaped quotes such as
  // "[data-testid=\"email\"]" emitted by JSON.stringify(). The older regex
  // stopped at the escaped quote and incorrectly reported "[data-testid=\\".
  const patterns = {
    "cy.get": /\bcy\.get\(\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)\s*\)/g,
    "cy.visit": /\bcy\.visit\(\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)\s*\)/g,
  };
  const pattern = patterns[command];
  if (!pattern) return [];
  const values = [];
  let match;
  while ((match = pattern.exec(script))) {
    const decoded = decodeLiteral(match[1]);
    if (typeof decoded === "string") values.push(decoded);
  }
  return values;
}

function extractTestTitles(script) {
  const titles = [];
  const pattern = /\bit\s*\(\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/g;
  let match;
  while ((match = pattern.exec(script))) {
    const decoded = decodeLiteral(match[1]);
    if (typeof decoded === "string") titles.push(decoded);
  }
  return titles;
}

function validateGroundedScript(script, {
  approvedTestCases = [],
  pageDiscoveries = [],
  hasCredentials = false,
  loginSelectors = null,
  frameworkOwnedSelectors = [],
} = {}) {
  const base = validateScript(script);
  const errors = [...base.errors];

  if (/\b(?:beforeEach|afterEach|before|after)\s*\(/.test(script)) {
    errors.push("Generated specs may not define suite/test lifecycle hooks. Keep every approved case self-contained.");
  }

  if (/\b(?:cy|Cypress)\.env\s*\(/.test(script)) {
    errors.push("Generated specs may not access runtime environment credentials directly; use cy.loginWithRuntimeCredentials().");
  }
  if (/\bTEST_(?:USERNAME|PASSWORD)\b|this\.TEST_(?:USERNAME|PASSWORD)/.test(script)) {
    errors.push("Generated specs may not reference TEST_USERNAME/TEST_PASSWORD identifiers directly.");
  }

  const helperCalls = script.match(/\bcy\.loginWithRuntimeCredentials\s*\([^)]*\)/g) || [];
  for (const call of helperCalls) {
    if (!/^cy\.loginWithRuntimeCredentials\s*\(\s*\)$/.test(call)) {
      errors.push("loginWithRuntimeCredentials must be called without arguments; selectors and credentials are automation-system-owned.");
    }
  }
  if (helperCalls.length && !hasCredentials) {
    errors.push("Generated spec requested runtime credential login but no credentials were supplied.");
  }

  const grounding = discoveredGrounding(pageDiscoveries);
  const allowedFrameworkSelectors = new Set((frameworkOwnedSelectors || []).map((value) => String(value || "").trim()).filter(Boolean));
  if (helperCalls.length) {
    const selectors = [loginSelectors?.username, loginSelectors?.password, loginSelectors?.submit].map((value) => String(value || "").trim());
    if (selectors.some((value) => !value)) {
      errors.push("Runtime login helper is unavailable because username, password and submit selectors were not grounded by the automation system.");
    }
    for (const selector of selectors.filter(Boolean)) {
      if (!grounding.selectors.has(selector)) errors.push(`Framework login selector is not grounded in page discovery: ${selector}`);
    }
  }

  const approvedIds = approvedTestCases.map((tc) => String(tc?.id || "").toUpperCase()).filter(Boolean);
  const titles = extractTestTitles(script);
  for (const id of approvedIds) {
    const matches = titles.filter((title) => title.toUpperCase().startsWith(id));
    if (matches.length !== 1) errors.push(`Approved test ${id} must map to exactly one it() block; found ${matches.length}.`);
  }
  const generatedIds = [...new Set((script.match(TEST_ID_REGEX) || []).map((id) => id.toUpperCase()))];
  for (const id of generatedIds) {
    if (!approvedIds.includes(id)) errors.push(`Generated script contains unapproved test id ${id}.`);
  }

  for (const selector of extractLiteralArgs(script, "cy.get")) {
    if (!grounding.selectors.has(selector) && !allowedFrameworkSelectors.has(selector)) {
      errors.push(`Selector is not grounded in page discovery: ${selector}`);
    }
  }

  for (const target of extractLiteralArgs(script, "cy.visit")) {
    let path = target;
    try {
      const url = new URL(target);
      path = `${url.pathname}${url.search}` || "/";
    } catch {
      if (!target.startsWith("/")) {
        errors.push(`cy.visit target must be a discovered relative path: ${target}`);
        continue;
      }
    }
    if (!grounding.paths.has(path)) errors.push(`Navigation path is not grounded in page discovery: ${path}`);
  }

  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

module.exports = { validateScript, validateGroundedScript, discoveredGrounding, extractLiteralArgs };

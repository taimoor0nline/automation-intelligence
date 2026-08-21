/**
 * Script Validation Layer
 * ------------------------
 * AI-generated code must never be executed blindly. This runs:
 *   1. Syntax validation (can Node parse it as a module?)
 *   2. Security validation (deny-list of dangerous APIs/patterns)
 *   3. Allowed-import validation
 */
const vm = require("vm");

const DENYLIST_PATTERNS = [
  /require\(\s*['"]child_process['"]\s*\)/,
  /\bexec\s*\(/,
  /\bspawn\s*\(/,
  /\beval\s*\(/,
  /new\s+Function\s*\(/,
  /fs\.readFile/,
  /process\.env\s*\)/, // enumerating process.env wholesale
  /require\(\s*['"]fs['"]\s*\)/,
  /require\(\s*['"]net['"]\s*\)/,
  /require\(\s*['"]http['"]\s*\)/,
  /require\(\s*['"]https['"]\s*\)/,
];

const ALLOWED_IMPORT_PATTERN = /require\(\s*['"](@playwright\/test|cypress)['"]\s*\)/;

function validateScript(script) {
  const errors = [];

  // 1. Syntax check
  try {
    new vm.Script(script, { filename: "generated.cy.js" });
  } catch (e) {
    errors.push(`Syntax error: ${e.message}`);
  }

  // 2. Security deny-list
  DENYLIST_PATTERNS.forEach((pattern) => {
    if (pattern.test(script)) {
      errors.push(`Denied pattern found: ${pattern}`);
    }
  });

  // 3. Cypress specs don't strictly need an explicit require(), but if one
  // exists it must be an allowed import.
  const requireCalls = script.match(/require\([^)]*\)/g) || [];
  requireCalls.forEach((call) => {
    if (!ALLOWED_IMPORT_PATTERN.test(call)) {
      errors.push(`Disallowed import: ${call}`);
    }
  });

  return { valid: errors.length === 0, errors };
}

module.exports = { validateScript };

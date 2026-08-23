/**
 * Script Validation Layer
 * ------------------------
 * AI-generated code must never be executed blindly. This runs:
 *   1. Syntax validation (can Node parse it as a module?)
 *   2. Security validation (deny-list of dangerous APIs/patterns)
 *   3. Allowed-import validation
 *   4. Structural sanity checks (real Cypress shape, reasonable size)
 *
 * The mock generator always produced safe, well-formed code, so these
 * structural checks rarely mattered before. With a real AI in the loop,
 * output isn't guaranteed to be well-formed, so they matter a lot more now.
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
  /\bcy\.wait\(\s*\d+\s*\)/, // hardcoded numeric waits — flaky and also often a sign of AI improvising
];

const ALLOWED_IMPORT_PATTERN = /require\(\s*['"](@playwright\/test|cypress)['"]\s*\)/;

const MAX_SCRIPT_LENGTH = 200000; // ~200KB — generous for a single spec, catches runaway output
const MIN_SCRIPT_LENGTH = 40; // catches empty/near-empty responses

function validateScript(script) {
  const errors = [];

  if (typeof script !== "string" || script.trim().length === 0) {
    return { valid: false, errors: ["Script is empty or not a string."] };
  }

  // 0. Size sanity — before anything else, since a huge or tiny script
  // isn't worth syntax-checking in detail.
  if (script.length > MAX_SCRIPT_LENGTH) {
    errors.push(`Script is unexpectedly large (${script.length} bytes, max ${MAX_SCRIPT_LENGTH}) — refusing to run.`);
  }
  if (script.length < MIN_SCRIPT_LENGTH) {
    errors.push(`Script is suspiciously short (${script.length} bytes) — likely incomplete.`);
  }

  // 1. Syntax check
  try {
    new vm.Script(script, { filename: "generated.cy.js" });
  } catch (e) {
    errors.push(`Syntax error: ${e.message}`);
  }

  // 2. Structural sanity — does this actually look like a Cypress spec?
  if (!/describe\s*\(/.test(script)) {
    errors.push(`Script does not contain a describe() block — doesn't look like a valid Cypress spec.`);
  }
  if (!/\bit\s*\(/.test(script)) {
    errors.push(`Script does not contain any it() test blocks.`);
  }
  const itBlockCount = (script.match(/\bit\s*\(/g) || []).length;
  if (itBlockCount > 60) {
    errors.push(`Script contains an unusually high number of test blocks (${itBlockCount}) — refusing to run without manual review.`);
  }

  // 3. Security deny-list
  DENYLIST_PATTERNS.forEach((pattern) => {
    if (pattern.test(script)) {
      errors.push(`Denied pattern found: ${pattern}`);
    }
  });

  // 4. Cypress specs don't strictly need an explicit require(), but if one
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
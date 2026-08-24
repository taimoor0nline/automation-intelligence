/**
 * Security gate for AI-generated Cypress specs.
 * The model output is validated before any code is written/executed.
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

function validateScript(script) {
  const errors = [];
  if (typeof script !== "string" || !script.trim()) return { valid: false, errors: ["Script is empty."] };

  if (script.length > MAX_SCRIPT_LENGTH) errors.push(`Script is larger than ${MAX_SCRIPT_LENGTH} bytes.`);
  if (script.length < MIN_SCRIPT_LENGTH) errors.push("Script is too short to be a complete Cypress spec.");

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

module.exports = { validateScript };

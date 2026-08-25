function normalizeGeneratedScript(script) {
  let normalized = String(script || "");

  // Exact whole-element text assertions are brittle in this demo because
  // success/error containers can include dynamic references and whitespace.
  // The generator may format the chain across multiple lines, so normalize the
  // assertion operator itself rather than trying to match one selector layout.
  normalized = normalized
    .replace(/\.should\(\s*(['"])have\.text\1\s*,/g, ".should('contain.text',")
    .replace(/\.and\(\s*(['"])have\.text\1\s*,/g, ".and('contain.text',");

  // Cypress rejects .type('') / .type(\"\") before browser interaction starts.
  // For required-field negative tests, an empty value means the field should
  // remain empty. .clear() is valid whether a previous value exists or not.
  normalized = normalized
    .replace(/\.type\(\s*''\s*(?:,\s*\{[^)]*\})?\s*\)/g, ".clear()")
    .replace(/\.type\(\s*\"\"\s*(?:,\s*\{[^)]*\})?\s*\)/g, ".clear()");

  // Generated boundary values occasionally arrive as bare numeric arguments
  // (for example .type(17)). Keep browser input deterministic by converting
  // literal numbers to strings. This does not alter variables or expressions.
  normalized = normalized.replace(
    /\.type\(\s*(-?\d+(?:\.\d+)?)\s*(,\s*\{[^)]*\})?\s*\)/g,
    (_match, value, options = "") => `.type('${value}'${options || ""})`
  );

  // A malformed URL test value such as abc must be typed as data, not executed
  // as a JavaScript identifier. Quote simple bare-word .type() arguments while
  // leaving known expressions (Cypress.env, variables with property access,
  // function calls, template/string literals) untouched. The generated demo
  // specs use literal test data for these negative cases, so this safely turns
  // .type(abc) into .type('abc') before Cypress evaluates the test body.
  normalized = normalized.replace(
    /\.type\(\s*([A-Za-z_$][\w$-]*)\s*(,\s*\{[^)]*\})?\s*\)/g,
    (_match, value, options = "") => `.type('${value}'${options || ""})`
  );

  return normalized;
}

module.exports = { normalizeGeneratedScript };

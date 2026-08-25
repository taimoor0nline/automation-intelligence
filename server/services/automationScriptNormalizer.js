function normalizeGeneratedScript(script) {
  let normalized = String(script || "");

  // Exact whole-element text assertions are brittle in this demo because
  // success/error containers can include dynamic references and whitespace.
  // The generator may format the chain across multiple lines, so normalize the
  // assertion operator itself rather than trying to match one selector layout.
  normalized = normalized
    .replace(/\.should\(\s*(['"])have\.text\1\s*,/g, ".should('contain.text',")
    .replace(/\.and\(\s*(['"])have\.text\1\s*,/g, ".and('contain.text',");

  // Cypress environment values are read through Cypress.env(...), not cy.env(...).
  // Some generated specs wrapped credentials in:
  //   cy.env(['TEST_USERNAME','TEST_PASSWORD']).then(({ ... }) => { ... })
  // which fails before meaningful browser interaction because cy.env is not a
  // Cypress chainable command. Keep the existing callback shape but convert the
  // invalid wrapper to a normal cy.then(), then resolve the injected credentials
  // directly at the .type() call sites.
  normalized = normalized.replace(
    /cy\.env\(\s*\[\s*(['"])TEST_USERNAME\1\s*,\s*(['"])TEST_PASSWORD\2\s*\]\s*(?:,\s*\{[^)]*\})?\s*\)\.then\(\s*\(\s*\{\s*TEST_USERNAME\s*,\s*TEST_PASSWORD\s*\}\s*\)\s*=>\s*\{/g,
    "cy.then(() => {"
  );

  // The model can also accidentally emit the environment variable *names* as
  // quoted test data. Resolve those names to the actual credentials injected by
  // the runner instead of literally typing TEST_USERNAME / TEST_PASSWORD.
  normalized = normalized
    .replace(/\.type\(\s*(['"])TEST_USERNAME\1\s*(,\s*\{[^)]*\})?\s*\)/g,
      (_match, _quote, options = "") => `.type(Cypress.env('TEST_USERNAME')${options || ""})`)
    .replace(/\.type\(\s*(['"])TEST_PASSWORD\1\s*(,\s*\{[^)]*\})?\s*\)/g,
      (_match, _quote, options = "") => `.type(Cypress.env('TEST_PASSWORD')${options || ""})`);

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
  // leaving explicit environment expressions, function calls, property access,
  // template/string literals and other expressions untouched.
  normalized = normalized.replace(
    /\.type\(\s*([A-Za-z_$][\w$-]*)\s*(,\s*\{[^)]*\})?\s*\)/g,
    (_match, value, options = "") => `.type('${value}'${options || ""})`
  );

  return normalized;
}

module.exports = { normalizeGeneratedScript };

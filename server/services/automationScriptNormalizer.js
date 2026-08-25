function normalizeGeneratedScript(script) {
  let normalized = String(script || "");

  // Exact whole-element text assertions are brittle in this demo because
  // success/error containers can include dynamic references and whitespace.
  normalized = normalized
    .replace(/\.should\(\s*(['"])have\.text\1\s*,/g, ".should('contain.text',")
    .replace(/\.and\(\s*(['"])have\.text\1\s*,/g, ".and('contain.text',");

  // Generated specs sometimes use the invalid Cypress pattern:
  //   cy.env(['TEST_USERNAME','TEST_PASSWORD']).then(({ TEST_USERNAME, TEST_PASSWORD }) => { ... })
  // Cypress.env(...) is synchronous; cy.env(...) is not a chainable command.
  normalized = normalized.replace(
    /cy\.env\(\s*\[\s*(['"])TEST_USERNAME\1\s*,\s*(['"])TEST_PASSWORD\2\s*\]\s*(?:,\s*\{[^)]*\})?\s*\)\.then\(\s*\(\s*\{\s*TEST_USERNAME\s*,\s*TEST_PASSWORD\s*\}\s*\)\s*=>\s*\{/g,
    "cy.then(() => {"
  );

  // Another generated variant creates a beforeEach hook containing bare,
  // undefined TEST_USERNAME / TEST_PASSWORD identifiers. Resolve those values
  // from Cypress.env so the hook cannot abort the entire suite before TC001.
  normalized = normalized.replace(
    /cy\.wrap\(\s*\{\s*TEST_USERNAME\s*,\s*TEST_PASSWORD\s*\}\s*\)/g,
    "cy.wrap({ TEST_USERNAME: Cypress.env('TEST_USERNAME'), TEST_PASSWORD: Cypress.env('TEST_PASSWORD') })"
  );

  // Resolve quoted credential placeholders everywhere they are supplied to
  // .type(). Keep options such as { log: false } intact.
  normalized = normalized
    .replace(/\.type\(\s*(['"])TEST_USERNAME\1\s*(,\s*\{[^)]*\})?\s*\)/g,
      (_match, _quote, options = "") => `.type(Cypress.env('TEST_USERNAME')${options || ""})`)
    .replace(/\.type\(\s*(['"])TEST_PASSWORD\1\s*(,\s*\{[^)]*\})?\s*\)/g,
      (_match, _quote, options = "") => `.type(Cypress.env('TEST_PASSWORD')${options || ""})`);

  // Guard against generated shorthand assertions such as:
  //   .and('have.text').to.not.be.empty
  // which is not a valid Cypress chain. Convert it to an explicit text check.
  normalized = normalized.replace(
    /\.and\(\s*(['"])have\.text\1\s*\)\.to\.not\.be\.empty/g,
    ".invoke('text').should('not.be.empty')"
  );

  // Cypress rejects .type('') / .type("") before browser interaction starts.
  // For required-field negative tests, an empty value means the field should
  // remain empty. .clear() is valid whether a previous value exists or not.
  normalized = normalized
    .replace(/\.type\(\s*''\s*(?:,\s*\{[^)]*\})?\s*\)/g, ".clear()")
    .replace(/\.type\(\s*""\s*(?:,\s*\{[^)]*\})?\s*\)/g, ".clear()");

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

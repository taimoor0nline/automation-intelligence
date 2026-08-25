function normalizeGeneratedScript(script) {
  let normalized = String(script || "");

  // Exact whole-element text assertions are brittle when containers include
  // dynamic references or whitespace.
  normalized = normalized
    .replace(/\.should\(\s*(['"])have\.text\1\s*,/g, ".should('contain.text',")
    .replace(/\.and\(\s*(['"])have\.text\1\s*,/g, ".and('contain.text',");

  // Login selectors and credentials are framework-owned. Older prompts/models may
  // still emit selector arguments; collapse any simple object-form invocation to
  // the parameterless deterministic helper before validation.
  normalized = normalized.replace(
    /cy\.loginWithRuntimeCredentials\(\s*\{[\s\S]*?\}\s*\)/g,
    "cy.loginWithRuntimeCredentials()"
  );

  // Guard against generated shorthand assertions such as:
  //   .and('have.text').to.not.be.empty
  normalized = normalized.replace(
    /\.and\(\s*(['"])have\.text\1\s*\)\.to\.not\.be\.empty/g,
    ".invoke('text').should('not.be.empty')"
  );

  // Cypress rejects .type('') / .type("") before browser interaction starts.
  normalized = normalized
    .replace(/\.type\(\s*''\s*(?:,\s*\{[^)]*\})?\s*\)/g, ".clear()")
    .replace(/\.type\(\s*""\s*(?:,\s*\{[^)]*\})?\s*\)/g, ".clear()");

  // Convert literal numeric input to strings.
  normalized = normalized.replace(
    /\.type\(\s*(-?\d+(?:\.\d+)?)\s*(,\s*\{[^)]*\})?\s*\)/g,
    (_match, value, options = "") => `.type('${value}'${options || ""})`
  );

  // Quote simple bare-word .type() data while leaving function calls and other
  // expressions untouched. This covers malformed URL values such as abc.
  normalized = normalized.replace(
    /\.type\(\s*([A-Za-z_$][\w$-]*)\s*(,\s*\{[^)]*\})?\s*\)/g,
    (_match, value, options = "") => `.type('${value}'${options || ""})`
  );

  return normalized;
}

module.exports = { normalizeGeneratedScript };

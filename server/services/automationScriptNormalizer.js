function normalizeGeneratedScript(script) {
  let normalized = String(script || "");

  // Exact whole-element text assertions are brittle in this demo because
  // success/error containers can include dynamic references and whitespace.
  // Qwen may format the chain across multiple lines, so normalize the assertion
  // operator itself rather than trying to match one specific selector layout.
  normalized = normalized
    .replace(/\.should\(\s*(['"])have\.text\1\s*,/g, ".should('contain.text',")
    .replace(/\.and\(\s*(['"])have\.text\1\s*,/g, ".and('contain.text',");

  return normalized;
}

module.exports = { normalizeGeneratedScript };

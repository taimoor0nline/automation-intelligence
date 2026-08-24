function normalizeSuccessPanelAssertions(script) {
  let normalized = String(script || "");

  // Qwen can occasionally use exact whole-element text equality for the
  // success panel. The demo success panel also contains a dynamic feedback
  // reference, so exact equality turns a successful business flow into an
  // automation defect. Keep the assertion meaningful but tolerant of the
  // dynamic suffix by requiring visibility plus the known static text.
  normalized = normalized.replace(
    /(cy\.get\(\s*['"]\[data-testid=['"]success-panel['"]\]['"]\s*\)(?:\s*\.[a-zA-Z]+\([^;]*?\))*?\s*)\.should\(\s*['"]have\.text['"]\s*,\s*([^\)]+)\)/gs,
    "$1.should('be.visible').and('contain.text', $2)"
  );

  // Handle the common direct form without intermediate chaining separately.
  normalized = normalized.replace(
    /(cy\.get\(\s*['"]\[data-testid=['"]success-panel['"]\]['"]\s*\))\s*\.should\(\s*['"]have\.text['"]\s*,\s*([^\)]+)\)/gs,
    "$1.should('be.visible').and('contain.text', $2)"
  );

  return normalized;
}

function normalizeGeneratedScript(script) {
  return normalizeSuccessPanelAssertions(script);
}

module.exports = { normalizeGeneratedScript };

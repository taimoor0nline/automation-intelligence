// Human-authored TestNexus automation commands. This is a constrained language,
// not arbitrary JavaScript: every browser operation resolves to the canonical IR.
const ACTIONS_WITH_ELEMENT = new Set(['TYPE','CLEAR','CLICK','SUBMIT','CHECK','UNCHECK','SELECT','FOCUS','BLUR','HOVER']);
const ACTIONS_NO_ELEMENT = new Set(['RELOAD','GO_BACK','GO_FORWARD']);
const ASSERTIONS_WITH_ELEMENT = new Set([
  'ASSERT_VISIBLE','ASSERT_HIDDEN','ASSERT_EXISTS','ASSERT_NOT_EXISTS',
  'ASSERT_INVALID','ASSERT_VALID','ASSERT_REQUIRED','ASSERT_OPTIONAL',
  'ASSERT_ENABLED','ASSERT_DISABLED','ASSERT_VALUE_EMPTY','ASSERT_VALUE_NOT_EMPTY',
  'ASSERT_TEXT_EMPTY','ASSERT_TEXT_NOT_EMPTY','ASSERT_CHECKED','ASSERT_UNCHECKED',
]);
const ASSERTIONS_WITH_VALUE = new Set([
  'ASSERT_TEXT_EQUALS','ASSERT_TEXT_CONTAINS','ASSERT_TEXT_NOT_CONTAINS',
  'ASSERT_VALUE_EQUALS','ASSERT_VALUE_CONTAINS',
]);
const ASSERTIONS_WITH_LOCATION = new Set([
  'ASSERT_PATH_EQUALS','ASSERT_PATH_INCLUDES','ASSERT_URL_EQUALS','ASSERT_URL_INCLUDES',
]);
const VALUE_ACTIONS = new Set(['TYPE','SELECT']);
function fail(line, message) {
  const error = new Error(`Automation script line ${line}: ${message}`);
  error.code = 'MANUAL_AUTOMATION_SCRIPT_INVALID';
  throw error;
}
function targetFor(ref, path, registry, line) {
  const elements = Array.isArray(registry?.elements) ? registry.elements : [];
  let found = elements.filter((item) => item.elementRef === ref || item.selector === ref);
  if (path) found = found.filter((item) => String(item.path || '') === path);
  if (!found.length) fail(line, `Control ${JSON.stringify(ref)} was not discovered${path ? ` on ${path}` : ''}. Use a discovered selector or elementRef.`);
  if (found.length !== 1) fail(line, `Control ${JSON.stringify(ref)} is ambiguous. Use its exact elementRef or navigate to the correct page first.`);
  return found[0].elementRef;
}
function parseAutomationScript(script, registry = {}) {
  if (typeof script !== 'string' || script.length > 14000) {
    const error = new Error('Automation Script must be plain text, at most 14,000 characters.');
    error.code = 'MANUAL_AUTOMATION_SCRIPT_INVALID';
    throw error;
  }
  const lines = script.split(/\r?\n/);
  if (lines.length > 100) fail(100, 'Limit the script to 100 lines.');
  const actions = [], assertions = [];
  let currentPath = '', inAssertions = false;
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].trim(), line = i + 1;
    if (!text || text.startsWith('//')) continue;
    const match = text.match(/^([A-Z_]+)(?:\s+(.+))?$/);
    if (!match) fail(line, 'Use a supported uppercase automation command; arbitrary JavaScript is not supported.');
    const operation = match[1], args = String(match[2] || '').trim();
    if (operation === 'NAVIGATE') {
      if (inAssertions) fail(line, 'All actions must appear before the final assertions.');
      if (!args.startsWith('/')) fail(line, 'NAVIGATE requires a discovered same-origin path, such as /login.');
      currentPath = args.split('?')[0] || '/';
      actions.push({ operation, path: args });
      continue;
    }
    if (ACTIONS_NO_ELEMENT.has(operation)) {
      if (inAssertions) fail(line, 'All actions must appear before assertions.');
      if (args) fail(line, `${operation} does not accept arguments.`);
      actions.push({ operation });
      continue;
    }
    const targetAndValue = args.match(/^(\S+)(?:\s+([\s\S]+))?$/);
    if (ACTIONS_WITH_ELEMENT.has(operation)) {
      if (inAssertions) fail(line, 'All actions must appear before assertions.');
      if (!targetAndValue) fail(line, `${operation} requires a discovered selector or elementRef.`);
      const elementRef = targetFor(targetAndValue[1], currentPath, registry, line);
      const value = targetAndValue[2];
      if (VALUE_ACTIONS.has(operation) && !value) fail(line, `${operation} requires a value. Use CLEAR to empty a field.`);
      if (!VALUE_ACTIONS.has(operation) && value) fail(line, `${operation} takes only a control target.`);
      actions.push(VALUE_ACTIONS.has(operation) ? { operation, elementRef, value } : { operation, elementRef });
      continue;
    }
    if (ASSERTIONS_WITH_ELEMENT.has(operation) || ASSERTIONS_WITH_VALUE.has(operation)) {
      inAssertions = true;
      if (!targetAndValue) fail(line, `${operation} requires a discovered selector or elementRef.`);
      const elementRef = targetFor(targetAndValue[1], currentPath, registry, line);
      const value = targetAndValue[2];
      if (ASSERTIONS_WITH_VALUE.has(operation) && !value) fail(line, `${operation} requires expected text/value.`);
      if (!ASSERTIONS_WITH_VALUE.has(operation) && value) fail(line, `${operation} takes only a control target.`);
      assertions.push(ASSERTIONS_WITH_VALUE.has(operation)
        ? { operation, elementRef, ...(operation.includes('TEXT') ? { text: value } : { value }) }
        : { operation, elementRef });
      continue;
    }
    if (ASSERTIONS_WITH_LOCATION.has(operation)) {
      inAssertions = true;
      if (!args) fail(line, `${operation} requires the exact expected location.`);
      assertions.push({ operation, ...(operation === 'ASSERT_PATH_EQUALS' ? { path: args } :
        operation === 'ASSERT_URL_EQUALS' ? { url: args } : { fragment: args }) });
      continue;
    }
    fail(line, `${operation} is not in the supported manual automation subset.`);
  }
  if (!actions.length) fail(1, 'At least one browser action is required.');
  if (!assertions.length) fail(lines.length || 1, 'At least one deterministic assertion is required.');
  return { actions, assertions };
}
module.exports = { parseAutomationScript };

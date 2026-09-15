const VERSION = 'HTML_COMPILED_ALIGNMENT_V2';

function clean(value) { return String(value ?? '').trim(); }
function op(value) { return clean(value).toUpperCase(); }
function issue(code, message, details = null) { return { code, message, details }; }
function normalizeFiles(action = {}) {
  if (Array.isArray(action.fileNames)) return action.fileNames.map((value) => clean(value)).filter(Boolean);
  const single = clean(action.fileName);
  return single ? [single] : [];
}
function normalizeValues(action = {}) {
  return Array.isArray(action.values) ? action.values.map((value) => clean(value)).filter(Boolean) : [];
}
function sameJson(left, right) { return JSON.stringify(left) === JSON.stringify(right); }

function validateHtmlCompiledAlignment(testCase = {}) {
  const source = Array.isArray(testCase?.canonicalIr?.actions) ? testCase.canonicalIr.actions : [];
  const compiled = Array.isArray(testCase?.automationReadiness?.automationPlan?.actions) ? testCase.automationReadiness.automationPlan.actions : [];
  const problems = [];

  for (let index = 0; index < Math.min(source.length, compiled.length); index += 1) {
    const expected = source[index] || {};
    const actual = compiled[index] || {};
    const operation = op(expected.operation);
    if (['SELECT_FILES','DROP_FILES'].includes(operation)) {
      const expectedFiles = normalizeFiles(expected);
      const actualFiles = normalizeFiles(actual);
      if (!sameJson(expectedFiles, actualFiles)) {
        problems.push(issue(
          'HTML_COMPILED_FILE_ARRAY_DRIFT',
          `${operation} fileNames changed while compiling the executable plan. The exact reviewed file list and order must be preserved.`,
          { actionIndex: index, expectedFiles, actualFiles }
        ));
      }
    }
    if (operation === 'SELECT_MULTIPLE') {
      const expectedValues = normalizeValues(expected);
      const actualValues = normalizeValues(actual);
      if (!sameJson(expectedValues, actualValues)) {
        problems.push(issue(
          'HTML_COMPILED_SELECT_ARRAY_DRIFT',
          'SELECT_MULTIPLE values changed while compiling the executable plan. The exact reviewed option list and order must be preserved.',
          { actionIndex: index, expectedValues, actualValues }
        ));
      }
    }
  }

  return {
    ok: problems.length === 0,
    version: VERSION,
    reasonCode: problems[0]?.code || null,
    reason: problems[0]?.message || null,
    errors: problems,
  };
}

module.exports = { VERSION, validateHtmlCompiledAlignment, normalizeFiles, normalizeValues };

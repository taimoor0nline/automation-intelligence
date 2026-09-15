const v1 = require('./strictGeneratedArtifactValidator');

const VERSION = 'STRICT_GENERATED_ARTIFACT_V2';
function clean(value) { return String(value ?? '').trim(); }
function op(value) { return clean(value).toUpperCase(); }
function issue(code, message, details = null) { return { code, message, details }; }
function list(value) { return Array.isArray(value) ? value.map((item) => clean(item)).filter(Boolean) : []; }
function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }

function validateArraySemantics(testCase = {}) {
  const problems = [];
  const sourceActions = Array.isArray(testCase?.canonicalIr?.actions) ? testCase.canonicalIr.actions : [];
  const planActions = Array.isArray(testCase?.automationReadiness?.automationPlan?.actions) ? testCase.automationReadiness.automationPlan.actions : [];
  const sourceAssertions = Array.isArray(testCase?.canonicalIr?.assertions) ? testCase.canonicalIr.assertions : [];
  const planAssertions = Array.isArray(testCase?.automationReadiness?.automationPlan?.assertions) ? testCase.automationReadiness.automationPlan.assertions : [];

  for (let index = 0; index < Math.min(sourceActions.length, planActions.length); index += 1) {
    const operation = op(sourceActions[index]?.operation);
    if (operation === 'SELECT_MULTIPLE' && !same(list(sourceActions[index].values), list(planActions[index].values))) {
      problems.push(issue('ARTIFACT_SELECT_VALUES_DRIFT', 'SELECT_MULTIPLE values changed while compiling the exact executable artifact.', { actionIndex: index, expected: list(sourceActions[index].values), actual: list(planActions[index].values) }));
    }
    if (['SELECT_FILES','DROP_FILES'].includes(operation) && !same(list(sourceActions[index].fileNames), list(planActions[index].fileNames))) {
      problems.push(issue('ARTIFACT_FILE_NAMES_DRIFT', `${operation} fileNames changed while compiling the exact executable artifact.`, { actionIndex: index, expected: list(sourceActions[index].fileNames), actual: list(planActions[index].fileNames) }));
    }
  }

  for (let index = 0; index < Math.min(sourceAssertions.length, planAssertions.length); index += 1) {
    if (op(sourceAssertions[index]?.operation) !== 'ASSERT_SELECTED_VALUES_EQUALS') continue;
    if (!same(list(sourceAssertions[index].values), list(planAssertions[index].values))) {
      problems.push(issue('ARTIFACT_SELECTED_VALUES_ASSERTION_DRIFT', 'ASSERT_SELECTED_VALUES_EQUALS changed while compiling the exact executable artifact.', { assertionIndex: index, expected: list(sourceAssertions[index].values), actual: list(planAssertions[index].values) }));
    }
  }
  return problems;
}

function validateStrictGeneratedArtifact(testCase, context = {}) {
  const base = v1.validateStrictGeneratedArtifact(testCase, context);
  const extra = validateArraySemantics(testCase);
  const errors = [...(base.errors || []), ...extra];
  return {
    ...base,
    ok: errors.length === 0,
    version: VERSION,
    reasonCode: errors[0]?.code || null,
    reason: errors[0]?.message || null,
    errors,
  };
}

module.exports = {
  ...v1,
  VERSION,
  validateStrictGeneratedArtifact,
  validateArraySemantics,
};

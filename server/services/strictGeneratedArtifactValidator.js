const fs = require('fs');
const path = require('path');
const rawGenerator = require('./deterministicAutomationGeneratorV6');
const { buildCanonicalElementRegistry } = require('./canonicalElementRegistry');
const { validateScript } = require('./scriptValidator');

const VERSION = 'STRICT_GENERATED_ARTIFACT_V1';
const UPLOAD_ROOT = path.resolve(process.env.AUTOMATION_UPLOAD_FIXTURE_DIR || path.join(__dirname, '..', '..', 'automation-system', 'fixtures', 'uploads'));

const INTERACTIVE_OPERATIONS = new Set([
  'TYPE','TYPE_RUNTIME_CREDENTIAL','CLEAR','CLICK','DBLCLICK','RIGHTCLICK','HOVER','FOCUS','BLUR',
  'SELECT','CHECK','UNCHECK','SUBMIT','SCROLL_INTO_VIEW','PRESS_KEY','SELECT_FILE',
]);

const SEMANTIC_FIELDS = [
  'value','text','path','fragment','url','key','fileName','permission','state','queryName','count','length','pixels',
  'max','milliseconds','status','name','className','field','actorRef','credential','width','height','transport','channel',
  'contains','baselineName','threshold','maxDiffRatio','bytes','hash','method','sourceElementRef','targetElementRef',
];

function clean(value) { return String(value ?? '').trim(); }
function op(value) { return clean(value).toUpperCase(); }
function issue(code, message, details = null) { return { code, message, details }; }
function elementTag(element = {}) { return clean(element.tag).toLowerCase(); }
function elementType(element = {}) { return clean(element.type).toLowerCase(); }
function isFile(element) { return elementTag(element) === 'input' && elementType(element) === 'file'; }
function isSelect(element) { return elementTag(element) === 'select' || elementType(element) === 'select'; }
function isCheckbox(element) { return elementTag(element) === 'input' && elementType(element) === 'checkbox'; }
function isRadio(element) { return elementTag(element) === 'input' && elementType(element) === 'radio'; }

function safeFileName(value) {
  const name = clean(value);
  return Boolean(name && !name.includes('..') && !/[\\/]/.test(name) && path.basename(name) === name);
}

function uploadFixturePath(fileName) {
  if (!safeFileName(fileName)) return null;
  const candidate = path.resolve(UPLOAD_ROOT, fileName);
  const prefix = `${UPLOAD_ROOT}${path.sep}`;
  if (candidate !== UPLOAD_ROOT && !candidate.startsWith(prefix)) return null;
  return candidate;
}

function uploadFixtureExists(fileName) {
  const candidate = uploadFixturePath(fileName);
  if (!candidate) return false;
  try { return fs.statSync(candidate).isFile(); } catch { return false; }
}

function inputValueProblem(element, value) {
  const type = elementType(element);
  const text = String(value ?? '');
  if (type === 'number' && !/^-?(?:\d+|\d*\.\d+)$/.test(text)) return 'number inputs require a numeric text value so the automation command itself does not fail before application validation.';
  if (type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(text)) return 'date inputs require YYYY-MM-DD syntax.';
  if (type === 'datetime-local' && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(text)) return 'datetime-local inputs require YYYY-MM-DDTHH:mm[:ss] syntax.';
  if (type === 'month' && !/^\d{4}-\d{2}$/.test(text)) return 'month inputs require YYYY-MM syntax.';
  if (type === 'week' && !/^\d{4}-W\d{2}$/.test(text)) return 'week inputs require YYYY-Www syntax.';
  if (type === 'time' && !/^\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(text)) return 'time inputs require HH:mm[:ss] syntax.';
  return null;
}

function registryIndex(registry = {}) {
  return new Map((registry.elements || []).map((element) => [String(element.elementRef || ''), element]));
}

function compareField(expected, actual, field, kind, index, problems) {
  if (expected?.[field] === undefined) return;
  const left = JSON.stringify(expected[field]);
  const right = JSON.stringify(actual?.[field]);
  if (left !== right) problems.push(issue('ARTIFACT_CONTRACT_DRIFT', `${kind} ${index + 1} changed ${field} while compiling the executable artifact.`, { field, expected: expected[field], actual: actual?.[field] }));
}

function validateCompiledAlignment(testCase, registry) {
  const problems = [];
  const ir = testCase?.canonicalIr || {};
  const plan = testCase?.automationReadiness?.automationPlan || {};
  const byRef = registryIndex(registry);
  const actionSource = Array.isArray(ir.actions) ? ir.actions : [];
  const actionPlan = Array.isArray(plan.actions) ? plan.actions : [];
  const assertionSource = Array.isArray(ir.assertions) ? ir.assertions : [];
  const assertionPlan = Array.isArray(plan.assertions) ? plan.assertions : [];

  if (actionSource.length !== actionPlan.length) problems.push(issue('ARTIFACT_ACTION_COUNT_DRIFT', `Canonical actions (${actionSource.length}) and executable actions (${actionPlan.length}) must match exactly.`));
  if (assertionSource.length !== assertionPlan.length) problems.push(issue('ARTIFACT_ASSERTION_COUNT_DRIFT', `Canonical assertions (${assertionSource.length}) and executable assertions (${assertionPlan.length}) must match exactly.`));

  for (let index = 0; index < Math.min(actionSource.length, actionPlan.length); index += 1) {
    const source = actionSource[index];
    const compiled = actionPlan[index];
    if (op(source.operation) !== op(compiled.operation)) problems.push(issue('ARTIFACT_OPERATION_DRIFT', `Action ${index + 1} changed operation from ${op(source.operation)} to ${op(compiled.operation)}.`));
    if (source.elementRef) {
      const element = byRef.get(String(source.elementRef));
      if (!element) problems.push(issue('ARTIFACT_ELEMENT_REF_UNKNOWN', `Action ${index + 1} references an unknown rendered element.`));
      else if (clean(compiled.selector) !== clean(element.selector)) problems.push(issue('ARTIFACT_SELECTOR_DRIFT', `Action ${index + 1} executable selector does not match the selector owned by rendered discovery.`, { elementRef: source.elementRef }));
    }
    if (source.sourceElementRef) {
      const element = byRef.get(String(source.sourceElementRef));
      if (!element || clean(compiled.sourceSelector) !== clean(element.selector)) problems.push(issue('ARTIFACT_SELECTOR_DRIFT', `Action ${index + 1} source selector does not match rendered discovery.`));
    }
    if (source.targetElementRef) {
      const element = byRef.get(String(source.targetElementRef));
      if (!element || clean(compiled.targetSelector) !== clean(element.selector)) problems.push(issue('ARTIFACT_SELECTOR_DRIFT', `Action ${index + 1} target selector does not match rendered discovery.`));
    }
    for (const field of SEMANTIC_FIELDS) compareField(source, compiled, field, 'Action', index, problems);
  }

  for (let index = 0; index < Math.min(assertionSource.length, assertionPlan.length); index += 1) {
    const source = assertionSource[index];
    const compiled = assertionPlan[index];
    if (op(source.operation) !== op(compiled.operation)) problems.push(issue('ARTIFACT_OPERATION_DRIFT', `Assertion ${index + 1} changed operation from ${op(source.operation)} to ${op(compiled.operation)}.`));
    if (source.elementRef) {
      const element = byRef.get(String(source.elementRef));
      if (!element) problems.push(issue('ARTIFACT_ELEMENT_REF_UNKNOWN', `Assertion ${index + 1} references an unknown rendered element.`));
      else if (clean(compiled.selector) !== clean(element.selector)) problems.push(issue('ARTIFACT_SELECTOR_DRIFT', `Assertion ${index + 1} executable selector does not match the selector owned by rendered discovery.`, { elementRef: source.elementRef }));
    }
    for (const field of SEMANTIC_FIELDS) compareField(source, compiled, field, 'Assertion', index, problems);
  }
  return problems;
}

function validateElementSemantics(testCase, registry) {
  const problems = [];
  const byRef = registryIndex(registry);
  for (const action of testCase?.canonicalIr?.actions || []) {
    const operation = op(action.operation);
    const element = action.elementRef ? byRef.get(String(action.elementRef)) : null;
    if (action.elementRef && !element) {
      problems.push(issue('ARTIFACT_ELEMENT_REF_UNKNOWN', `${operation} references an element that is not present in rendered discovery.`));
      continue;
    }
    if (element?.disabled === true && INTERACTIVE_OPERATIONS.has(operation)) problems.push(issue('ARTIFACT_DISABLED_ELEMENT_INTERACTION', `${operation} targets a control discovered as disabled.`));

    if (operation === 'TYPE') {
      const problem = inputValueProblem(element, action.value);
      if (problem) problems.push(issue('ARTIFACT_INPUT_VALUE_SYNTAX_INVALID', `${operation}: ${problem}`, { elementRef: action.elementRef, inputType: elementType(element) }));
    }
    if (operation === 'SELECT') {
      if (!isSelect(element)) continue;
      const options = Array.isArray(element.options) ? element.options : [];
      const requested = clean(action.value);
      if (options.length && !options.some((item) => clean(item?.value) === requested || clean(item?.text) === requested)) {
        problems.push(issue('ARTIFACT_SELECT_OPTION_NOT_DISCOVERED', `SELECT value ${JSON.stringify(action.value)} is not one of the rendered options for the target control.`));
      }
    }
    if (operation === 'CHECK' && element && !isCheckbox(element) && !isRadio(element)) problems.push(issue('ARTIFACT_CHECK_TARGET_INVALID', 'CHECK requires a rendered checkbox or radio control.'));
    if (operation === 'UNCHECK' && element && !isCheckbox(element)) problems.push(issue('ARTIFACT_UNCHECK_TARGET_INVALID', 'UNCHECK requires a rendered checkbox.'));
    if (operation === 'SELECT_FILE') {
      if (!isFile(element)) problems.push(issue('ARTIFACT_FILE_TARGET_INVALID', 'File selection requires a rendered file input.'));
      if (!safeFileName(action.fileName)) problems.push(issue('ARTIFACT_UPLOAD_FILE_NAME_INVALID', 'Upload fixture must be a safe file name without directory traversal or path separators.'));
      else if (!uploadFixtureExists(action.fileName)) problems.push(issue('ARTIFACT_UPLOAD_FIXTURE_MISSING', `Upload fixture is not available in the configured fixture directory: ${action.fileName}.`));
    }
  }

  for (const assertion of testCase?.canonicalIr?.assertions || []) {
    const operation = op(assertion.operation);
    if (operation.startsWith('ASSERT_FILE_') || operation === 'ASSERT_DOWNLOADED_DOCUMENT_CONTAINS') {
      if (!safeFileName(assertion.fileName)) problems.push(issue('ARTIFACT_DOWNLOAD_FILE_NAME_INVALID', `${operation} requires a safe file name without path separators.`));
    }
  }
  return problems;
}

function validateEmitter(plan = {}) {
  const problems = [];
  for (let index = 0; index < (plan.actions || []).length; index += 1) {
    const action = plan.actions[index];
    try {
      const line = String(rawGenerator.emitAction(action) || '');
      if (!line.trim()) problems.push(issue('ARTIFACT_ACTION_EMISSION_EMPTY', `Action ${index + 1} emitted no executable command.`));
      if (op(action.operation) === 'SELECT_FILE' && (!line.includes('.selectFile(') || !line.includes("testNexusResolveUploadFixture"))) {
        problems.push(issue('ARTIFACT_FILE_EMISSION_INVALID', 'File-selection emission must resolve an approved fixture and use the runtime file-selection command.'));
      }
      if (op(action.operation) === 'SUBMIT' && /\.submit\(\);\s*$/.test(line) && !/\.is\('form'\)/.test(line)) {
        problems.push(issue('ARTIFACT_SUBMIT_EMISSION_UNSAFE', 'Submit emission must distinguish a real form from a submit button before choosing submit versus click.'));
      }
    } catch (err) {
      problems.push(issue('ARTIFACT_ACTION_EMISSION_FAILED', `Action ${index + 1} cannot be emitted safely: ${err.message}`));
    }
  }
  for (let index = 0; index < (plan.assertions || []).length; index += 1) {
    try {
      const line = String(rawGenerator.emitAssertion(plan.assertions[index]) || '');
      if (!line.trim()) problems.push(issue('ARTIFACT_ASSERTION_EMISSION_EMPTY', `Assertion ${index + 1} emitted no executable command.`));
    } catch (err) {
      problems.push(issue('ARTIFACT_ASSERTION_EMISSION_FAILED', `Assertion ${index + 1} cannot be emitted safely: ${err.message}`));
    }
  }
  return problems;
}

function validateGeneratedScriptSyntax(script, { singleCase = false } = {}) {
  const problems = [];
  const base = validateScript(String(script || ''));
  for (const message of base.errors || []) problems.push(issue('ARTIFACT_JAVASCRIPT_INVALID', message));
  const text = String(script || '');
  if (/\.prop\(\s*['"]checked['"]\s*,/.test(text)) problems.push(issue('ARTIFACT_DIRECT_STATE_MUTATION', 'Generated automation may not directly mutate checked state.'));
  if (/\.invoke\(\s*['"]val['"]\s*,/.test(text)) problems.push(issue('ARTIFACT_DIRECT_VALUE_MUTATION', 'Generated automation may not directly mutate form values through DOM setters.'));
  if (/\.then\s*\(\s*\([^)]*\)\s*=>\s*\{[^}]*\.click\s*\(\s*\)/s.test(text) && /\[0\]\.click\s*\(/.test(text)) problems.push(issue('ARTIFACT_NATIVE_CLICK_MUTATION', 'Generated automation may not bypass the runtime command queue with native element clicks.'));
  if (singleCase && (text.match(/\bit\s*\(/g) || []).length !== 1) problems.push(issue('ARTIFACT_TEST_BLOCK_COUNT_INVALID', 'A single reviewed case must compile to exactly one executable test block.'));
  return { ok: problems.length === 0, version: VERSION, errors: problems };
}

function validateRuntimePrerequisites(testCase) {
  const problems = [];
  for (const action of testCase?.automationReadiness?.automationPlan?.actions || []) {
    if (op(action.operation) !== 'SELECT_FILE') continue;
    if (!safeFileName(action.fileName)) problems.push(issue('ARTIFACT_UPLOAD_FILE_NAME_INVALID', 'Upload fixture file name is unsafe.'));
    else if (!uploadFixtureExists(action.fileName)) problems.push(issue('ARTIFACT_UPLOAD_FIXTURE_MISSING', `Upload fixture is no longer available: ${action.fileName}.`));
  }
  return { ok: problems.length === 0, errors: problems };
}

function validateStrictGeneratedArtifact(testCase, context = {}) {
  const pageDiscoveries = context.pageDiscoveries || [];
  const registry = context.canonicalElementRegistry || buildCanonicalElementRegistry(pageDiscoveries);
  const plan = testCase?.automationReadiness?.automationPlan || null;
  const problems = [];
  if (!plan) problems.push(issue('ARTIFACT_PLAN_MISSING', 'Executable automation plan is missing.'));
  else {
    problems.push(...validateCompiledAlignment(testCase, registry));
    problems.push(...validateElementSemantics(testCase, registry));
    problems.push(...validateEmitter(plan));
    try {
      const generated = rawGenerator.generateDeterministicAutomation([testCase]);
      problems.push(...validateGeneratedScriptSyntax(generated.script, { singleCase: true }).errors);
    } catch (err) {
      problems.push(issue('ARTIFACT_GENERATION_FAILED', `Executable artifact generation failed: ${err.message}`));
    }
  }
  return {
    ok: problems.length === 0,
    version: VERSION,
    reasonCode: problems[0]?.code || null,
    reason: problems[0]?.message || null,
    errors: problems,
    uploadFixtureRoot: UPLOAD_ROOT,
  };
}

function assertGeneratedScriptSyntax(script, options = {}) {
  const result = validateGeneratedScriptSyntax(script, options);
  if (!result.ok) {
    const error = new Error(result.errors[0]?.message || 'Generated executable artifact failed strict syntax validation.');
    error.code = result.errors[0]?.code || 'ARTIFACT_JAVASCRIPT_INVALID';
    error.validationErrors = result.errors;
    throw error;
  }
  return result;
}

function assertRuntimePrerequisites(testCase) {
  const result = validateRuntimePrerequisites(testCase);
  if (!result.ok) {
    const error = new Error(result.errors[0]?.message || 'Execution prerequisites changed after approval.');
    error.code = result.errors[0]?.code || 'ARTIFACT_RUNTIME_PREREQUISITE_MISSING';
    error.validationErrors = result.errors;
    throw error;
  }
  return result;
}

module.exports = {
  VERSION,
  validateStrictGeneratedArtifact,
  validateGeneratedScriptSyntax,
  validateRuntimePrerequisites,
  assertGeneratedScriptSyntax,
  assertRuntimePrerequisites,
  uploadFixtureExists,
};
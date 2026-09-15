const { finalKnownPath } = require('./deterministicStateContract');

function clean(value) { return String(value ?? '').trim(); }
function op(value) { return clean(value).toUpperCase(); }
function issue(code, message, details = null) { return { code, message, details }; }

function userRequirementText(testCase = {}, context = {}) {
  const workflow = context.workflowRequirements || testCase.workflowRequirements || null;
  return [
    context.story,
    testCase.generationStory,
    typeof workflow === 'string' ? workflow : workflow ? JSON.stringify(workflow) : '',
  ].filter(Boolean).join('\n').toLowerCase();
}

function literalInRequirement(requirementText, value) {
  const literal = clean(value);
  if (!literal) return false;
  if (/^-?\d+(?:\.\d+)?$/.test(literal)) {
    const escaped = literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^0-9.])${escaped}([^0-9.]|$)`).test(requirementText);
  }
  return requirementText.includes(literal.toLowerCase());
}

function elementMap(registry = {}) {
  return new Map((registry.elements || []).map((element) => [String(element.elementRef || ''), element]));
}

function knownAttribute(element = {}, name = '') {
  const normalized = clean(name).toLowerCase();
  const map = {
    id: 'id',
    name: 'name',
    role: 'role',
    href: 'href',
    type: 'type',
    placeholder: 'placeholder',
    autocomplete: 'autocomplete',
    min: 'min',
    max: 'max',
    minlength: 'minlength',
    maxlength: 'maxlength',
    pattern: 'pattern',
    'aria-label': 'ariaLabel',
    'data-testid': 'testId',
  };
  const field = map[normalized];
  if (!field) return { known: false, value: null };
  const value = element?.[field];
  return { known: value !== undefined && value !== null && String(value) !== '', value };
}

function expectedStaticValue(assertion, element) {
  switch (op(assertion.operation)) {
    case 'ASSERT_INPUT_TYPE_EQUALS': return { label: 'input type', expected: assertion.value, actual: element?.type };
    case 'ASSERT_PLACEHOLDER_EQUALS': return { label: 'placeholder', expected: assertion.value, actual: element?.placeholder };
    case 'ASSERT_MIN_EQUALS': return { label: 'min', expected: assertion.value, actual: element?.min };
    case 'ASSERT_MAX_EQUALS': return { label: 'max', expected: assertion.value, actual: element?.max };
    case 'ASSERT_MINLENGTH_EQUALS': return { label: 'minlength', expected: assertion.value, actual: element?.minlength };
    case 'ASSERT_MAXLENGTH_EQUALS': return { label: 'maxlength', expected: assertion.value, actual: element?.maxlength };
    case 'ASSERT_PATTERN_EQUALS': return { label: 'pattern', expected: assertion.value, actual: element?.pattern };
    case 'ASSERT_OPTION_COUNT_EQUALS': return { label: 'option count', expected: assertion.count, actual: Array.isArray(element?.options) ? element.options.length : null };
    case 'ASSERT_ATTR_EQUALS': {
      const attr = knownAttribute(element, assertion.name);
      if (!attr.known) return null;
      return { label: `attribute ${assertion.name}`, expected: assertion.value, actual: attr.value };
    }
    case 'ASSERT_ARIA_EQUALS': {
      const attr = knownAttribute(element, assertion.name);
      if (!attr.known) return null;
      return { label: `ARIA attribute ${assertion.name}`, expected: assertion.value, actual: attr.value };
    }
    default: return null;
  }
}

function validateElementStaticExpectations(testCase = {}, registry = {}, context = {}) {
  const problems = [];
  const byRef = elementMap(registry);
  const requirements = userRequirementText(testCase, context);
  for (const assertion of testCase?.canonicalIr?.assertions || []) {
    if (!assertion.elementRef) continue;
    const element = byRef.get(String(assertion.elementRef));
    if (!element) continue;
    const contract = expectedStaticValue(assertion, element);
    if (!contract) continue;
    const expected = clean(contract.expected);
    const actual = clean(contract.actual);
    if (!expected || expected === actual) continue;
    if (literalInRequirement(requirements, expected)) continue;
    problems.push(issue(
      'AUTOMATION_STATIC_EXPECTATION_UNGROUNDED',
      `${op(assertion.operation)} expects ${contract.label} ${JSON.stringify(expected)}, but rendered discovery found ${JSON.stringify(actual || '(missing)')} and the expected value is not stated in the user-authored requirement.`,
      { elementRef: assertion.elementRef, operation: op(assertion.operation), label: contract.label, expected, discovered: actual || null }
    ));
  }
  return problems;
}

function validateFinalDocumentExpectation(testCase = {}, registry = {}, context = {}) {
  const problems = [];
  const path = finalKnownPath(testCase?.canonicalIr || {}, registry);
  if (!path) return problems;
  const page = (registry.pages || []).find((item) => clean(item.path) === path);
  if (!page) return problems;
  const requirements = userRequirementText(testCase, context);
  for (const assertion of testCase?.canonicalIr?.assertions || []) {
    const operation = op(assertion.operation);
    if (operation === 'ASSERT_TITLE_EQUALS') {
      const expected = clean(assertion.text);
      const actual = clean(page.title);
      if (expected && actual && expected !== actual && !literalInRequirement(requirements, expected)) {
        problems.push(issue(
          'AUTOMATION_DOCUMENT_EXPECTATION_UNGROUNDED',
          `ASSERT_TITLE_EQUALS expects ${JSON.stringify(expected)} on ${path}, but that page was discovered with title ${JSON.stringify(actual)} and the expected title is not stated in the user-authored requirement.`,
          { path, expected, discovered: actual }
        ));
      }
    }
    if (operation === 'ASSERT_TITLE_INCLUDES') {
      const expected = clean(assertion.text);
      const actual = clean(page.title);
      if (expected && actual && !actual.includes(expected) && !literalInRequirement(requirements, expected)) {
        problems.push(issue(
          'AUTOMATION_DOCUMENT_EXPECTATION_UNGROUNDED',
          `ASSERT_TITLE_INCLUDES expects ${JSON.stringify(expected)} on ${path}, but that text is neither in the discovered page title nor stated in the user-authored requirement.`,
          { path, expected, discovered: actual }
        ));
      }
    }
  }
  return problems;
}

function validateUnknownTransitionLocations(testCase = {}, registry = {}, context = {}) {
  const ir = testCase?.canonicalIr || {};
  const locationOps = new Set([
    'ASSERT_PATH_EQUALS','ASSERT_PATH_INCLUDES','ASSERT_URL_EQUALS','ASSERT_URL_INCLUDES','ASSERT_URL_CONTAINS',
    'ASSERT_QUERY_INCLUDES','ASSERT_QUERY_PARAM_EQUALS','ASSERT_HASH_EQUALS','ASSERT_HASH_INCLUDES',
  ]);
  const assertions = (ir.assertions || []).filter((item) => locationOps.has(op(item.operation)));
  if (!assertions.length || finalKnownPath(ir, registry)) return [];
  const actions = ir.actions || [];
  const lastTransition = [...actions].reverse().find((item) => ['LOGIN_VALID','LOGIN_AS_ACTOR','SUBMIT','PRESS_KEY','GO_BACK','GO_FORWARD'].includes(op(item.operation)));
  if (!lastTransition) return [];
  const requirements = userRequirementText(testCase, context);
  const problems = [];
  for (const assertion of assertions) {
    const value = assertion.path ?? assertion.fragment ?? assertion.url ?? assertion.value ?? assertion.hash;
    if (!clean(value) || literalInRequirement(requirements, value)) continue;
    problems.push(issue(
      'AUTOMATION_LOCATION_EXPECTATION_UNGROUNDED_TRANSITION',
      `${op(assertion.operation)} expects ${JSON.stringify(clean(value))} after ${op(lastTransition.operation)}, but that transition destination is application-controlled and the expected location is not stated in the user-authored requirement. Prefer a grounded success/error assertion or make the destination explicit in the requirement.`,
      { transition: op(lastTransition.operation), expected: clean(value) }
    ));
  }
  return problems;
}

function validateStaticExpectationContract(testCase = {}, registry = {}, context = {}) {
  const errors = [
    ...validateElementStaticExpectations(testCase, registry, context),
    ...validateFinalDocumentExpectation(testCase, registry, context),
    ...validateUnknownTransitionLocations(testCase, registry, context),
  ];
  return {
    ok: errors.length === 0,
    version: 'STATIC_EXPECTATION_CONTRACT_V1',
    reasonCode: errors[0]?.code || null,
    reason: errors[0]?.message || null,
    errors,
  };
}

module.exports = {
  validateStaticExpectationContract,
  validateElementStaticExpectations,
  validateFinalDocumentExpectation,
  validateUnknownTransitionLocations,
  literalInRequirement,
  knownAttribute,
};

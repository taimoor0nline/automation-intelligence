function clean(value) { return String(value ?? '').trim(); }
function op(value) { return clean(value).toUpperCase(); }
function issue(code, message, details = null) { return { code, message, details }; }

function elementMap(registry = {}) {
  return new Map((registry.elements || []).map((element) => [String(element.elementRef || ''), element]));
}

function formKey(element = {}) {
  return clean(element.formId) || clean(element.formName) || clean(element.formAction) || null;
}

function radioGroupKey(element = {}) {
  if (clean(element.type).toLowerCase() !== 'radio') return null;
  const name = clean(element.name) || clean(element.groupName);
  if (!name) return null;
  return `${clean(element.pageRef)}|${formKey(element) || ''}|${name}`;
}

function valuesFor(assertions, operation, field, extraKey = null) {
  return assertions
    .filter((item) => op(item.operation) === operation && (!extraKey || clean(item.name) === clean(extraKey)))
    .map((item) => item?.[field])
    .filter((value) => value !== undefined && value !== null)
    .map((value) => String(value));
}

function unique(values = []) { return [...new Set(values)]; }

function conflictPair(assertions, left, right, problems, elementRef) {
  if (!assertions.some((item) => op(item.operation) === left) || !assertions.some((item) => op(item.operation) === right)) return;
  problems.push(issue(
    'AUTOMATION_CONTRADICTORY_FINAL_ASSERTIONS',
    `${elementRef || 'The final browser state'} cannot satisfy both ${left} and ${right}.`,
    { elementRef: elementRef || null, operations: [left, right] }
  ));
}

function conflictingLiteral(assertions, operation, field, problems, elementRef, name = null) {
  const values = unique(valuesFor(assertions, operation, field, name));
  if (values.length <= 1) return;
  problems.push(issue(
    'AUTOMATION_CONFLICTING_FINAL_VALUES',
    `${operation}${name ? `(${name})` : ''} has multiple incompatible final values: ${values.join(', ')}.`,
    { elementRef: elementRef || null, operation, field, name, values }
  ));
}

function numericBounds(assertions, { equals, atLeast, atMost, field }, problems, elementRef) {
  const eq = unique(valuesFor(assertions, equals, field)).map(Number).filter(Number.isFinite);
  const lower = unique(valuesFor(assertions, atLeast, field)).map(Number).filter(Number.isFinite);
  const upper = unique(valuesFor(assertions, atMost, field)).map(Number).filter(Number.isFinite);
  if (eq.length > 1) {
    problems.push(issue('AUTOMATION_CONFLICTING_FINAL_VALUES', `${equals} has multiple incompatible final values: ${eq.join(', ')}.`, { elementRef, values: eq }));
  }
  const min = lower.length ? Math.max(...lower) : null;
  const max = upper.length ? Math.min(...upper) : null;
  if (min !== null && max !== null && min > max) {
    problems.push(issue('AUTOMATION_IMPOSSIBLE_FINAL_RANGE', `${atLeast} ${min} conflicts with ${atMost} ${max}.`, { elementRef, min, max }));
  }
  if (eq.length === 1) {
    const value = eq[0];
    if ((min !== null && value < min) || (max !== null && value > max)) {
      problems.push(issue('AUTOMATION_IMPOSSIBLE_FINAL_RANGE', `${equals} ${value} is outside the asserted final range${min !== null ? ` >= ${min}` : ''}${max !== null ? ` <= ${max}` : ''}.`, { elementRef, value, min, max }));
    }
  }
}

function validateElementAssertionConsistency(ir = {}, registry = {}) {
  const problems = [];
  const byRef = elementMap(registry);
  const grouped = new Map();
  for (const assertion of ir.assertions || []) {
    if (!assertion?.elementRef) continue;
    const key = String(assertion.elementRef);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(assertion);
  }

  for (const [elementRef, assertions] of grouped) {
    const operations = new Set(assertions.map((item) => op(item.operation)));
    const presenceRequiring = assertions.filter((item) => !['ASSERT_NOT_EXISTS','ASSERT_HIDDEN_OR_ABSENT'].includes(op(item.operation)));
    if (operations.has('ASSERT_NOT_EXISTS') && presenceRequiring.length) {
      problems.push(issue(
        'AUTOMATION_CONTRADICTORY_FINAL_ASSERTIONS',
        `${elementRef} is asserted absent and also asserted through operations that require the element to exist.`,
        { elementRef, conflictingOperations: presenceRequiring.map((item) => op(item.operation)) }
      ));
    }

    for (const [left, right] of [
      ['ASSERT_VISIBLE','ASSERT_HIDDEN'],
      ['ASSERT_VISIBLE','ASSERT_HIDDEN_OR_ABSENT'],
      ['ASSERT_CHECKED','ASSERT_UNCHECKED'],
      ['ASSERT_ENABLED','ASSERT_DISABLED'],
      ['ASSERT_REQUIRED','ASSERT_OPTIONAL'],
      ['ASSERT_READONLY','ASSERT_NOT_READONLY'],
      ['ASSERT_VALID','ASSERT_INVALID'],
      ['ASSERT_TEXT_EMPTY','ASSERT_TEXT_NOT_EMPTY'],
      ['ASSERT_VALUE_EMPTY','ASSERT_VALUE_NOT_EMPTY'],
      ['ASSERT_ELEMENT_IN_VIEWPORT','ASSERT_ELEMENT_NOT_IN_VIEWPORT'],
    ]) conflictPair(assertions, left, right, problems, elementRef);

    for (const [operation, field] of [
      ['ASSERT_TEXT_EQUALS','text'],
      ['ASSERT_HTML_EQUALS','html'],
      ['ASSERT_VALUE_EQUALS','value'],
      ['ASSERT_SELECTED_VALUE_EQUALS','value'],
      ['ASSERT_SELECTED_TEXT_EQUALS','text'],
      ['ASSERT_OPTION_COUNT_EQUALS','count'],
      ['ASSERT_INPUT_TYPE_EQUALS','value'],
      ['ASSERT_PLACEHOLDER_EQUALS','value'],
      ['ASSERT_MIN_EQUALS','value'],
      ['ASSERT_MAX_EQUALS','value'],
      ['ASSERT_MINLENGTH_EQUALS','value'],
      ['ASSERT_MAXLENGTH_EQUALS','value'],
      ['ASSERT_PATTERN_EQUALS','value'],
    ]) conflictingLiteral(assertions, operation, field, problems, elementRef);

    const attrNames = unique(assertions.filter((item) => ['ASSERT_ATTR_EXISTS','ASSERT_ATTR_NOT_EXISTS','ASSERT_ATTR_EQUALS','ASSERT_ATTR_CONTAINS'].includes(op(item.operation))).map((item) => clean(item.name)).filter(Boolean));
    for (const name of attrNames) {
      const attrOps = assertions.filter((item) => clean(item.name) === name);
      if (attrOps.some((item) => op(item.operation) === 'ASSERT_ATTR_NOT_EXISTS') && attrOps.some((item) => ['ASSERT_ATTR_EXISTS','ASSERT_ATTR_EQUALS','ASSERT_ATTR_CONTAINS'].includes(op(item.operation)))) {
        problems.push(issue('AUTOMATION_CONTRADICTORY_FINAL_ASSERTIONS', `${elementRef} attribute ${name} is asserted absent and present at the same final state.`, { elementRef, name }));
      }
      conflictingLiteral(attrOps, 'ASSERT_ATTR_EQUALS', 'value', problems, elementRef, name);
    }

    const classNames = unique(assertions.filter((item) => ['ASSERT_CLASS_INCLUDES','ASSERT_CLASS_NOT_INCLUDES'].includes(op(item.operation))).map((item) => clean(item.className)).filter(Boolean));
    for (const className of classNames) {
      const has = assertions.some((item) => op(item.operation) === 'ASSERT_CLASS_INCLUDES' && clean(item.className) === className);
      const absent = assertions.some((item) => op(item.operation) === 'ASSERT_CLASS_NOT_INCLUDES' && clean(item.className) === className);
      if (has && absent) problems.push(issue('AUTOMATION_CONTRADICTORY_FINAL_ASSERTIONS', `${elementRef} class ${className} is asserted both present and absent.`, { elementRef, className }));
    }

    const contains = unique(assertions.filter((item) => op(item.operation) === 'ASSERT_TEXT_CONTAINS').map((item) => clean(item.text)).filter(Boolean));
    const notContains = new Set(assertions.filter((item) => op(item.operation) === 'ASSERT_TEXT_NOT_CONTAINS').map((item) => clean(item.text)).filter(Boolean));
    for (const value of contains) if (notContains.has(value)) problems.push(issue('AUTOMATION_CONTRADICTORY_FINAL_ASSERTIONS', `${elementRef} text is asserted to both contain and not contain ${JSON.stringify(value)}.`, { elementRef, value }));

    numericBounds(assertions, { equals: 'ASSERT_COUNT_EQUALS', atLeast: 'ASSERT_COUNT_AT_LEAST', atMost: 'ASSERT_COUNT_AT_MOST', field: 'count' }, problems, elementRef);
    numericBounds(assertions, { equals: 'ASSERT_VALUE_LENGTH_EQUALS', atLeast: 'ASSERT_VALUE_LENGTH_AT_LEAST', atMost: 'ASSERT_VALUE_LENGTH_AT_MOST', field: 'length' }, problems, elementRef);
    numericBounds(assertions, { equals: 'ASSERT_ELEMENT_WIDTH_EQUALS', atLeast: 'ASSERT_ELEMENT_WIDTH_AT_LEAST', atMost: 'ASSERT_ELEMENT_WIDTH_AT_MOST', field: 'pixels' }, problems, elementRef);
    numericBounds(assertions, { equals: 'ASSERT_ELEMENT_HEIGHT_EQUALS', atLeast: 'ASSERT_ELEMENT_HEIGHT_AT_LEAST', atMost: 'ASSERT_ELEMENT_HEIGHT_AT_MOST', field: 'pixels' }, problems, elementRef);

    const element = byRef.get(elementRef);
    if (!element) continue;
    if (clean(element.type).toLowerCase() === 'radio' && operations.has('ASSERT_CHECKED')) {
      // Cross-radio group validation is performed after all elements are grouped.
    }
  }

  const checkedRadioGroups = new Map();
  for (const assertion of ir.assertions || []) {
    if (op(assertion.operation) !== 'ASSERT_CHECKED' || !assertion.elementRef) continue;
    const element = byRef.get(String(assertion.elementRef));
    const key = radioGroupKey(element);
    if (!key) continue;
    if (!checkedRadioGroups.has(key)) checkedRadioGroups.set(key, new Set());
    checkedRadioGroups.get(key).add(String(assertion.elementRef));
  }
  for (const [group, refs] of checkedRadioGroups) {
    if (refs.size > 1) problems.push(issue(
      'AUTOMATION_IMPOSSIBLE_RADIO_FINAL_STATE',
      `A radio group can have only one checked option, but the final contract asserts ${refs.size} options checked.`,
      { group, elementRefs: [...refs] }
    ));
  }

  return problems;
}

function validateGlobalAssertionConsistency(ir = {}) {
  const problems = [];
  const assertions = ir.assertions || [];
  for (const [operation, field] of [
    ['ASSERT_TITLE_EQUALS','text'],
    ['ASSERT_HASH_EQUALS','hash'],
    ['ASSERT_ORIGIN_EQUALS','value'],
    ['ASSERT_HOST_EQUALS','value'],
    ['ASSERT_PROTOCOL_EQUALS','value'],
    ['ASSERT_VIEWPORT_WIDTH_EQUALS','width'],
    ['ASSERT_VIEWPORT_HEIGHT_EQUALS','height'],
  ]) conflictingLiteral(assertions, operation, field, problems, null);

  const queryNames = unique(assertions.filter((item) => ['ASSERT_QUERY_PARAM_EQUALS','ASSERT_QUERY_PARAM_ABSENT'].includes(op(item.operation))).map((item) => clean(item.name)).filter(Boolean));
  for (const name of queryNames) {
    const scoped = assertions.filter((item) => clean(item.name) === name);
    const absent = scoped.some((item) => op(item.operation) === 'ASSERT_QUERY_PARAM_ABSENT');
    const equals = scoped.filter((item) => op(item.operation) === 'ASSERT_QUERY_PARAM_EQUALS');
    if (absent && equals.length) problems.push(issue('AUTOMATION_CONTRADICTORY_FINAL_ASSERTIONS', `Query parameter ${name} is asserted both absent and equal to a value.`, { name }));
    conflictingLiteral(scoped, 'ASSERT_QUERY_PARAM_EQUALS', 'value', problems, null, name);
  }

  for (const family of [
    { prefix: 'ASSERT_COOKIE_', exists: 'ASSERT_COOKIE_EXISTS', equals: 'ASSERT_COOKIE_EQUALS', absent: 'ASSERT_COOKIE_ABSENT', keyField: 'name' },
    { prefix: 'ASSERT_LOCAL_STORAGE_', exists: 'ASSERT_LOCAL_STORAGE_EXISTS', equals: 'ASSERT_LOCAL_STORAGE_EQUALS', absent: 'ASSERT_LOCAL_STORAGE_ABSENT', keyField: 'key' },
    { prefix: 'ASSERT_SESSION_STORAGE_', exists: 'ASSERT_SESSION_STORAGE_EXISTS', equals: 'ASSERT_SESSION_STORAGE_EQUALS', absent: 'ASSERT_SESSION_STORAGE_ABSENT', keyField: 'key' },
  ]) {
    const scopedFamily = assertions.filter((item) => op(item.operation).startsWith(family.prefix));
    const keys = unique(scopedFamily.map((item) => clean(item[family.keyField] ?? item.name ?? item.key)).filter(Boolean));
    for (const key of keys) {
      const scoped = scopedFamily.filter((item) => clean(item[family.keyField] ?? item.name ?? item.key) === key);
      const absent = scoped.some((item) => op(item.operation) === family.absent);
      const present = scoped.some((item) => [family.exists, family.equals].includes(op(item.operation)));
      if (absent && present) problems.push(issue('AUTOMATION_CONTRADICTORY_FINAL_ASSERTIONS', `${family.prefix.replace('ASSERT_','').replace(/_$/,'').toLowerCase()} ${key} is asserted both absent and present.`, { key }));
      conflictingLiteral(scoped, family.equals, 'value', problems, null, key);
    }
  }
  return problems;
}

function isSubmitControl(element = {}) {
  const tag = clean(element.tag).toLowerCase();
  const type = clean(element.type).toLowerCase();
  return tag === 'form' || ((tag === 'button' || tag === 'input') && type === 'submit');
}

function validateFormOwnership(ir = {}, registry = {}) {
  const problems = [];
  const byRef = elementMap(registry);
  const formInteractions = new Set(['TYPE','TYPE_RUNTIME_CREDENTIAL','CLEAR','SELECT','CHECK','UNCHECK']);
  let pending = [];

  function reset() { pending = []; }
  function validateSubmit(action, index, element) {
    const targetForm = formKey(element);
    if (!targetForm) { reset(); return; }
    const mismatched = pending.filter((item) => item.form && item.form !== targetForm);
    if (mismatched.length) {
      problems.push(issue(
        'AUTOMATION_FORM_OWNERSHIP_MISMATCH',
        `Submission targets form ${targetForm}, but preceding field actions in the same flow belong to another form.`,
        { submitActionIndex: index, submitElementRef: action.elementRef || null, targetForm, mismatched }
      ));
    }
    reset();
  }

  for (let index = 0; index < (ir.actions || []).length; index += 1) {
    const action = ir.actions[index] || {};
    const operation = op(action.operation);
    const element = action.elementRef ? byRef.get(String(action.elementRef)) : null;
    if (['NAVIGATE','LOGIN_VALID','LOGIN_AS_ACTOR','GO_BACK','GO_FORWARD'].includes(operation)) { reset(); continue; }
    if (formInteractions.has(operation) && element) pending.push({ actionIndex: index, elementRef: action.elementRef, form: formKey(element) });
    if (operation === 'SUBMIT' && element) validateSubmit(action, index, element);
    else if (operation === 'CLICK' && element && isSubmitControl(element)) validateSubmit(action, index, element);
  }
  return problems;
}

function finalKnownPath(ir = {}, registry = {}) {
  const byRef = elementMap(registry);
  let path = null;
  let known = false;
  for (const action of ir.actions || []) {
    const operation = op(action.operation);
    const element = action.elementRef ? byRef.get(String(action.elementRef)) : null;
    if (operation === 'NAVIGATE') { path = clean(action.path ?? action.value); known = Boolean(path); continue; }
    if (['LOGIN_VALID','LOGIN_AS_ACTOR','GO_BACK','GO_FORWARD','SUBMIT','PRESS_KEY'].includes(operation)) { path = null; known = false; continue; }
    if (operation === 'CLICK' && element) {
      if (element.destinationPath) { path = clean(element.destinationPath); known = Boolean(path); }
      else if (isSubmitControl(element) || clean(element.tag).toLowerCase() === 'button') { path = null; known = false; }
    }
  }
  return known ? path : null;
}

function validateAssertionPageContext(ir = {}, registry = {}) {
  const finalPath = finalKnownPath(ir, registry);
  if (!finalPath) return [];
  const byRef = elementMap(registry);
  const problems = [];
  for (const assertion of ir.assertions || []) {
    if (!assertion.elementRef) continue;
    const element = byRef.get(String(assertion.elementRef));
    if (!element?.path || clean(element.path) === finalPath) continue;
    problems.push(issue(
      'AUTOMATION_ASSERTION_PAGE_CONTEXT_MISMATCH',
      `${op(assertion.operation)} targets ${assertion.elementRef} from ${element.path}, but the deterministic action sequence ends on ${finalPath}.`,
      { elementRef: assertion.elementRef, assertionOperation: op(assertion.operation), elementPage: element.path, finalPath }
    ));
  }
  return problems;
}

function validateDeterministicStateContract(ir = {}, registry = {}) {
  const errors = [
    ...validateElementAssertionConsistency(ir, registry),
    ...validateGlobalAssertionConsistency(ir),
    ...validateFormOwnership(ir, registry),
    ...validateAssertionPageContext(ir, registry),
  ];
  return {
    ok: errors.length === 0,
    version: 'DETERMINISTIC_STATE_CONTRACT_V1',
    reasonCode: errors[0]?.code || null,
    reason: errors[0]?.message || null,
    errors,
  };
}

module.exports = {
  validateDeterministicStateContract,
  validateElementAssertionConsistency,
  validateGlobalAssertionConsistency,
  validateFormOwnership,
  validateAssertionPageContext,
  finalKnownPath,
};

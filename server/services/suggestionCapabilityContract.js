const VERSION = 'SEARCHABLE_SUGGESTION_CONTRACT_V2';

const ACTION_CAPABILITIES = Object.freeze({
  OPEN_COMBOBOX: 'OPEN_COMBOBOX',
  CLOSE_COMBOBOX: 'CLOSE_COMBOBOX',
  SEARCH_SUGGESTIONS: 'SEARCH_SUGGESTIONS',
  CLEAR_SUGGESTION_SEARCH: 'CLEAR_SUGGESTION_SEARCH',
  SELECT_SUGGESTION: 'SELECT_SUGGESTION',
  SELECT_SUGGESTIONS: 'SELECT_SUGGESTIONS',
  SCROLL_SUGGESTIONS_TO_VALUE: 'TRAVERSE_SUGGESTIONS',
  SELECT_SUGGESTION_BY_TRAVERSAL: 'SELECT_SUGGESTION_BY_TRAVERSAL',
  REMOVE_SELECTED_TAG: 'REMOVE_SELECTED_TAG',
  CLEAR_SELECTED_TAGS: 'CLEAR_SELECTED_TAGS',
});
const ASSERTION_CAPABILITIES = Object.freeze({
  ASSERT_COMBOBOX_EXPANDED: 'ASSERT_COMBOBOX_STATE',
  ASSERT_COMBOBOX_COLLAPSED: 'ASSERT_COMBOBOX_STATE',
  ASSERT_SUGGESTION_VISIBLE: 'ASSERT_SUGGESTIONS',
  ASSERT_SUGGESTION_NOT_VISIBLE: 'ASSERT_SUGGESTIONS',
  ASSERT_NO_SUGGESTIONS: 'ASSERT_SUGGESTIONS',
  ASSERT_SUGGESTION_SELECTED: 'ASSERT_SUGGESTIONS',
  ASSERT_SELECTED_SUGGESTIONS_EQUALS: 'ASSERT_SUGGESTIONS',
  ASSERT_SEARCH_SUGGESTIONS_CONTAIN: 'ASSERT_SUGGESTIONS',
  ASSERT_SELECTED_TAG_PRESENT: 'ASSERT_SELECTED_TAGS',
  ASSERT_SELECTED_TAG_ABSENT: 'ASSERT_SELECTED_TAGS',
  ASSERT_NO_SELECTED_TAGS: 'ASSERT_SELECTED_TAGS',
});

function clean(value) { return String(value ?? '').trim(); }
function op(value) { return clean(value).toUpperCase(); }
function lower(value) { return clean(value).toLowerCase(); }
function issue(code, message, details = null) { return { code, message, details }; }
function byRef(registry = {}) { return new Map((registry.elements || []).map((element) => [String(element.elementRef || ''), element])); }
function has(element, capability) { return Boolean(element && Array.isArray(element.capabilities) && element.capabilities.includes(capability)); }
function valuesOf(item = {}) { return Array.isArray(item.values) ? item.values.map(clean).filter(Boolean) : []; }

function evidenceText(testCase = {}, context = {}) {
  const source = [
    context.story,
    context.workflowRequirements,
    testCase.generationStory,
    testCase.title,
    testCase.coverageRationale,
    ...(testCase.preconditions || []),
    ...(testCase.expectedResults || []),
    JSON.stringify(testCase.testData || {}),
  ].filter(Boolean).join('\n');
  return source.toLowerCase();
}

function suggestionLiterals(element = {}) {
  const set = new Set();
  for (const item of element.suggestions || []) {
    for (const value of [item?.value, item?.text]) {
      const text = lower(value);
      if (text) set.add(text);
    }
  }
  for (const item of element.removeTagTargets || []) {
    const text = lower(item?.value);
    if (text) set.add(text);
  }
  return set;
}

function literalGrounded(value, element, evidence, relatedValues = []) {
  const literal = lower(value);
  if (!literal) return false;
  const discovered = suggestionLiterals(element);
  if (discovered.has(literal)) return true;
  if (evidence.includes(literal)) return true;
  for (const candidate of [...discovered, ...relatedValues.map(lower).filter(Boolean)]) {
    if (candidate.includes(literal) || literal.includes(candidate)) return true;
  }
  return false;
}

function relationProblem(element = {}) {
  if (element.suggestionListId || element.suggestionListRef || element.suggestionListSelector) return null;
  return 'searchable custom suggestion interaction requires a rendered ARIA listbox relationship (aria-controls/aria-owns). Native datalist popup selection is intentionally not simulated.';
}

function removeTargetFor(element = {}, value) {
  const expected = lower(value);
  return (element.removeTagTargets || []).find((item) => lower(item?.value) === expected) || null;
}

function hasRemoveStrategy(element = {}, value = '') {
  return Boolean(removeTargetFor(element, value) || (element.removeTagPattern?.strategy === 'ARIA_LABEL_PREFIX' && clean(element.removeTagPattern?.prefix)));
}

function validateSuggestionCapabilityContract(testCase = {}, registry = {}, context = {}) {
  const errors = [];
  const elements = byRef(registry);
  const evidence = evidenceText(testCase, context);
  const irActions = Array.isArray(testCase?.canonicalIr?.actions) ? testCase.canonicalIr.actions : [];
  const planActions = Array.isArray(testCase?.automationReadiness?.automationPlan?.actions) ? testCase.automationReadiness.automationPlan.actions : [];
  const irAssertions = Array.isArray(testCase?.canonicalIr?.assertions) ? testCase.canonicalIr.assertions : [];
  const planAssertions = Array.isArray(testCase?.automationReadiness?.automationPlan?.assertions) ? testCase.automationReadiness.automationPlan.assertions : [];

  const allSelectionValues = new Map();
  for (const action of irActions) {
    const operation = op(action.operation);
    if (!['SELECT_SUGGESTION','SELECT_SUGGESTIONS','SELECT_SUGGESTION_BY_TRAVERSAL'].includes(operation)) continue;
    const values = operation === 'SELECT_SUGGESTIONS' ? valuesOf(action) : [clean(action.value)];
    allSelectionValues.set(String(action.elementRef || ''), [...(allSelectionValues.get(String(action.elementRef || '')) || []), ...values]);
  }

  irActions.forEach((action, index) => {
    const operation = op(action.operation);
    const capability = ACTION_CAPABILITIES[operation];
    if (!capability) return;
    const element = elements.get(String(action.elementRef || ''));
    if (!element || !has(element, capability)) {
      errors.push(issue('SUGGESTION_ACTION_CAPABILITY_MISMATCH', `${operation} requires discovered capability ${capability}.`, { actionIndex: index, elementRef: action.elementRef || null }));
      return;
    }
    if (element.disabled === true || element.readonly === true) errors.push(issue('SUGGESTION_CONTROL_NOT_INTERACTIVE', `${operation} targets a disabled/read-only searchable control.`, { actionIndex: index, elementRef: action.elementRef }));

    if (operation === 'SEARCH_SUGGESTIONS') {
      const query = clean(action.query ?? action.value);
      if (!query) errors.push(issue('SUGGESTION_QUERY_REQUIRED', 'SEARCH_SUGGESTIONS requires a non-empty query.', { actionIndex: index }));
      else if (!literalGrounded(query, element, evidence, allSelectionValues.get(String(action.elementRef || '')) || [])) errors.push(issue('SUGGESTION_QUERY_UNGROUNDED', `Search query ${JSON.stringify(query)} is neither discovered, explicitly required, approved test data, nor a deterministic substring of a grounded suggestion.`, { actionIndex: index, elementRef: action.elementRef }));
    }

    if (['SELECT_SUGGESTION','SCROLL_SUGGESTIONS_TO_VALUE','SELECT_SUGGESTION_BY_TRAVERSAL'].includes(operation)) {
      const value = clean(action.value ?? action.text);
      const relation = relationProblem(element);
      if (relation) errors.push(issue('SUGGESTION_LIST_RELATION_MISSING', relation, { actionIndex: index, elementRef: action.elementRef }));
      if (!value) errors.push(issue('SUGGESTION_VALUE_REQUIRED', `${operation} requires an expected option label/value.`, { actionIndex: index }));
      else if (!literalGrounded(value, element, evidence)) errors.push(issue('SUGGESTION_VALUE_UNGROUNDED', `Suggestion ${JSON.stringify(value)} is not present in rendered suggestion evidence or explicit user-authored test data/requirements.`, { actionIndex: index, elementRef: action.elementRef }));
      const maxAttempts = Number(element.suggestionTraversalMaxAttempts || 24);
      if (['SCROLL_SUGGESTIONS_TO_VALUE','SELECT_SUGGESTION_BY_TRAVERSAL'].includes(operation) && (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 50)) {
        errors.push(issue('SUGGESTION_TRAVERSAL_BOUND_INVALID', `${operation} requires a deterministic traversal bound between 1 and 50.`, { actionIndex: index, maxAttempts }));
      }
    }

    if (operation === 'SELECT_SUGGESTIONS') {
      const values = valuesOf(action);
      const relation = relationProblem(element);
      if (relation) errors.push(issue('SUGGESTION_LIST_RELATION_MISSING', relation, { actionIndex: index, elementRef: action.elementRef }));
      if (element.suggestionMultiselect !== true) errors.push(issue('SUGGESTION_MULTISELECT_NOT_GROUNDED', 'SELECT_SUGGESTIONS requires rendered aria-multiselectable=true evidence.', { actionIndex: index, elementRef: action.elementRef }));
      if (!values.length) errors.push(issue('SUGGESTION_VALUES_REQUIRED', 'SELECT_SUGGESTIONS requires at least one option.', { actionIndex: index }));
      if (new Set(values.map(lower)).size !== values.length) errors.push(issue('SUGGESTION_DUPLICATE_VALUE', 'SELECT_SUGGESTIONS contains duplicate options.', { actionIndex: index, values }));
      for (const value of values) if (!literalGrounded(value, element, evidence)) errors.push(issue('SUGGESTION_VALUE_UNGROUNDED', `Suggestion ${JSON.stringify(value)} is not present in rendered suggestion evidence or explicit user-authored test data/requirements.`, { actionIndex: index, elementRef: action.elementRef }));
    }

    if (operation === 'REMOVE_SELECTED_TAG') {
      const value = clean(action.value ?? action.text);
      if (element.suggestionMultiselect !== true) errors.push(issue('SELECTED_TAG_MULTISELECT_NOT_GROUNDED', 'REMOVE_SELECTED_TAG requires a discovered multi-select suggestion surface.', { actionIndex: index, elementRef: action.elementRef }));
      if (!value) errors.push(issue('SELECTED_TAG_VALUE_REQUIRED', 'REMOVE_SELECTED_TAG requires the exact selected value.', { actionIndex: index }));
      else if (!literalGrounded(value, element, evidence)) errors.push(issue('SELECTED_TAG_VALUE_UNGROUNDED', `Selected tag ${JSON.stringify(value)} is not discovered or explicitly required/test data.`, { actionIndex: index, elementRef: action.elementRef }));
      else if (!hasRemoveStrategy(element, value)) errors.push(issue('SELECTED_TAG_REMOVE_AFFORDANCE_MISSING', `No discovered exact remove control or reusable semantic remove-label pattern can remove ${JSON.stringify(value)}.`, { actionIndex: index, elementRef: action.elementRef }));
    }

    if (operation === 'CLEAR_SELECTED_TAGS') {
      if (element.suggestionMultiselect !== true) errors.push(issue('SELECTED_TAG_MULTISELECT_NOT_GROUNDED', 'CLEAR_SELECTED_TAGS requires a discovered multi-select suggestion surface.', { actionIndex: index, elementRef: action.elementRef }));
      if (!clean(element.clearTagsSelector)) errors.push(issue('SELECTED_TAG_CLEAR_AFFORDANCE_MISSING', 'CLEAR_SELECTED_TAGS requires exactly one discovered semantic clear-all control tied to the same listbox.', { actionIndex: index, elementRef: action.elementRef }));
    }

    const compiled = planActions[index];
    if (compiled && op(compiled.operation) === operation) {
      if (clean(compiled.selector) !== clean(element.selector)) errors.push(issue('SUGGESTION_SELECTOR_DRIFT', `${operation} compiled selector differs from rendered discovery.`, { actionIndex: index, elementRef: action.elementRef }));
      if (operation === 'SEARCH_SUGGESTIONS' && clean(compiled.query) !== clean(action.query ?? action.value)) errors.push(issue('SUGGESTION_COMPILED_QUERY_DRIFT', 'Search query changed during canonical compilation.', { actionIndex: index }));
      if (['SELECT_SUGGESTION','SCROLL_SUGGESTIONS_TO_VALUE','SELECT_SUGGESTION_BY_TRAVERSAL','REMOVE_SELECTED_TAG'].includes(operation) && clean(compiled.value) !== clean(action.value ?? action.text)) errors.push(issue('SUGGESTION_COMPILED_VALUE_DRIFT', `${operation} value changed during canonical compilation.`, { actionIndex: index }));
      if (operation === 'SELECT_SUGGESTIONS' && JSON.stringify(valuesOf(compiled)) !== JSON.stringify(valuesOf(action))) errors.push(issue('SUGGESTION_COMPILED_VALUES_DRIFT', 'Suggestion array changed or reordered during canonical compilation.', { actionIndex: index }));
      if (operation === 'CLEAR_SELECTED_TAGS' && clean(compiled.clearTagsSelector) !== clean(element.clearTagsSelector)) errors.push(issue('SELECTED_TAG_CLEAR_SELECTOR_DRIFT', 'Clear-all selector changed during canonical compilation.', { actionIndex: index }));
    }
  });

  irAssertions.forEach((assertion, index) => {
    const operation = op(assertion.operation);
    const capability = ASSERTION_CAPABILITIES[operation];
    if (!capability) return;
    const element = elements.get(String(assertion.elementRef || ''));
    if (!element || !has(element, capability)) {
      errors.push(issue('SUGGESTION_ASSERTION_CAPABILITY_MISMATCH', `${operation} requires discovered capability ${capability}.`, { assertionIndex: index, elementRef: assertion.elementRef || null }));
      return;
    }
    const noValue = ['ASSERT_COMBOBOX_EXPANDED','ASSERT_COMBOBOX_COLLAPSED','ASSERT_NO_SUGGESTIONS','ASSERT_NO_SELECTED_TAGS'].includes(operation);
    if (!noValue) {
      const values = operation === 'ASSERT_SELECTED_SUGGESTIONS_EQUALS' ? valuesOf(assertion) : [clean(assertion.value ?? assertion.text)];
      if (!values.length || values.some((value) => !value)) errors.push(issue('SUGGESTION_ASSERTION_VALUE_REQUIRED', `${operation} requires an expected suggestion/tag value.`, { assertionIndex: index }));
      for (const value of values.filter(Boolean)) if (!literalGrounded(value, element, evidence)) errors.push(issue('SUGGESTION_ASSERTION_UNGROUNDED', `${operation} uses value ${JSON.stringify(value)} that is not discovered or explicitly required.`, { assertionIndex: index, elementRef: assertion.elementRef }));
      if (['ASSERT_SELECTED_TAG_PRESENT','ASSERT_SELECTED_TAG_ABSENT'].includes(operation)) {
        for (const value of values.filter(Boolean)) if (!hasRemoveStrategy(element, value)) errors.push(issue('SELECTED_TAG_REMOVE_AFFORDANCE_MISSING', `${operation} requires a discovered exact remove affordance or reusable remove-label pattern for ${JSON.stringify(value)}.`, { assertionIndex: index, elementRef: assertion.elementRef }));
      }
    }
    if (operation === 'ASSERT_SELECTED_SUGGESTIONS_EQUALS' && element.suggestionMultiselect !== true) errors.push(issue('SUGGESTION_MULTISELECT_NOT_GROUNDED', `${operation} requires rendered aria-multiselectable=true evidence.`, { assertionIndex: index, elementRef: assertion.elementRef }));
    if (operation === 'ASSERT_NO_SELECTED_TAGS' && !element.removeTagPattern && !(element.removeTagTargets || []).length) errors.push(issue('SELECTED_TAG_REMOVE_AFFORDANCE_MISSING', 'ASSERT_NO_SELECTED_TAGS requires discovered semantic selected-tag remove affordances.', { assertionIndex: index, elementRef: assertion.elementRef }));

    const compiled = planAssertions[index];
    if (compiled && op(compiled.operation) === operation) {
      if (clean(compiled.selector) !== clean(element.selector)) errors.push(issue('SUGGESTION_SELECTOR_DRIFT', `${operation} compiled selector differs from rendered discovery.`, { assertionIndex: index, elementRef: assertion.elementRef }));
      if (operation === 'ASSERT_SELECTED_SUGGESTIONS_EQUALS' && JSON.stringify(valuesOf(compiled)) !== JSON.stringify(valuesOf(assertion))) errors.push(issue('SUGGESTION_COMPILED_VALUES_DRIFT', `${operation} values changed or reordered during canonical compilation.`, { assertionIndex: index }));
      if (['ASSERT_SELECTED_TAG_PRESENT','ASSERT_SELECTED_TAG_ABSENT'].includes(operation) && clean(compiled.value) !== clean(assertion.value ?? assertion.text)) errors.push(issue('SELECTED_TAG_COMPILED_VALUE_DRIFT', `${operation} value changed during canonical compilation.`, { assertionIndex: index }));
    }
  });

  return {
    ok: errors.length === 0,
    version: VERSION,
    reasonCode: errors[0]?.code || null,
    reason: errors[0]?.message || null,
    errors,
  };
}

module.exports = { VERSION, validateSuggestionCapabilityContract, literalGrounded, suggestionLiterals, removeTargetFor, hasRemoveStrategy };

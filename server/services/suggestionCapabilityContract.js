const VERSION = 'SEARCHABLE_SUGGESTION_CONTRACT_V1';

const ACTION_CAPABILITIES = Object.freeze({
  OPEN_COMBOBOX: 'OPEN_COMBOBOX',
  CLOSE_COMBOBOX: 'CLOSE_COMBOBOX',
  SEARCH_SUGGESTIONS: 'SEARCH_SUGGESTIONS',
  CLEAR_SUGGESTION_SEARCH: 'CLEAR_SUGGESTION_SEARCH',
  SELECT_SUGGESTION: 'SELECT_SUGGESTION',
  SELECT_SUGGESTIONS: 'SELECT_SUGGESTIONS',
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
  return set;
}

function literalGrounded(value, element, evidence, relatedValues = []) {
  const literal = lower(value);
  if (!literal) return false;
  const discovered = suggestionLiterals(element);
  if (discovered.has(literal)) return true;
  if (evidence.includes(literal)) return true;
  // Search prefixes/substrings are deterministic derivatives of a grounded option,
  // not invented business data. This permits query="bank" for option "Bank Muscat".
  for (const candidate of [...discovered, ...relatedValues.map(lower).filter(Boolean)]) {
    if (candidate.includes(literal) || literal.includes(candidate)) return true;
  }
  return false;
}

function relationProblem(element = {}) {
  if (element.suggestionListId || element.suggestionListRef || element.suggestionListSelector) return null;
  return 'searchable custom suggestion selection requires a rendered ARIA listbox relationship (aria-controls/aria-owns). Native datalist popup selection is intentionally not simulated.';
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
    if (!['SELECT_SUGGESTION','SELECT_SUGGESTIONS'].includes(operation)) continue;
    const values = operation === 'SELECT_SUGGESTION' ? [clean(action.value)] : valuesOf(action);
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

    if (operation === 'SELECT_SUGGESTION') {
      const value = clean(action.value ?? action.text);
      const relation = relationProblem(element);
      if (relation) errors.push(issue('SUGGESTION_LIST_RELATION_MISSING', relation, { actionIndex: index, elementRef: action.elementRef }));
      if (!value) errors.push(issue('SUGGESTION_VALUE_REQUIRED', 'SELECT_SUGGESTION requires an expected option label/value.', { actionIndex: index }));
      else if (!literalGrounded(value, element, evidence)) errors.push(issue('SUGGESTION_VALUE_UNGROUNDED', `Suggestion ${JSON.stringify(value)} is not present in rendered suggestion evidence or explicit user-authored test data/requirements.`, { actionIndex: index, elementRef: action.elementRef }));
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

    const compiled = planActions[index];
    if (compiled && op(compiled.operation) === operation) {
      if (clean(compiled.selector) !== clean(element.selector)) errors.push(issue('SUGGESTION_SELECTOR_DRIFT', `${operation} compiled selector differs from rendered discovery.`, { actionIndex: index, elementRef: action.elementRef }));
      if (operation === 'SEARCH_SUGGESTIONS' && clean(compiled.query) !== clean(action.query ?? action.value)) errors.push(issue('SUGGESTION_COMPILED_QUERY_DRIFT', 'Search query changed during canonical compilation.', { actionIndex: index }));
      if (operation === 'SELECT_SUGGESTION' && clean(compiled.value) !== clean(action.value ?? action.text)) errors.push(issue('SUGGESTION_COMPILED_VALUE_DRIFT', 'Suggestion value changed during canonical compilation.', { actionIndex: index }));
      if (operation === 'SELECT_SUGGESTIONS' && JSON.stringify(valuesOf(compiled)) !== JSON.stringify(valuesOf(action))) errors.push(issue('SUGGESTION_COMPILED_VALUES_DRIFT', 'Suggestion array changed or reordered during canonical compilation.', { actionIndex: index }));
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
    if (!['ASSERT_COMBOBOX_EXPANDED','ASSERT_COMBOBOX_COLLAPSED','ASSERT_NO_SUGGESTIONS'].includes(operation)) {
      const values = operation === 'ASSERT_SELECTED_SUGGESTIONS_EQUALS' ? valuesOf(assertion) : [clean(assertion.value ?? assertion.text)];
      if (!values.length || values.some((value) => !value)) errors.push(issue('SUGGESTION_ASSERTION_VALUE_REQUIRED', `${operation} requires an expected suggestion value.`, { assertionIndex: index }));
      for (const value of values.filter(Boolean)) if (!literalGrounded(value, element, evidence)) errors.push(issue('SUGGESTION_ASSERTION_UNGROUNDED', `${operation} uses suggestion ${JSON.stringify(value)} that is not discovered or explicitly required.`, { assertionIndex: index, elementRef: assertion.elementRef }));
    }
    if (operation === 'ASSERT_SELECTED_SUGGESTIONS_EQUALS' && element.suggestionMultiselect !== true) errors.push(issue('SUGGESTION_MULTISELECT_NOT_GROUNDED', `${operation} requires rendered aria-multiselectable=true evidence.`, { assertionIndex: index, elementRef: assertion.elementRef }));

    const compiled = planAssertions[index];
    if (compiled && op(compiled.operation) === operation) {
      if (clean(compiled.selector) !== clean(element.selector)) errors.push(issue('SUGGESTION_SELECTOR_DRIFT', `${operation} compiled selector differs from rendered discovery.`, { assertionIndex: index, elementRef: assertion.elementRef }));
      if (operation === 'ASSERT_SELECTED_SUGGESTIONS_EQUALS' && JSON.stringify(valuesOf(compiled)) !== JSON.stringify(valuesOf(assertion))) errors.push(issue('SUGGESTION_COMPILED_VALUES_DRIFT', `${operation} values changed or reordered during canonical compilation.`, { assertionIndex: index }));
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

module.exports = { VERSION, validateSuggestionCapabilityContract, literalGrounded, suggestionLiterals };

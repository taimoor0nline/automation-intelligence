const base = require('./canonicalTestIrV3Base');

const EXTRA_ACTIONS = new Set([
  'SET_RANGE_VALUE','SET_COLOR_VALUE','DROP_FILE','SELECT_FILES','DROP_FILES','SELECT_MULTIPLE',
  'OPEN_COMBOBOX','CLOSE_COMBOBOX','SEARCH_SUGGESTIONS','CLEAR_SUGGESTION_SEARCH','SELECT_SUGGESTION','SELECT_SUGGESTIONS',
]);

function hasValidLoginHelper(ir = {}) {
  return (Array.isArray(ir.actions) ? ir.actions : []).some((action) =>
    String(action?.operation || '').trim().toUpperCase() === 'LOGIN_VALID'
  );
}

function loginFocusedPlannedUnit(plannedUnit = {}) {
  if (!plannedUnit || typeof plannedUnit !== 'object') return plannedUnit;
  const objective = String(plannedUnit.objective || plannedUnit.rationale || '');
  if (!/\b(login|log\s*in|sign\s*in|authentication|username|password|credential)\b/i.test(objective)) return plannedUnit;
  return { ...plannedUnit, objective: 'login authentication' };
}

function clean(value, max = 1000) { return String(value ?? '').trim().slice(0, max); }
function uniqueValues(values, max = 100) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => clean(value, 500)).filter(Boolean))].slice(0, max);
}
function fileNames(action = {}) {
  const values = Array.isArray(action.fileNames) ? action.fileNames : action.fileName ? [action.fileName] : [];
  return uniqueValues(values, 10).map((value) => clean(value, 300));
}
function registryElement(registry = {}, elementRef) {
  return (registry.elements || []).find((entry) => String(entry.elementRef || '') === String(elementRef || '')) || null;
}
function suggestionMetadata(registry = {}, elementRef) {
  const element = registryElement(registry, elementRef) || {};
  return {
    suggestionListId: element.suggestionListId || null,
    suggestionListRef: element.suggestionListRef || null,
    suggestionListSelector: element.suggestionListSelector || null,
    suggestionMultiselect: element.suggestionMultiselect === true,
  };
}

function preprocessExtendedIr(ir) {
  if (!ir || typeof ir !== 'object') return ir;
  return {
    ...ir,
    actions: (Array.isArray(ir.actions) ? ir.actions : []).map((action) => {
      const operation = String(action?.operation || '').trim().toUpperCase();
      if (!EXTRA_ACTIONS.has(operation)) return action;
      return { operation: 'SCROLL_INTO_VIEW', elementRef: action.elementRef };
    }),
  };
}

function restoreExtendedAction(original, grounded, registry) {
  const operation = String(original?.operation || '').trim().toUpperCase();
  if (!EXTRA_ACTIONS.has(operation)) return grounded;
  if (operation === 'SET_RANGE_VALUE' || operation === 'SET_COLOR_VALUE') {
    return { operation, selector: grounded.selector, elementRef: grounded.elementRef, value: clean(original.value, 120) };
  }
  if (operation === 'SELECT_MULTIPLE') {
    return { operation, selector: grounded.selector, elementRef: grounded.elementRef, values: uniqueValues(original.values, 100) };
  }
  if (operation === 'DROP_FILE') {
    const names = fileNames(original);
    return { operation, selector: grounded.selector, elementRef: grounded.elementRef, fileName: names[0] || '' };
  }
  if (operation === 'SELECT_FILES' || operation === 'DROP_FILES') {
    return { operation, selector: grounded.selector, elementRef: grounded.elementRef, fileNames: fileNames(original) };
  }

  const semantic = suggestionMetadata(registry, grounded.elementRef);
  if (operation === 'SEARCH_SUGGESTIONS') {
    return { operation, selector: grounded.selector, elementRef: grounded.elementRef, query: clean(original.query ?? original.value, 500), ...semantic };
  }
  if (operation === 'SELECT_SUGGESTION') {
    return { operation, selector: grounded.selector, elementRef: grounded.elementRef, value: clean(original.value ?? original.text, 500), ...semantic };
  }
  if (operation === 'SELECT_SUGGESTIONS') {
    return { operation, selector: grounded.selector, elementRef: grounded.elementRef, values: uniqueValues(original.values, 50), ...semantic };
  }
  return { operation, selector: grounded.selector, elementRef: grounded.elementRef, ...semantic };
}

function extendedStep(original, action) {
  const operation = String(original?.operation || '').trim().toUpperCase();
  if (operation === 'SET_RANGE_VALUE') return { action: 'Set range value', target: action.selector || '', value: action.value };
  if (operation === 'SET_COLOR_VALUE') return { action: 'Set color value', target: action.selector || '', value: action.value };
  if (operation === 'SELECT_MULTIPLE') return { action: 'Select multiple options', target: action.selector || '', value: (action.values || []).join(', ') };
  if (operation === 'DROP_FILE') return { action: 'Drop approved file on target', target: action.selector || '', value: action.fileName || null };
  if (operation === 'SELECT_FILES') return { action: 'Select approved files', target: action.selector || '', value: (action.fileNames || []).join(', ') };
  if (operation === 'DROP_FILES') return { action: 'Drop approved files on target', target: action.selector || '', value: (action.fileNames || []).join(', ') };
  if (operation === 'OPEN_COMBOBOX') return { action: 'Open searchable dropdown', target: action.selector || '', value: null };
  if (operation === 'CLOSE_COMBOBOX') return { action: 'Close searchable dropdown', target: action.selector || '', value: null };
  if (operation === 'SEARCH_SUGGESTIONS') return { action: 'Search suggestions', target: action.selector || '', value: action.query };
  if (operation === 'CLEAR_SUGGESTION_SEARCH') return { action: 'Clear suggestion search', target: action.selector || '', value: null };
  if (operation === 'SELECT_SUGGESTION') return { action: 'Select suggestion', target: action.selector || '', value: action.value };
  if (operation === 'SELECT_SUGGESTIONS') return { action: 'Select multiple suggestions', target: action.selector || '', value: (action.values || []).join(', ') };
  return null;
}

function extendedAssertionText(assertion) {
  const op = String(assertion?.operation || '').trim().toUpperCase();
  if (op === 'ASSERT_COMBOBOX_EXPANDED') return 'Searchable dropdown is expanded';
  if (op === 'ASSERT_COMBOBOX_COLLAPSED') return 'Searchable dropdown is collapsed';
  if (op === 'ASSERT_SUGGESTION_VISIBLE') return `Suggestion ${JSON.stringify(assertion.value ?? assertion.text ?? '')} is visible`;
  if (op === 'ASSERT_SUGGESTION_NOT_VISIBLE') return `Suggestion ${JSON.stringify(assertion.value ?? assertion.text ?? '')} is not visible`;
  if (op === 'ASSERT_NO_SUGGESTIONS') return 'No suggestions are available';
  if (op === 'ASSERT_SUGGESTION_SELECTED') return `Suggestion ${JSON.stringify(assertion.value ?? assertion.text ?? '')} is selected`;
  if (op === 'ASSERT_SELECTED_SUGGESTIONS_EQUALS') return `Selected suggestions equal ${JSON.stringify(assertion.values || [])}`;
  if (op === 'ASSERT_SEARCH_SUGGESTIONS_CONTAIN') return `Search suggestions contain ${JSON.stringify(assertion.value ?? assertion.text ?? '')}`;
  return null;
}

function validateCanonicalIr(ir, context = {}) {
  const adjustedContext = hasValidLoginHelper(ir)
    ? { ...context, plannedUnit: loginFocusedPlannedUnit(context.plannedUnit) }
    : context;
  const originalActions = Array.isArray(ir?.actions) ? ir.actions : [];
  const prepared = preprocessExtendedIr(ir);
  const validated = base.validateCanonicalIr(prepared, adjustedContext);
  if (!validated.ok) return validated;

  const actions = validated.plan.actions.map((action, index) => restoreExtendedAction(originalActions[index], action, context.registry || {}));
  const steps = validated.display.steps.map((step, index) => extendedStep(originalActions[index], actions[index]) || step);
  const expectedResults = validated.display.expectedResults.map((text, index) => extendedAssertionText(ir?.assertions?.[index]) || text);
  return {
    ...validated,
    canonicalIr: { ...ir, version: base.IR_VERSION },
    plan: { ...validated.plan, actions },
    display: { ...validated.display, steps, expectedResults },
  };
}

function canonicalActionCatalog() {
  return [
    ...base.canonicalActionCatalog(),
    { operation: 'SET_RANGE_VALUE', usesElementRef: true, fields: ['elementRef','value'], description: 'Set an exact value on a discovered input[type=range] using the framework-owned native value setter. Only available when the element advertises SET_RANGE_VALUE.' },
    { operation: 'SET_COLOR_VALUE', usesElementRef: true, fields: ['elementRef','value'], description: 'Set a discovered input[type=color] to an exact #RRGGBB value. Only available when the element advertises SET_COLOR_VALUE.' },
    { operation: 'SELECT_MULTIPLE', usesElementRef: true, fields: ['elementRef','values'], description: 'Select an exact array of discovered enabled option values on a native select[multiple]. Only available when the element advertises SELECT_MULTIPLE.' },
    { operation: 'DROP_FILE', usesElementRef: true, fields: ['elementRef','fileName'], description: 'Drag/drop one approved fixture onto a discovered file-drop target.' },
    { operation: 'SELECT_FILES', usesElementRef: true, fields: ['elementRef','fileNames'], description: 'Select multiple approved fixtures on a discovered input[type=file] that has multiple=true.' },
    { operation: 'DROP_FILES', usesElementRef: true, fields: ['elementRef','fileNames'], description: 'Drag/drop multiple approved fixtures onto a discovered file-drop target.' },
    { operation: 'OPEN_COMBOBOX', usesElementRef: true, fields: ['elementRef'], description: 'Open a discovered semantic searchable dropdown/combobox using its real rendered control.' },
    { operation: 'CLOSE_COMBOBOX', usesElementRef: true, fields: ['elementRef'], description: 'Close a discovered semantic searchable dropdown/combobox using Escape when expanded.' },
    { operation: 'SEARCH_SUGGESTIONS', usesElementRef: true, fields: ['elementRef','query'], description: 'Type an evidenced query into a discovered search/autocomplete control to obtain suggestions.' },
    { operation: 'CLEAR_SUGGESTION_SEARCH', usesElementRef: true, fields: ['elementRef'], description: 'Clear the query from a discovered search/autocomplete control.' },
    { operation: 'SELECT_SUGGESTION', usesElementRef: true, fields: ['elementRef','value'], description: 'Select one evidenced option from the semantic listbox associated with a discovered searchable control.' },
    { operation: 'SELECT_SUGGESTIONS', usesElementRef: true, fields: ['elementRef','values'], description: 'Select multiple evidenced options from a searchable semantic listbox only when aria-multiselectable=true was discovered.' },
  ];
}

module.exports = {
  ...base,
  validateCanonicalIr,
  canonicalActionCatalog,
  hasValidLoginHelper,
  EXTRA_ACTIONS,
};

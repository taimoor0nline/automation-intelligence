const base = require('./canonicalTestIrV3Base');

const EXTRA_ACTIONS = new Set(['SET_RANGE_VALUE','DROP_FILE','SELECT_FILES','DROP_FILES']);

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
function fileNames(action = {}) {
  const values = Array.isArray(action.fileNames) ? action.fileNames : action.fileName ? [action.fileName] : [];
  return [...new Set(values.map((value) => clean(value, 300)).filter(Boolean))].slice(0, 10);
}

function preprocessExtendedIr(ir) {
  if (!ir || typeof ir !== 'object') return ir;
  return {
    ...ir,
    actions: (Array.isArray(ir.actions) ? ir.actions : []).map((action) => {
      const operation = String(action?.operation || '').trim().toUpperCase();
      if (!EXTRA_ACTIONS.has(operation)) return action;
      // Reuse the base elementRef grounding path without pretending that the
      // resulting browser command is SCROLL_INTO_VIEW. The exact operation is
      // restored after deterministic element resolution below.
      return { operation: 'SCROLL_INTO_VIEW', elementRef: action.elementRef };
    }),
  };
}

function restoreExtendedAction(original, grounded) {
  const operation = String(original?.operation || '').trim().toUpperCase();
  if (!EXTRA_ACTIONS.has(operation)) return grounded;
  if (operation === 'SET_RANGE_VALUE') {
    return { operation, selector: grounded.selector, elementRef: grounded.elementRef, value: clean(original.value, 120) };
  }
  const names = fileNames(original);
  if (operation === 'DROP_FILE') {
    return { operation, selector: grounded.selector, elementRef: grounded.elementRef, fileName: names[0] || '' };
  }
  return { operation, selector: grounded.selector, elementRef: grounded.elementRef, fileNames: names };
}

function extendedStep(original, action) {
  const operation = String(original?.operation || '').trim().toUpperCase();
  if (operation === 'SET_RANGE_VALUE') return { action: 'Set range value', target: action.selector || '', value: action.value };
  if (operation === 'DROP_FILE') return { action: 'Drop approved file on target', target: action.selector || '', value: action.fileName || null };
  if (operation === 'SELECT_FILES') return { action: 'Select approved files', target: action.selector || '', value: (action.fileNames || []).join(', ') };
  if (operation === 'DROP_FILES') return { action: 'Drop approved files on target', target: action.selector || '', value: (action.fileNames || []).join(', ') };
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

  const actions = validated.plan.actions.map((action, index) => restoreExtendedAction(originalActions[index], action));
  const steps = validated.display.steps.map((step, index) => extendedStep(originalActions[index], actions[index]) || step);
  return {
    ...validated,
    canonicalIr: { ...ir, version: base.IR_VERSION },
    plan: { ...validated.plan, actions },
    display: { ...validated.display, steps },
  };
}

function canonicalActionCatalog() {
  return [
    ...base.canonicalActionCatalog(),
    {
      operation: 'SET_RANGE_VALUE', usesElementRef: true, fields: ['elementRef','value'],
      description: 'Set an exact value on a discovered input[type=range] using the framework-owned standards-compliant range interaction. Only available when the element advertises SET_RANGE_VALUE.',
    },
    {
      operation: 'DROP_FILE', usesElementRef: true, fields: ['elementRef','fileName'],
      description: 'Drag/drop one approved fixture onto a discovered file-drop target. fileName must exist in runtimeCapabilities.FILE_UPLOAD.fixtures.',
    },
    {
      operation: 'SELECT_FILES', usesElementRef: true, fields: ['elementRef','fileNames'],
      description: 'Select multiple approved fixtures on a discovered input[type=file] that has multiple=true. fileNames must come from runtimeCapabilities.FILE_UPLOAD.fixtures.',
    },
    {
      operation: 'DROP_FILES', usesElementRef: true, fields: ['elementRef','fileNames'],
      description: 'Drag/drop multiple approved fixtures onto a discovered file-drop target. fileNames must come from runtimeCapabilities.FILE_UPLOAD.fixtures.',
    },
  ];
}

module.exports = {
  ...base,
  validateCanonicalIr,
  canonicalActionCatalog,
  hasValidLoginHelper,
  EXTRA_ACTIONS,
};

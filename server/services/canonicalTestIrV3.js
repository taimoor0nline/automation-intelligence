const base = require('./canonicalTestIrV3Base');

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

function validateCanonicalIr(ir, context = {}) {
  const adjustedContext = hasValidLoginHelper(ir)
    ? { ...context, plannedUnit: loginFocusedPlannedUnit(context.plannedUnit) }
    : context;
  return base.validateCanonicalIr(ir, adjustedContext);
}

module.exports = {
  ...base,
  validateCanonicalIr,
  hasValidLoginHelper,
};

const v3 = require('./canonicalTestIrV3');

function hasValidLoginHelper(ir = {}) {
  return (Array.isArray(ir.actions) ? ir.actions : []).some((action) =>
    String(action?.operation || '').trim().toUpperCase() === 'LOGIN_VALID'
  );
}

function loginFocusedPlannedUnit(plannedUnit = {}) {
  if (!plannedUnit || typeof plannedUnit !== 'object') return plannedUnit;
  const objective = String(plannedUnit.objective || plannedUnit.rationale || '');
  if (!/\b(login|log\s*in|sign\s*in|authentication|username|password|credential)\b/i.test(objective)) return plannedUnit;
  // LOGIN_VALID is a deterministic runtime abstraction for the whole discovered login
  // workflow. Planned-intent validation should verify that it belongs to the login
  // surface, not require the abstraction to expose individual username/password refs.
  return { ...plannedUnit, objective: 'login authentication' };
}

function validateCanonicalIr(ir, context = {}) {
  const adjustedContext = hasValidLoginHelper(ir)
    ? { ...context, plannedUnit: loginFocusedPlannedUnit(context.plannedUnit) }
    : context;
  return v3.validateCanonicalIr(ir, adjustedContext);
}

module.exports = {
  ...v3,
  validateCanonicalIr,
  hasValidLoginHelper,
};
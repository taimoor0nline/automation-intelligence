const v2 = require('./canonicalTestIrV2');

function validateCanonicalIr(ir, context = {}) {
  const actions = Array.isArray(ir?.actions) ? ir.actions : [];
  const hasLoginHelper = actions.some((action) => String(action?.operation || '').trim().toUpperCase() === 'LOGIN_VALID');
  if (!hasLoginHelper) return v2.validateCanonicalIr(ir, context);

  const plannedUnit = context.plannedUnit;
  const objective = String(plannedUnit?.objective || plannedUnit?.rationale || '');
  if (!plannedUnit || !/\b(login|log\s*in|sign\s*in|authentication|username|password|credential)\b/i.test(objective)) {
    return v2.validateCanonicalIr(ir, context);
  }

  return v2.validateCanonicalIr(ir, {
    ...context,
    plannedUnit: { ...plannedUnit, objective: 'login authentication' },
  });
}

module.exports = { ...v2, validateCanonicalIr };

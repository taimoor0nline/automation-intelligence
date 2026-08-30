const base = require('./canonicalTestIr');

const RUNTIME_CREDENTIAL_OPERATION = 'TYPE_RUNTIME_CREDENTIAL';
const SENTINEL_PREFIX = '__TESTNEXUS_RUNTIME_CREDENTIAL__:';

function normalizeCredential(value) {
  const credential = String(value || '').trim().toLowerCase();
  return ['username','password'].includes(credential) ? credential : '';
}

function loginEvidenceRef(registry = {}) {
  const elements = Array.isArray(registry.elements) ? registry.elements : [];
  const score = (element) => {
    const source = [element.elementRef, element.testId, element.id, element.name, element.label, element.text, element.ariaLabel]
      .filter(Boolean).join(' ').toLowerCase();
    if (/login[- ]?button|sign\s*in|log\s*in/.test(source)) return 4;
    if (/username|user[- ]?name/.test(source)) return 3;
    if (/password/.test(source)) return 2;
    return 0;
  };
  return [...elements]
    .map((element) => ({ element, score: score(element) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.element?.elementRef || null;
}

function preprocessIr(ir, context = {}) {
  if (!ir || typeof ir !== 'object') return ir;
  const loginRef = loginEvidenceRef(context.registry);
  return {
    ...ir,
    actions: (Array.isArray(ir.actions) ? ir.actions : []).map((action) => {
      const operation = String(action?.operation || '').trim().toUpperCase();
      if (operation === RUNTIME_CREDENTIAL_OPERATION) {
        const credential = normalizeCredential(action.credential);
        return {
          operation: 'TYPE',
          elementRef: action.elementRef,
          value: `${SENTINEL_PREFIX}${credential}`,
        };
      }
      // LOGIN_VALID remains a single execution helper, but carry one discovered
      // login-control ref through validation so planned-intent drift checks have
      // deterministic evidence that the helper belongs to the login surface.
      if (operation === 'LOGIN_VALID' && loginRef && !action.elementRef) {
        return { ...action, elementRef: loginRef };
      }
      return action;
    }),
  };
}

function validateCanonicalIr(ir, context = {}) {
  const originalActions = Array.isArray(ir?.actions) ? ir.actions : [];
  const runtimeActions = originalActions.filter((action) => String(action?.operation || '').trim().toUpperCase() === RUNTIME_CREDENTIAL_OPERATION);
  const errors = [];
  for (const action of runtimeActions) {
    const credential = normalizeCredential(action.credential);
    if (!credential) errors.push(`${RUNTIME_CREDENTIAL_OPERATION} requires credential username|password.`);
  }
  if (runtimeActions.length && !context.hasCredentials) errors.push('Canonical IR requires configured runtime login credentials.');
  if (errors.length) {
    return {
      ok: false,
      reasonCode: errors.some((item) => /credentials/i.test(item)) ? 'MISSING_CREDENTIALS' : 'CANONICAL_IR_INVALID',
      reason: errors[0],
      errors,
    };
  }

  const processed = preprocessIr(ir, context);
  const validated = base.validateCanonicalIr(processed, context);
  if (!validated.ok) return validated;

  const actions = validated.plan.actions.map((action, index) => {
    const original = originalActions[index];
    if (String(original?.operation || '').trim().toUpperCase() !== RUNTIME_CREDENTIAL_OPERATION) return action;
    return {
      operation: RUNTIME_CREDENTIAL_OPERATION,
      selector: action.selector,
      elementRef: action.elementRef,
      credential: normalizeCredential(original.credential),
    };
  });
  const steps = validated.display.steps.map((step, index) => {
    const original = originalActions[index];
    if (String(original?.operation || '').trim().toUpperCase() !== RUNTIME_CREDENTIAL_OPERATION) return step;
    const credential = normalizeCredential(original.credential);
    return {
      action: `Fill configured test ${credential}`,
      target: actions[index]?.selector || '',
      value: null,
    };
  });

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
    { operation: RUNTIME_CREDENTIAL_OPERATION, usesElementRef: true, fields: ['elementRef','credential'], credentialValues: ['username','password'] },
  ];
}

module.exports = {
  ...base,
  validateCanonicalIr,
  canonicalActionCatalog,
  RUNTIME_CREDENTIAL_OPERATION,
  loginEvidenceRef,
};

const base = require('./canonicalTestIr');

const RUNTIME_CREDENTIAL_OPERATION = 'TYPE_RUNTIME_CREDENTIAL';
const SENTINEL_PREFIX = '__TESTNEXUS_RUNTIME_CREDENTIAL__:';

function normalizeCredential(value) {
  const credential = String(value || '').trim().toLowerCase();
  return ['username','password'].includes(credential) ? credential : '';
}

function elementMap(registry = {}) {
  return new Map((registry.elements || []).map((element) => [String(element.elementRef || ''), element]));
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

function hasCapability(element, capability) {
  return Boolean(element && Array.isArray(element.capabilities) && element.capabilities.includes(capability));
}

function validateElementCapabilities(ir, registry = {}) {
  const errors = [];
  const byRef = elementMap(registry);
  const actionRequirements = {
    TYPE: 'TYPE',
    TYPE_RUNTIME_CREDENTIAL: 'TYPE',
    CLEAR: 'TYPE',
    SELECT: 'SELECT',
    CHECK: 'CHECK',
    UNCHECK: 'CHECK',
    CLICK: 'CLICK',
    DBLCLICK: 'CLICK',
    RIGHTCLICK: 'CLICK',
    SELECT_FILE: 'SELECT_FILE',
  };
  for (const action of ir?.actions || []) {
    const operation = String(action?.operation || '').trim().toUpperCase();
    const required = actionRequirements[operation];
    if (!required || !action.elementRef) continue;
    const element = byRef.get(String(action.elementRef));
    if (element && !hasCapability(element, required)) {
      errors.push(`${operation} is incompatible with ${action.elementRef}; discovery does not provide capability ${required}.`);
    }
  }

  const assertionRequirements = {
    ASSERT_TEXT_EQUALS: 'TEXT',
    ASSERT_TEXT_CONTAINS: 'TEXT',
    ASSERT_TEXT_NOT_CONTAINS: 'TEXT',
    ASSERT_TEXT_EMPTY: 'TEXT',
    ASSERT_TEXT_NOT_EMPTY: 'TEXT',
    ASSERT_HTML_EQUALS: 'TEXT',
    ASSERT_HTML_CONTAINS: 'TEXT',
    ASSERT_VALUE_EQUALS: 'VALUE',
    ASSERT_VALUE_CONTAINS: 'VALUE',
    ASSERT_VALUE_EMPTY: 'VALUE',
    ASSERT_VALUE_NOT_EMPTY: 'VALUE',
    ASSERT_VALUE_LENGTH_EQUALS: 'VALUE',
    ASSERT_VALUE_LENGTH_AT_MOST: 'VALUE',
    ASSERT_VALUE_LENGTH_AT_LEAST: 'VALUE',
    ASSERT_CHECKED: 'CHECK',
    ASSERT_UNCHECKED: 'CHECK',
    ASSERT_SELECTED_VALUE_EQUALS: 'SELECT',
    ASSERT_SELECTED_TEXT_EQUALS: 'SELECT',
    ASSERT_OPTION_COUNT_EQUALS: 'SELECT',
    ASSERT_REQUIRED: 'REQUIRED_STATE',
    ASSERT_OPTIONAL: 'REQUIRED_STATE',
    ASSERT_INPUT_TYPE_EQUALS: 'VALUE',
    ASSERT_MIN_EQUALS: 'VALIDITY',
    ASSERT_MAX_EQUALS: 'VALIDITY',
    ASSERT_MINLENGTH_EQUALS: 'VALIDITY',
    ASSERT_MAXLENGTH_EQUALS: 'VALIDITY',
    ASSERT_PATTERN_EQUALS: 'VALIDITY',
    ASSERT_PLACEHOLDER_EQUALS: 'VALUE',
    ASSERT_VALID: 'VALIDITY',
    ASSERT_INVALID: 'VALIDITY',
  };
  for (const assertion of ir?.assertions || []) {
    const operation = String(assertion?.operation || '').trim().toUpperCase();
    const required = assertionRequirements[operation];
    if (!required || !assertion.elementRef) continue;
    const element = byRef.get(String(assertion.elementRef));
    if (element && !hasCapability(element, required)) {
      errors.push(`${operation} is incompatible with ${assertion.elementRef}; discovery does not provide capability ${required}.`);
    }
  }
  return errors;
}

function validateNavigationEvidence(ir, registry = {}) {
  const paths = (registry.pages || []).map((page) => String(page.path || '')).filter(Boolean);
  const urls = (registry.pages || []).map((page) => String(page.url || '')).filter(Boolean);
  const errors = [];
  for (const assertion of ir?.assertions || []) {
    const operation = String(assertion?.operation || '').trim().toUpperCase();
    if (operation === 'ASSERT_PATH_INCLUDES') {
      const fragment = String(assertion.fragment ?? assertion.value ?? '').trim();
      if (!fragment || !paths.some((path) => path.includes(fragment))) errors.push(`ASSERT_PATH_INCLUDES fragment is not evidenced by discovered paths: ${fragment || '(missing)'}.`);
    }
    if (['ASSERT_URL_INCLUDES','ASSERT_URL_NOT_INCLUDES'].includes(operation)) {
      const fragment = String(assertion.fragment ?? assertion.value ?? '').trim();
      if (!fragment || ![...paths, ...urls].some((value) => value.includes(fragment))) errors.push(`${operation} fragment is not evidenced by discovered URLs/paths: ${fragment || '(missing)'}.`);
    }
  }
  return errors;
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
  const errors = [
    ...validateElementCapabilities(ir, context.registry || {}),
    ...validateNavigationEvidence(ir, context.registry || {}),
  ];
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
  validateElementCapabilities,
  validateNavigationEvidence,
};

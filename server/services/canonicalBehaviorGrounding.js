function clean(value, max = 1200) {
  return String(value ?? '').trim().slice(0, max);
}

function identity(element = {}) {
  return [
    element.elementRef,
    element.testId,
    element.id,
    element.name,
    element.label,
    element.groupName,
    element.groupLabel,
    ...(Array.isArray(element.aliases) ? element.aliases : []),
  ].filter(Boolean).join(' ').toLowerCase();
}

function isFormControl(element = {}) {
  return ['input','textarea','select'].includes(String(element.tag || '').toLowerCase());
}

function isSubmitElement(element = {}) {
  const tag = String(element.tag || '').toLowerCase();
  const type = String(element.type || '').toLowerCase();
  return (tag === 'button' && (!type || type === 'submit')) || (tag === 'input' && type === 'submit');
}

function groupKey(element = {}) {
  const type = String(element.type || '').toLowerCase();
  if (['checkbox','radio'].includes(type) && (element.groupName || element.name)) {
    return `${element.pageRef || ''}|${element.formId || ''}|group:${element.groupName || element.name}`;
  }
  return `${element.pageRef || ''}|${element.formId || ''}|element:${element.elementRef || ''}`;
}

function sameForm(control, submit) {
  if (!control || !submit || control.pageRef !== submit.pageRef) return false;
  if (submit.formId) return control.formId === submit.formId;
  if (control.formId && submit.formId !== control.formId) return false;
  return true;
}

function validationBearing(element = {}) {
  if (!isFormControl(element) || element.disabled === true) return false;
  const type = String(element.type || '').toLowerCase();
  if (['hidden','button','submit','reset','image','file'].includes(type)) return false;
  return element.required === true || Boolean(element.errorRef);
}

function actionElementRef(action = {}) {
  return clean(action.elementRef, 180);
}

function relevantInputOperation(operation) {
  return ['TYPE','TYPE_RUNTIME_CREDENTIAL','CLEAR','SELECT','CHECK','UNCHECK'].includes(String(operation || '').toUpperCase());
}

function groupSatisfied(group, actions, byRef) {
  const keys = new Set(group.map(groupKey));
  let state = null;
  for (const action of actions) {
    if (!relevantInputOperation(action.operation)) continue;
    const element = byRef.get(actionElementRef(action));
    if (!element || !keys.has(groupKey(element))) continue;
    const op = String(action.operation || '').toUpperCase();
    if (['TYPE','TYPE_RUNTIME_CREDENTIAL','SELECT','CHECK'].includes(op)) state = 'FILLED';
    if (['CLEAR','UNCHECK'].includes(op)) state = 'EMPTY';
  }
  return state === 'FILLED';
}

function boundedText(element, source) {
  const min = Math.max(0, Number(element.minlength || 0) || 0);
  const max = Math.max(0, Number(element.maxlength || 0) || 0);
  let value = clean(source || 'TestNexus valid input', 2000) || 'TestNexus valid input';
  while (value.length < min) value += 'x';
  if (max && value.length > max) value = value.slice(0, max);
  if (!value && min > 0) value = 'x'.repeat(Math.min(min, max || min));
  return value;
}

function safeActionFor(element, contextElements = []) {
  const type = String(element.type || '').toLowerCase();
  const tag = String(element.tag || '').toLowerCase();
  const text = identity(element);
  const loginForm = contextElements.some((item) => String(item.type || '').toLowerCase() === 'password');

  if (loginForm && type === 'password') {
    return { operation: 'TYPE_RUNTIME_CREDENTIAL', elementRef: element.elementRef, credential: 'password' };
  }
  if (loginForm && /\busername\b|user[- _]?name/.test(text)) {
    return { operation: 'TYPE_RUNTIME_CREDENTIAL', elementRef: element.elementRef, credential: 'username' };
  }
  if (type === 'checkbox' || type === 'radio') return { operation: 'CHECK', elementRef: element.elementRef };
  if (tag === 'select' || type === 'select') {
    const option = (element.options || []).find((item) => clean(item?.value, 300));
    return option ? { operation: 'SELECT', elementRef: element.elementRef, value: option.value } : null;
  }
  if (type === 'email') return { operation: 'TYPE', elementRef: element.elementRef, value: 'testnexus@example.com' };
  if (type === 'url') return { operation: 'TYPE', elementRef: element.elementRef, value: 'https://example.com' };
  if (type === 'number' || type === 'range') {
    const min = Number(element.min);
    const max = Number(element.max);
    let value = Number.isFinite(min) ? min : 1;
    if (Number.isFinite(max) && value > max) value = max;
    return { operation: 'TYPE', elementRef: element.elementRef, value: String(value) };
  }
  if (type === 'date') return { operation: 'TYPE', elementRef: element.elementRef, value: '2026-01-15' };
  if (type === 'datetime-local') return { operation: 'TYPE', elementRef: element.elementRef, value: '2026-01-15T10:00' };
  if (type === 'month') return { operation: 'TYPE', elementRef: element.elementRef, value: '2026-01' };
  if (type === 'time') return { operation: 'TYPE', elementRef: element.elementRef, value: '10:00' };
  if (type === 'tel') return { operation: 'TYPE', elementRef: element.elementRef, value: '5551234567' };
  if (tag === 'textarea') return { operation: 'TYPE', elementRef: element.elementRef, value: boundedText(element, 'TestNexus automated test input') };
  if (tag === 'input') return { operation: 'TYPE', elementRef: element.elementRef, value: boundedText(element, `TestNexus ${element.label || element.name || 'value'}`) };
  return null;
}

function submitElementForAction(action, byRef) {
  const element = byRef.get(actionElementRef(action));
  if (!element) return null;
  const operation = String(action.operation || '').toUpperCase();
  if (operation === 'SUBMIT') return element;
  if (operation === 'CLICK' && isSubmitElement(element)) return element;
  return null;
}

function errorAssertionRefs(assertions, byRef) {
  const refs = new Set();
  for (const assertion of assertions || []) {
    const ref = clean(assertion?.elementRef, 180);
    const element = byRef.get(ref);
    if (!element) continue;
    const signature = identity(element);
    if (element.kind === 'validation-error' || /error|validation/.test(signature)) refs.add(ref);
  }
  return refs;
}

function protectedValidationGroups(assertions, elements, byRef) {
  const assertedErrors = errorAssertionRefs(assertions, byRef);
  const protectedKeys = new Set();
  for (const element of elements) {
    if (element.errorRef && assertedErrors.has(element.errorRef)) protectedKeys.add(groupKey(element));
  }
  for (const assertion of assertions || []) {
    const operation = String(assertion?.operation || '').toUpperCase();
    if (!['ASSERT_INVALID','ASSERT_VALUE_EMPTY','ASSERT_UNCHECKED'].includes(operation)) continue;
    const element = byRef.get(clean(assertion.elementRef, 180));
    if (element) protectedKeys.add(groupKey(element));
  }
  return protectedKeys;
}

function completionActionsFor(submit, priorActions, registry, protectedKeys = new Set()) {
  const elements = Array.isArray(registry?.elements) ? registry.elements : [];
  const byRef = new Map(elements.map((item) => [item.elementRef, item]));
  const controls = elements.filter((item) => sameForm(item, submit) && validationBearing(item));
  const grouped = new Map();
  for (const control of controls) {
    const key = groupKey(control);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(control);
  }

  const additions = [];
  for (const [key, group] of grouped.entries()) {
    if (protectedKeys.has(key) || groupSatisfied(group, priorActions, byRef)) continue;
    const preferred = group.find((item) => item.disabled !== true) || group[0];
    const action = safeActionFor(preferred, controls);
    if (action) {
      additions.push(action);
      priorActions.push(action);
    }
  }
  return additions;
}

function successAssertionPresent(assertions, byRef) {
  return (assertions || []).some((assertion) => {
    const element = byRef.get(clean(assertion?.elementRef, 180));
    return element && /success|confirmation|confirmed|reference|thank/.test(identity(element));
  });
}

function explicitInteractiveTiming(text) {
  return /\bon\s+blur\b|\bwhen\s+(?:the\s+)?(?:field\s+)?loses\s+focus\b|\bas\s+(?:the\s+)?user\s+types\b|\bon\s+input\b|\bon\s+change\b|\bimmediately\b/i.test(String(text || ''));
}

function findSubmitForProtected(protectedKeys, registry) {
  const elements = Array.isArray(registry?.elements) ? registry.elements : [];
  const protectedControl = elements.find((item) => protectedKeys.has(groupKey(item)) && isFormControl(item));
  if (!protectedControl) return null;
  return elements.find((item) => isSubmitElement(item) && sameForm(protectedControl, item)) || null;
}

function normalizeBehavioralIr(ir, { registry = {}, plannedUnit = null, story = '' } = {}) {
  const elements = Array.isArray(registry?.elements) ? registry.elements : [];
  const byRef = new Map(elements.map((item) => [item.elementRef, item]));
  const actions = (Array.isArray(ir?.actions) ? ir.actions : []).map((item) => ({ ...item }));
  const assertions = (Array.isArray(ir?.assertions) ? ir.assertions : []).map((item) => ({ ...item }));
  const notes = [];
  const unresolved = [];
  const objective = clean(plannedUnit?.objective || plannedUnit?.rationale || ir?.objective, 2000);
  const timingText = `${objective} ${clean(story, 6000)}`;
  const protectedKeys = protectedValidationGroups(assertions, elements, byRef);
  const hasErrorAssertions = errorAssertionRefs(assertions, byRef).size > 0;

  let hasSubmit = actions.some((action) => Boolean(submitElementForAction(action, byRef)));
  if (hasErrorAssertions && !hasSubmit && !explicitInteractiveTiming(timingText)) {
    const submit = findSubmitForProtected(protectedKeys, registry);
    if (submit) {
      actions.push({ operation: 'CLICK', elementRef: submit.elementRef });
      hasSubmit = true;
      notes.push({
        code: 'VALIDATION_TRIGGER_SUBMIT',
        message: `Custom validation feedback was grounded to form submission instead of assuming an unproven blur/change handler.`,
        elementRef: submit.elementRef,
      });
    } else {
      unresolved.push('Custom validation feedback is asserted, but discovery provides neither an explicit interaction timing requirement nor a submit control that can deterministically trigger validation.');
    }
  }

  const positiveIntent = String(plannedUnit?.scenarioType || '').toLowerCase() === 'positive'
    || successAssertionPresent(assertions, byRef)
    || /\b(success|successful|accepts|accepted|confirmation|confirmed|minimum allowed|maximum allowed)\b/i.test(objective);

  for (let index = 0; index < actions.length; index += 1) {
    const submit = submitElementForAction(actions[index], byRef);
    if (!submit) continue;

    const shouldComplete = positiveIntent || hasErrorAssertions;
    if (!shouldComplete) continue;

    const exclusions = hasErrorAssertions && !positiveIntent ? protectedKeys : new Set();
    const priorActions = actions.slice(0, index);
    const additions = completionActionsFor(submit, priorActions, registry, exclusions);
    if (!additions.length) continue;
    actions.splice(index, 0, ...additions);
    index += additions.length;
    notes.push({
      code: positiveIntent ? 'SUCCESS_PRECONDITIONS_COMPLETED' : 'VALIDATION_PRECONDITIONS_COMPLETED',
      message: positiveIntent
        ? 'Added deterministic valid values for discovered validation-bearing controls omitted from a success-path submission.'
        : 'Added deterministic valid values for unrelated validation-bearing controls so the intended negative field is isolated.',
      addedActions: additions.map((item) => ({ ...item })),
    });
  }

  return {
    ir: {
      ...ir,
      actions,
      assertions,
      behavioralGrounding: {
        version: 1,
        status: unresolved.length ? 'UNRESOLVED' : 'GROUNDED',
        enrichments: notes,
        unresolved,
      },
    },
    enrichments: notes,
    unresolved,
  };
}

module.exports = {
  normalizeBehavioralIr,
  completionActionsFor,
  validationBearing,
  isSubmitElement,
  groupKey,
};

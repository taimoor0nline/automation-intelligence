const { ASSERTION_OPERATION_SET } = require('./assertionRegistry');

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
  // HTML-required controls are deterministic prerequisites. Custom checkbox/radio
  // groups are also treated as prerequisites when discovery links them to a group
  // validation error. An optional text/URL field can have an error container merely
  // for format validation when provided, so do not invent a value for it.
  return element.required === true || (['checkbox','radio'].includes(type) && Boolean(element.errorRef));
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

function normalizeOperationBuckets(ir = {}) {
  const rawActions = Array.isArray(ir?.actions) ? ir.actions : [];
  const rawAssertions = Array.isArray(ir?.assertions) ? ir.assertions : [];
  const actions = [];
  const relocatedAssertions = [];

  for (const item of rawActions) {
    const operation = String(item?.operation || '').trim().toUpperCase();
    if (operation && ASSERTION_OPERATION_SET.has(operation)) relocatedAssertions.push({ ...item, operation });
    else actions.push({ ...item });
  }

  return {
    actions,
    assertions: [...rawAssertions.map((item) => ({ ...item })), ...relocatedAssertions],
    relocatedAssertions,
  };
}


const LOCATION_ASSERTION_OPERATIONS = new Set([
  'ASSERT_PATH_EQUALS','ASSERT_PATH_INCLUDES','ASSERT_URL_EQUALS','ASSERT_URL_INCLUDES','ASSERT_URL_NOT_INCLUDES',
  'ASSERT_URL_CONTAINS','ASSERT_QUERY_INCLUDES','ASSERT_QUERY_PARAM_EQUALS','ASSERT_QUERY_PARAM_ABSENT',
  'ASSERT_HASH_EQUALS','ASSERT_HASH_INCLUDES','ASSERT_ORIGIN_EQUALS','ASSERT_HOST_EQUALS','ASSERT_PROTOCOL_EQUALS',
]);

function normalizeNavigationAssertionShapes(assertions = []) {
  const normalized = [];
  const changes = [];
  for (const source of assertions || []) {
    const assertion = { ...source };
    const operation = String(assertion.operation || '').trim().toUpperCase();
    const path = clean(assertion.path, 1200);
    const url = clean(assertion.url ?? assertion.value, 1500);
    if (operation === 'ASSERT_URL_EQUALS' && !url && path.startsWith('/')) {
      delete assertion.url;
      delete assertion.value;
      assertion.operation = 'ASSERT_PATH_EQUALS';
      assertion.path = path;
      changes.push({
        from: 'ASSERT_URL_EQUALS',
        to: 'ASSERT_PATH_EQUALS',
        path,
      });
    }
    normalized.push(assertion);
  }
  return { assertions: normalized, changes };
}

function locationRequirementIsExplicit(text, expectedPath) {
  const requirement = String(text || '').toLowerCase();
  const expected = clean(expectedPath, 1200).toLowerCase();
  if (!expected) return false;
  if (requirement.includes(expected)) return true;
  const leaf = expected.split('/').filter(Boolean).pop();
  if (!leaf) return false;
  const readable = leaf.replace(/[-_]+/g, '[\\s_-]*');
  return new RegExp(`\\b(?:stay|stays|remain|remains|keep|keeps|still)\\b[^.\\n]{0,80}\\b${readable}\\b`, 'i').test(requirement);
}

function validationOutcomeAssertion(assertion = {}, byRef = new Map()) {
  const operation = String(assertion.operation || '').trim().toUpperCase();
  if (['ASSERT_INVALID','ASSERT_VALID','ASSERT_REQUIRED','ASSERT_VALUE_EMPTY','ASSERT_VALUE_NOT_EMPTY'].includes(operation)) return true;
  const element = byRef.get(clean(assertion.elementRef, 180));
  if (!element) return false;
  const signature = identity(element);
  return element.kind === 'validation-error' || /error|validation|required/.test(signature);
}

function removeRedundantUngroundedLocationAssertions(assertions = [], actions = [], byRef = new Map(), {
  plannedUnit = null,
  story = '',
  objective = '',
} = {}) {
  const scenario = String(plannedUnit?.scenarioType || '').toLowerCase();
  const negativeIntent = scenario === 'negative' || /\\b(?:invalid|empty|missing|required|reject|rejected|validation|negative)\\b/i.test(String(objective || ''));
  if (!negativeIntent) return { assertions, removed: [] };

  let currentPath = null;
  let submitSeen = false;
  for (const action of actions || []) {
    const operation = String(action?.operation || '').trim().toUpperCase();
    if (operation === 'NAVIGATE') {
      const candidate = clean(action.path ?? action.value, 1200);
      if (candidate.startsWith('/')) currentPath = candidate.split('?')[0] || '/';
      continue;
    }
    if (submitElementForAction(action, byRef)) submitSeen = true;
  }
  if (!submitSeen || !currentPath) return { assertions, removed: [] };

  const nonLocation = (assertions || []).filter((assertion) => !LOCATION_ASSERTION_OPERATIONS.has(String(assertion?.operation || '').trim().toUpperCase()));
  if (!nonLocation.length || !nonLocation.some((assertion) => validationOutcomeAssertion(assertion, byRef))) {
    return { assertions, removed: [] };
  }

  const requirementText = `${clean(story, 6000)} ${clean(objective, 2000)}`;
  const removed = [];
  const kept = [];
  for (const assertion of assertions || []) {
    const operation = String(assertion?.operation || '').trim().toUpperCase();
    const expectedPath = operation === 'ASSERT_PATH_EQUALS' ? clean(assertion.path ?? assertion.value, 1200).split('?')[0] : '';
    if (expectedPath === currentPath && !locationRequirementIsExplicit(requirementText, expectedPath)) {
      removed.push({ ...assertion });
      continue;
    }
    kept.push(assertion);
  }
  return { assertions: kept, removed };
}

function normalizeBehavioralIr(ir, { registry = {}, plannedUnit = null, story = '' } = {}) {
  const elements = Array.isArray(registry?.elements) ? registry.elements : [];
  const byRef = new Map(elements.map((item) => [item.elementRef, item]));
  const buckets = normalizeOperationBuckets(ir);
  const actions = buckets.actions;
  let assertions = buckets.assertions;
  const notes = [];
  const unresolved = [];
  const objective = clean(plannedUnit?.objective || plannedUnit?.rationale || ir?.objective, 2000);
  const timingText = `${objective} ${clean(story, 6000)}`;

  const shapeNormalization = normalizeNavigationAssertionShapes(assertions);
  assertions = shapeNormalization.assertions;
  if (shapeNormalization.changes.length) {
    notes.push({
      code: 'NAVIGATION_ASSERTION_SHAPE_NORMALIZED',
      message: 'A navigation assertion used a path field with URL-equality semantics. TestNexus normalized it to the matching path assertion before strict validation.',
      changes: shapeNormalization.changes,
    });
  }

  if (buckets.relocatedAssertions.length) {
    notes.push({
      code: 'MISPLACED_ASSERTION_RELOCATED',
      message: 'A recognized assertion operation was returned in the action list. TestNexus moved it into the final assertion phase before strict canonical validation.',
      operations: buckets.relocatedAssertions.map((item) => String(item.operation || '')),
    });
  }

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
        message: 'Custom validation feedback was grounded to form submission instead of assuming an unproven blur/change handler.',
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
    if (!positiveIntent && !hasErrorAssertions) continue;

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

  const locationNormalization = removeRedundantUngroundedLocationAssertions(assertions, actions, byRef, {
    plannedUnit,
    story,
    objective,
  });
  assertions = locationNormalization.assertions;
  if (locationNormalization.removed.length) {
    notes.push({
      code: 'REDUNDANT_UNGROUNDED_LOCATION_ASSERTION_REMOVED',
      message: 'Removed a same-page location assertion after negative form submission because the user-authored requirement did not require that location and another grounded validation assertion already proves the intended behavior.',
      removedAssertions: locationNormalization.removed,
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
  normalizeOperationBuckets,
  completionActionsFor,
  validationBearing,
  isSubmitElement,
  groupKey,
  normalizeNavigationAssertionShapes,
  removeRedundantUngroundedLocationAssertions,
  locationRequirementIsExplicit,
};

const { ASSERTION_OPERATION_SET, ASSERTION_REGISTRY } = require('./assertionRegistry');
const { registryIndex } = require('./canonicalElementRegistry');

const IR_VERSION = 1;
const ACTION_OPERATIONS = Object.freeze([
  'LOGIN_VALID', 'NAVIGATE', 'RELOAD', 'GO_BACK', 'GO_FORWARD', 'SET_VIEWPORT',
  'TYPE', 'CLEAR', 'CLICK', 'DBLCLICK', 'RIGHTCLICK', 'HOVER', 'FOCUS', 'BLUR',
  'SELECT', 'CHECK', 'UNCHECK', 'SUBMIT', 'SCROLL_INTO_VIEW', 'PRESS_KEY',
  'SELECT_FILE', 'DRAG_DROP', 'SET_PERMISSION_STATE', 'EXTERNAL_ADAPTER_ACTION',
]);
const ACTION_OPERATION_SET = new Set(ACTION_OPERATIONS);
const ELEMENT_ACTIONS = new Set(['TYPE','CLEAR','CLICK','DBLCLICK','RIGHTCLICK','HOVER','FOCUS','BLUR','SELECT','CHECK','UNCHECK','SUBMIT','SCROLL_INTO_VIEW','PRESS_KEY','SELECT_FILE']);
const TEXT_ASSERTIONS = new Set(['ASSERT_TEXT_EQUALS','ASSERT_TEXT_CONTAINS','ASSERT_TEXT_NOT_CONTAINS']);
const STOP_WORDS = new Set(['the','and','for','with','when','then','from','into','that','this','should','must','user','case','test','verify','valid','invalid','required','field','fields','form','page','submission','submit','value','values','input','empty','missing','proper','format','fails','fail','rejected','reject','accepted','accept','behavior','behaviour','expected','using','only','below','above','minimum','maximum','boundary','successful','successfully']);

function clean(value, max = 1200) { return String(value ?? '').trim().slice(0, max); }
function token(value) { return clean(value, 300).replace(/[^A-Za-z0-9]+/g, '').toLowerCase(); }
function quote(value) { return JSON.stringify(String(value ?? '')); }

function resolveElement(elementRef, index, errors, label) {
  const ref = clean(elementRef, 180);
  if (!ref) {
    errors.push(`${label} requires elementRef.`);
    return null;
  }
  const element = index.byRef.get(ref);
  if (!element) {
    errors.push(`${label} references unknown elementRef ${ref}.`);
    return null;
  }
  return element;
}

function knownPath(path, index) {
  const value = clean(path, 1200);
  if (!value) return false;
  if (index.paths.has(value)) return true;
  const pathname = value.split('?')[0];
  return index.paths.has(pathname);
}

function normalizeSelectValue(value, element) {
  const source = clean(value, 500);
  const options = Array.isArray(element?.options) ? element.options : [];
  if (!options.length) return source;
  const exact = options.find((option) => option.value === source);
  if (exact) return exact.value;
  const insensitive = options.find((option) => String(option.value).toLowerCase() === source.toLowerCase() || String(option.text).toLowerCase() === source.toLowerCase());
  return insensitive ? insensitive.value : null;
}

function visibleTextEvidence(element = {}) {
  return [element.text, element.label, element.ariaLabel, element.placeholder]
    .map((value) => clean(value, 800))
    .filter(Boolean);
}

function textGrounded(text, element, story) {
  const expected = clean(text, 800);
  if (!expected) return false;
  const lower = expected.toLowerCase();
  if (visibleTextEvidence(element).some((candidate) => candidate.toLowerCase().includes(lower) || lower.includes(candidate.toLowerCase()))) return true;
  return clean(story, 10000).toLowerCase().includes(lower);
}

function identityTextConflict(text, element = {}) {
  const expected = token(text);
  if (!expected) return false;
  const identities = [element.elementRef, element.selector, element.testId, element.id, element.name]
    .map(token).filter(Boolean);
  if (!identities.includes(expected)) return false;
  return !visibleTextEvidence(element).some((candidate) => clean(candidate).toLowerCase() === clean(text).toLowerCase());
}

function normalizeAction(raw, index, errors) {
  const action = raw && typeof raw === 'object' ? raw : {};
  const operation = clean(action.operation, 80).toUpperCase();
  if (!ACTION_OPERATION_SET.has(operation)) {
    errors.push(`Unsupported canonical action ${operation || '(missing)'}.`);
    return null;
  }
  if (Object.prototype.hasOwnProperty.call(action, 'selector')) errors.push(`${operation} must use elementRef, not selector.`);

  if (ELEMENT_ACTIONS.has(operation)) {
    const element = resolveElement(action.elementRef, index, errors, operation);
    if (!element) return null;
    const out = { operation, selector: element.selector, elementRef: element.elementRef };
    if (operation === 'TYPE') {
      const value = action.value == null ? '' : String(action.value);
      if (!value) errors.push(`TYPE ${element.elementRef} requires a non-empty value; use CLEAR for an empty field.`);
      out.value = value;
    }
    if (operation === 'SELECT') {
      const value = normalizeSelectValue(action.value, element);
      if (value == null) errors.push(`SELECT ${element.elementRef} uses an option not present in discovery: ${clean(action.value)}.`);
      else out.value = value;
    }
    if (operation === 'PRESS_KEY') {
      const key = clean(action.key || action.value, 40).toLowerCase();
      const allowed = new Set(['enter','esc','escape','uparrow','downarrow','leftarrow','rightarrow','home','end','backspace','del','delete']);
      if (!allowed.has(key)) errors.push(`PRESS_KEY ${element.elementRef} has unsupported key ${key || '(missing)'}.`);
      out.key = key;
    }
    if (operation === 'SELECT_FILE') out.fileName = clean(action.fileName || action.value, 300);
    return out;
  }

  if (operation === 'NAVIGATE') {
    const path = clean(action.path || action.value, 1200);
    if (!knownPath(path, index)) errors.push(`NAVIGATE path is not present in the canonical page registry: ${path || '(missing)'}.`);
    return { operation, path };
  }
  if (operation === 'SET_VIEWPORT') {
    const width = Number(action.width);
    const height = Number(action.height);
    if (!Number.isFinite(width) || !Number.isFinite(height)) errors.push('SET_VIEWPORT requires numeric width and height.');
    return { operation, width, height };
  }
  if (operation === 'DRAG_DROP') {
    const source = resolveElement(action.sourceElementRef, index, errors, 'DRAG_DROP source');
    const target = resolveElement(action.targetElementRef, index, errors, 'DRAG_DROP target');
    return source && target ? { operation, sourceSelector: source.selector, targetSelector: target.selector, sourceElementRef: source.elementRef, targetElementRef: target.elementRef } : null;
  }
  if (operation === 'SET_PERMISSION_STATE') {
    const permission = clean(action.permission, 80).toLowerCase();
    const state = clean(action.state, 30).toLowerCase();
    if (!permission || !['granted','denied','prompt'].includes(state)) errors.push('SET_PERMISSION_STATE requires permission and granted|denied|prompt state.');
    return { operation, permission, state };
  }
  if (operation === 'EXTERNAL_ADAPTER_ACTION') {
    const capability = clean(action.capability, 100).toUpperCase();
    const adapterAction = clean(action.action, 200);
    if (!capability || !adapterAction) errors.push('EXTERNAL_ADAPTER_ACTION requires capability and action.');
    return { operation, capability, action: adapterAction, payload: action.payload && typeof action.payload === 'object' ? action.payload : {} };
  }
  return { operation };
}

function assertionNeedsElement(operation) {
  const category = ASSERTION_REGISTRY?.[operation]?.category;
  return ['element','text','form','attribute','collection'].includes(category);
}

function normalizeAssertion(raw, index, errors, story) {
  const assertion = raw && typeof raw === 'object' ? raw : {};
  const operation = clean(assertion.operation, 100).toUpperCase();
  if (!ASSERTION_OPERATION_SET.has(operation)) {
    errors.push(`Unsupported canonical assertion ${operation || '(missing)'}.`);
    return null;
  }
  if (Object.prototype.hasOwnProperty.call(assertion, 'selector')) errors.push(`${operation} must use elementRef, not selector.`);
  const out = { ...assertion, operation };
  delete out.selector;

  let element = null;
  if (assertionNeedsElement(operation) || (operation === 'ASSERT_VISUAL_MATCH' && assertion.elementRef)) {
    element = resolveElement(assertion.elementRef, index, errors, operation);
    if (!element) return null;
    out.selector = element.selector;
    out.elementRef = element.elementRef;
  }

  if (TEXT_ASSERTIONS.has(operation)) {
    out.text = clean(assertion.text ?? assertion.value, 1200);
    if (!out.text) errors.push(`${operation} requires text.`);
    else if (identityTextConflict(out.text, element)) errors.push(`${operation} cannot use element identity ${quote(out.text)} as display text for ${element.elementRef}.`);
    else if (!textGrounded(out.text, element, story)) errors.push(`${operation} text is not grounded by discovery or the business story: ${quote(out.text)}.`);
  }

  if (operation === 'ASSERT_HTML_EQUALS' || operation === 'ASSERT_HTML_CONTAINS') out.html = clean(assertion.html ?? assertion.value, 4000);
  if (['ASSERT_VALUE_EQUALS','ASSERT_VALUE_CONTAINS','ASSERT_SELECTED_VALUE_EQUALS','ASSERT_INPUT_TYPE_EQUALS','ASSERT_MIN_EQUALS','ASSERT_MAX_EQUALS','ASSERT_MINLENGTH_EQUALS','ASSERT_MAXLENGTH_EQUALS','ASSERT_PATTERN_EQUALS','ASSERT_PLACEHOLDER_EQUALS'].includes(operation)) out.value = clean(assertion.value, 1500);
  if (operation === 'ASSERT_SELECTED_VALUE_EQUALS' && element) {
    const normalized = normalizeSelectValue(out.value, element);
    if (normalized == null) errors.push(`${operation} uses an option not present in discovery for ${element.elementRef}: ${out.value}.`);
    else out.value = normalized;
  }
  if (operation === 'ASSERT_SELECTED_TEXT_EQUALS') out.text = clean(assertion.text ?? assertion.value, 1500);
  if (['ASSERT_VALUE_LENGTH_EQUALS','ASSERT_VALUE_LENGTH_AT_MOST','ASSERT_VALUE_LENGTH_AT_LEAST'].includes(operation)) out.length = Number(assertion.length ?? assertion.value);
  if (operation.startsWith('ASSERT_ELEMENT_WIDTH_') || operation.startsWith('ASSERT_ELEMENT_HEIGHT_')) out.pixels = Number(assertion.pixels ?? assertion.value);
  if (['ASSERT_OPTION_COUNT_EQUALS','ASSERT_COUNT_EQUALS','ASSERT_COUNT_AT_LEAST','ASSERT_COUNT_AT_MOST','ASSERT_REQUEST_COUNT_EQUALS','ASSERT_WINDOW_OPEN_COUNT_EQUALS','ASSERT_RESOURCE_COUNT_AT_MOST','ASSERT_DATABASE_ROW_COUNT_EQUALS'].includes(operation)) out.count = Number(assertion.count ?? assertion.value);

  if (['ASSERT_ATTR_EXISTS','ASSERT_ATTR_NOT_EXISTS','ASSERT_ATTR_EQUALS','ASSERT_ATTR_CONTAINS','ASSERT_PROP_EQUALS','ASSERT_CSS_EQUALS','ASSERT_ARIA_EQUALS'].includes(operation)) out.name = clean(assertion.name, 300);
  if (['ASSERT_ATTR_EQUALS','ASSERT_ATTR_CONTAINS','ASSERT_PROP_EQUALS','ASSERT_CSS_EQUALS','ASSERT_ARIA_EQUALS'].includes(operation)) out.value = clean(assertion.value, 1500);
  if (['ASSERT_CLASS_INCLUDES','ASSERT_CLASS_NOT_INCLUDES'].includes(operation)) out.className = clean(assertion.className ?? assertion.value, 300);

  if (operation === 'ASSERT_URL_EQUALS') out.url = clean(assertion.url ?? assertion.value, 1500);
  if (['ASSERT_URL_INCLUDES','ASSERT_URL_NOT_INCLUDES','ASSERT_URL_CONTAINS','ASSERT_PATH_INCLUDES','ASSERT_QUERY_INCLUDES'].includes(operation)) out.fragment = clean(assertion.fragment ?? assertion.path ?? assertion.value, 1200);
  if (operation === 'ASSERT_PATH_EQUALS') {
    out.path = clean(assertion.path ?? assertion.value, 1200);
    if (!knownPath(out.path, index)) errors.push(`ASSERT_PATH_EQUALS path is not present in the canonical page registry: ${out.path || '(missing)'}.`);
  }
  if (operation === 'ASSERT_QUERY_PARAM_EQUALS' || operation === 'ASSERT_QUERY_PARAM_ABSENT') out.name = clean(assertion.name, 300);
  if (operation === 'ASSERT_QUERY_PARAM_EQUALS') out.value = clean(assertion.value, 1000);
  if (operation === 'ASSERT_HASH_EQUALS' || operation === 'ASSERT_HASH_INCLUDES') out.hash = clean(assertion.hash ?? assertion.value, 1000);
  if (['ASSERT_ORIGIN_EQUALS','ASSERT_HOST_EQUALS','ASSERT_PROTOCOL_EQUALS','ASSERT_DOCUMENT_LANG_EQUALS'].includes(operation)) out.value = clean(assertion.value, 1000);
  if (['ASSERT_TITLE_EQUALS','ASSERT_TITLE_INCLUDES'].includes(operation)) out.text = clean(assertion.text ?? assertion.value, 1200);

  if (['ASSERT_COOKIE_EXISTS','ASSERT_COOKIE_EQUALS','ASSERT_COOKIE_ABSENT','ASSERT_LOCAL_STORAGE_EXISTS','ASSERT_LOCAL_STORAGE_EQUALS','ASSERT_LOCAL_STORAGE_ABSENT','ASSERT_SESSION_STORAGE_EXISTS','ASSERT_SESSION_STORAGE_EQUALS','ASSERT_SESSION_STORAGE_ABSENT'].includes(operation)) out.key = clean(assertion.key ?? assertion.name, 500);
  if (['ASSERT_COOKIE_EQUALS','ASSERT_LOCAL_STORAGE_EQUALS','ASSERT_SESSION_STORAGE_EQUALS'].includes(operation)) out.value = clean(assertion.value, 1500);

  if (operation.startsWith('ASSERT_REQUEST_') || operation.startsWith('ASSERT_RESPONSE_')) {
    out.urlFragment = clean(assertion.urlFragment ?? assertion.value, 1200);
    if (assertion.method) out.method = clean(assertion.method, 20).toUpperCase();
    if (assertion.name) out.name = clean(assertion.name, 300);
    if (assertion.value != null) out.value = clean(assertion.value, 2000);
    if (assertion.status != null) out.status = Number(assertion.status);
  }

  if (operation === 'ASSERT_VISUAL_MATCH') {
    out.selector = element?.selector || 'body';
    out.baselineName = clean(assertion.baselineName, 300);
    out.threshold = Number(assertion.threshold ?? 0.1);
    out.maxDiffRatio = Number(assertion.maxDiffRatio ?? 0);
  }
  if (operation === 'ASSERT_WEB_VITAL_AT_MOST') {
    out.metric = clean(assertion.metric, 20).toUpperCase();
    out.max = Number(assertion.max);
  }
  if (operation === 'ASSERT_EXTERNAL_MESSAGE_RECEIVED') {
    out.channel = clean(assertion.channel, 20).toUpperCase();
    out.contains = clean(assertion.contains ?? assertion.value, 1500);
    out.description = clean(assertion.description, 1500);
  }
  if (operation === 'ASSERT_DATABASE_VALUE_EQUALS') {
    out.queryName = clean(assertion.queryName, 300);
    out.field = clean(assertion.field, 300);
    out.value = clean(assertion.value, 1500);
    out.params = Array.isArray(assertion.params) ? assertion.params : [];
  }
  if (operation === 'ASSERT_DATABASE_ROW_COUNT_EQUALS') {
    out.queryName = clean(assertion.queryName, 300);
    out.params = Array.isArray(assertion.params) ? assertion.params : [];
  }
  if (operation === 'ASSERT_STREAM_MESSAGE_CONTAINS') {
    out.transport = clean(assertion.transport, 30).toUpperCase();
    out.urlFragment = clean(assertion.urlFragment, 1200);
    out.value = clean(assertion.value, 1500);
  }
  if (['ASSERT_CLIPBOARD_EQUALS','ASSERT_CLIPBOARD_CONTAINS'].includes(operation)) out.value = clean(assertion.value, 1500);
  if (operation === 'ASSERT_DOWNLOADED_DOCUMENT_CONTAINS') {
    out.fileName = clean(assertion.fileName, 300);
    out.value = clean(assertion.value, 1500);
  }
  if (operation === 'ASSERT_BROWSER_PERMISSION_EQUALS') {
    out.permission = clean(assertion.permission, 80).toLowerCase();
    out.state = clean(assertion.state, 30).toLowerCase();
  }
  if (operation === 'ASSERT_EXTERNAL_ADAPTER') {
    out.capability = clean(assertion.capability, 100).toUpperCase();
    out.payload = assertion.payload && typeof assertion.payload === 'object' ? assertion.payload : {};
    out.description = clean(assertion.description, 1500);
  }

  return out;
}

function conceptTokens(text) {
  return [...new Set(clean(text, 3000).toLowerCase().split(/[^a-z0-9]+/).filter((part) => part.length >= 3 && !STOP_WORDS.has(part)))];
}

function elementConceptTokens(element = {}) {
  return new Set(conceptTokens([element.elementRef, element.testId, element.id, element.name, element.label, element.ariaLabel, element.placeholder].filter(Boolean).join(' ')));
}

function validatePlannedIntent(ir, plannedUnit, registry, errors) {
  if (!plannedUnit) return;
  if (clean(ir.plannedId, 40) !== clean(plannedUnit.plannedId, 40)) errors.push(`Canonical IR plannedId ${ir.plannedId || '(missing)'} does not match ${plannedUnit.plannedId}.`);
  const objective = clean(plannedUnit.objective || plannedUnit.rationale, 1500);
  const objectiveTokens = new Set(conceptTokens(objective));
  if (!objectiveTokens.size) return;
  const registryElements = registry.elements || [];
  const evidencedConcepts = new Set();
  for (const element of registryElements) {
    for (const item of elementConceptTokens(element)) if (objectiveTokens.has(item)) evidencedConcepts.add(item);
  }
  if (!evidencedConcepts.size) return;
  const usedRefs = new Set([
    ...(ir.actions || []).flatMap((item) => [item.elementRef, item.sourceElementRef, item.targetElementRef]),
    ...(ir.assertions || []).map((item) => item.elementRef),
  ].filter(Boolean));
  const usedConcepts = new Set();
  const byRef = new Map(registryElements.map((element) => [element.elementRef, element]));
  for (const ref of usedRefs) {
    const element = byRef.get(ref);
    if (!element) continue;
    for (const item of elementConceptTokens(element)) usedConcepts.add(item);
  }
  const matches = [...evidencedConcepts].filter((item) => usedConcepts.has(item));
  if (!matches.length) errors.push(`Canonical IR does not reference the discovered element concepts required by planned objective ${quote(objective)}. Expected one of: ${[...evidencedConcepts].join(', ')}.`);
}

function displayAction(action, registry) {
  const byRef = new Map((registry.elements || []).map((item) => [item.elementRef, item]));
  const selector = action.elementRef ? byRef.get(action.elementRef)?.selector || action.elementRef : null;
  switch (action.operation) {
    case 'LOGIN_VALID': return { action: 'Use configured valid login credentials', target: '', value: null };
    case 'NAVIGATE': return { action: 'Navigate', target: 'Path', value: action.path };
    case 'TYPE': return { action: 'Fill', target: selector, value: action.value };
    case 'CLEAR': return { action: 'Clear', target: selector, value: null };
    case 'SELECT': return { action: 'Select', target: selector, value: action.value };
    case 'CHECK': return { action: 'Check', target: selector, value: null };
    case 'UNCHECK': return { action: 'Uncheck', target: selector, value: null };
    case 'SUBMIT': return { action: 'Submit', target: selector, value: null };
    case 'PRESS_KEY': return { action: 'Press key', target: selector, value: action.key };
    default: return { action: action.operation.replace(/_/g, ' ').toLowerCase(), target: selector || action.targetElementRef || action.permission || '', value: action.value ?? action.fileName ?? null };
  }
}

function displayAssertion(assertion, registry) {
  const byRef = new Map((registry.elements || []).map((item) => [item.elementRef, item]));
  const selector = assertion.elementRef ? byRef.get(assertion.elementRef)?.selector || assertion.elementRef : null;
  const op = assertion.operation;
  if (op === 'ASSERT_VISIBLE') return `Element ${selector} is visible`;
  if (op === 'ASSERT_HIDDEN') return `Element ${selector} is hidden`;
  if (op === 'ASSERT_NOT_EXISTS') return `Element ${selector} is absent`;
  if (op === 'ASSERT_EXISTS') return `Element ${selector} exists`;
  if (op === 'ASSERT_TEXT_CONTAINS') return `Text in ${selector} contains ${quote(assertion.text)}`;
  if (op === 'ASSERT_TEXT_EQUALS') return `Text in ${selector} equals ${quote(assertion.text)}`;
  if (op === 'ASSERT_TEXT_NOT_EMPTY') return `Text in ${selector} is non-empty`;
  if (op === 'ASSERT_TEXT_EMPTY') return `Text in ${selector} is empty`;
  if (op === 'ASSERT_VALUE_EQUALS') return `Value of ${selector} equals ${quote(assertion.value)}`;
  if (op === 'ASSERT_VALUE_EMPTY') return `Value of ${selector} is empty`;
  if (op === 'ASSERT_VALUE_NOT_EMPTY') return `Value of ${selector} is non-empty`;
  if (op === 'ASSERT_SELECTED_VALUE_EQUALS') return `Selected value of ${selector} equals ${quote(assertion.value)}`;
  if (op === 'ASSERT_REQUIRED') return `Element ${selector} is required`;
  if (op === 'ASSERT_INVALID') return `Element ${selector} is invalid`;
  if (op === 'ASSERT_VALID') return `Element ${selector} is valid`;
  if (op === 'ASSERT_PATH_EQUALS') return `Path equals ${quote(assertion.path)}`;
  if (op === 'ASSERT_PATH_INCLUDES') return `Path includes ${quote(assertion.fragment)}`;
  if (op === 'ASSERT_URL_INCLUDES') return `URL includes ${quote(assertion.fragment ?? assertion.path)}`;
  if (op === 'ASSERT_URL_NOT_INCLUDES') return `URL does not include ${quote(assertion.fragment ?? assertion.path)}`;
  return `${op}${selector ? ` on ${selector}` : ''}`;
}

function validateCanonicalIr(ir, { registry, plannedUnit = null, story = '', hasCredentials = true } = {}) {
  const errors = [];
  if (!ir || typeof ir !== 'object') return { ok: false, reasonCode: 'CANONICAL_IR_MISSING', reason: 'Canonical Test IR is missing.', errors: ['Canonical Test IR is missing.'] };
  if (Number(ir.version || IR_VERSION) !== IR_VERSION) errors.push(`Unsupported canonical IR version ${ir.version}.`);
  const index = registryIndex(registry || {});
  if (!index.byRef.size) errors.push('Canonical element registry is empty.');
  if (!Array.isArray(ir.actions) || !ir.actions.length) errors.push('Canonical IR requires at least one action.');
  if (!Array.isArray(ir.assertions) || !ir.assertions.length) errors.push('Canonical IR requires at least one assertion.');
  validatePlannedIntent(ir, plannedUnit, registry || {}, errors);

  const actions = (ir.actions || []).map((item) => normalizeAction(item, index, errors)).filter(Boolean);
  const assertions = (ir.assertions || []).map((item) => normalizeAssertion(item, index, errors, story)).filter(Boolean);
  if (actions.some((action) => action.operation === 'LOGIN_VALID') && !hasCredentials) errors.push('Canonical IR requires configured runtime login credentials.');

  if (errors.length) {
    return {
      ok: false,
      reasonCode: errors.some((item) => /credentials/i.test(item)) ? 'MISSING_CREDENTIALS' : 'CANONICAL_IR_INVALID',
      reason: errors[0],
      errors,
    };
  }

  const expectationCoverage = {
    compiled: assertions.length,
    total: assertions.length,
    percent: assertions.length ? 100 : 0,
    quality: assertions.length ? 'COMPLETE' : 'NONE',
    details: assertions.map((assertion, index) => ({ expectation: displayAssertion(assertion, registry || {}), compiled: true, assertionIndex: index })),
  };
  const advancedOperations = new Set(['SELECT_FILE','DRAG_DROP','SET_PERMISSION_STATE','EXTERNAL_ADAPTER_ACTION','ASSERT_VISUAL_MATCH','ASSERT_WEB_VITAL_AT_MOST','ASSERT_EXTERNAL_MESSAGE_RECEIVED','ASSERT_DATABASE_VALUE_EQUALS','ASSERT_DATABASE_ROW_COUNT_EQUALS','ASSERT_STREAM_MESSAGE_CONTAINS','ASSERT_CLIPBOARD_EQUALS','ASSERT_CLIPBOARD_CONTAINS','ASSERT_DOWNLOADED_DOCUMENT_CONTAINS','ASSERT_BROWSER_PERMISSION_EQUALS','ASSERT_EXTERNAL_ADAPTER']);
  const advancedCapabilities = [...new Set([...actions, ...assertions].filter((item) => advancedOperations.has(item.operation)).map((item) => item.operation))];
  return {
    ok: true,
    canonicalIr: { ...ir, version: IR_VERSION },
    plan: {
      actions,
      assertions,
      narrativeExpectations: [],
      assertionSuggestions: [],
      expectationCoverage,
      advancedCapabilities,
      canonical: true,
      canonicalIrVersion: IR_VERSION,
      plannedId: ir.plannedId || null,
      registryHash: registry?.registryHash || null,
    },
    expectationCoverage,
    display: {
      steps: actions.map((action) => displayAction(action, registry || {})),
      expectedResults: assertions.map((assertion) => displayAssertion(assertion, registry || {})),
    },
  };
}

function canonicalActionCatalog() {
  return ACTION_OPERATIONS.map((operation) => ({ operation, usesElementRef: ELEMENT_ACTIONS.has(operation) }));
}

function canonicalAssertionCatalog() {
  return Object.values(ASSERTION_REGISTRY || {}).map((item) => ({ operation: item.operation, category: item.category, description: item.description }));
}

module.exports = {
  IR_VERSION,
  ACTION_OPERATIONS,
  ACTION_OPERATION_SET,
  validateCanonicalIr,
  canonicalActionCatalog,
  canonicalAssertionCatalog,
  displayAction,
  displayAssertion,
};

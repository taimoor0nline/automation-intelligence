const crypto = require('crypto');
const { buildCanonicalElementRegistry } = require('./canonicalElementRegistry');
const rawGenerator = require('./deterministicAutomationGeneratorV6');
const requestContext = require('./requestContext');
const { getSession } = require('../data/sessionStore');

const VERSION = 'STRICT_CYPRESS_CONTRACT_V1';
const TEXT_ENTRY_TYPES = new Set(['text','email','password','number','search','tel','url','date','datetime-local','month','week','time']);
const FORM_TAGS = new Set(['input','textarea','select']);
const ELEMENT_ASSERTIONS = new Set([
  'ASSERT_EXISTS','ASSERT_NOT_EXISTS','ASSERT_VISIBLE','ASSERT_HIDDEN','ASSERT_HIDDEN_OR_ABSENT',
  'ASSERT_ELEMENT_IN_VIEWPORT','ASSERT_ELEMENT_NOT_IN_VIEWPORT','ASSERT_ELEMENT_WIDTH_EQUALS','ASSERT_ELEMENT_WIDTH_AT_LEAST','ASSERT_ELEMENT_WIDTH_AT_MOST',
  'ASSERT_ELEMENT_HEIGHT_EQUALS','ASSERT_ELEMENT_HEIGHT_AT_LEAST','ASSERT_ELEMENT_HEIGHT_AT_MOST',
  'ASSERT_ATTR_EXISTS','ASSERT_ATTR_NOT_EXISTS','ASSERT_ATTR_EQUALS','ASSERT_ATTR_CONTAINS','ASSERT_PROP_EQUALS',
  'ASSERT_CLASS_INCLUDES','ASSERT_CLASS_NOT_INCLUDES','ASSERT_CSS_EQUALS','ASSERT_ARIA_EQUALS','ASSERT_COUNT_EQUALS','ASSERT_COUNT_AT_LEAST','ASSERT_COUNT_AT_MOST',
]);
const TEXT_ASSERTIONS = new Set(['ASSERT_TEXT_EQUALS','ASSERT_TEXT_CONTAINS','ASSERT_TEXT_NOT_CONTAINS','ASSERT_TEXT_EMPTY','ASSERT_TEXT_NOT_EMPTY','ASSERT_HTML_EQUALS','ASSERT_HTML_CONTAINS']);
const VALUE_ASSERTIONS = new Set(['ASSERT_VALUE_EQUALS','ASSERT_VALUE_CONTAINS','ASSERT_VALUE_EMPTY','ASSERT_VALUE_NOT_EMPTY','ASSERT_VALUE_LENGTH_EQUALS','ASSERT_VALUE_LENGTH_AT_MOST','ASSERT_VALUE_LENGTH_AT_LEAST']);
const CHECK_ASSERTIONS = new Set(['ASSERT_CHECKED','ASSERT_UNCHECKED']);
const SELECT_ASSERTIONS = new Set(['ASSERT_SELECTED_VALUE_EQUALS','ASSERT_SELECTED_TEXT_EQUALS','ASSERT_OPTION_COUNT_EQUALS']);
const FORM_ASSERTIONS = new Set(['ASSERT_ENABLED','ASSERT_DISABLED','ASSERT_FOCUSED','ASSERT_REQUIRED','ASSERT_OPTIONAL','ASSERT_VALID','ASSERT_INVALID']);
const INPUT_ASSERTIONS = new Set(['ASSERT_INPUT_TYPE_EQUALS','ASSERT_MIN_EQUALS','ASSERT_MAX_EQUALS','ASSERT_MINLENGTH_EQUALS','ASSERT_MAXLENGTH_EQUALS','ASSERT_PATTERN_EQUALS']);
const READONLY_ASSERTIONS = new Set(['ASSERT_READONLY','ASSERT_NOT_READONLY']);
const IMAGE_ASSERTIONS = new Set(['ASSERT_IMAGE_LOADED','ASSERT_IMAGE_ALT_NOT_EMPTY']);
const LOCATION_ASSERTIONS = new Set(['ASSERT_URL_EQUALS','ASSERT_URL_INCLUDES','ASSERT_URL_NOT_INCLUDES','ASSERT_URL_CONTAINS','ASSERT_PATH_EQUALS','ASSERT_PATH_INCLUDES','ASSERT_QUERY_INCLUDES','ASSERT_QUERY_PARAM_EQUALS','ASSERT_QUERY_PARAM_ABSENT','ASSERT_HASH_EQUALS','ASSERT_HASH_INCLUDES','ASSERT_ORIGIN_EQUALS','ASSERT_HOST_EQUALS','ASSERT_PROTOCOL_EQUALS']);
const DOCUMENT_ASSERTIONS = new Set(['ASSERT_TITLE_EQUALS','ASSERT_TITLE_INCLUDES','ASSERT_DOCUMENT_LANG_EQUALS','ASSERT_META_CONTENT_EQUALS','ASSERT_NO_HORIZONTAL_OVERFLOW']);
const STORAGE_ASSERTIONS = new Set(['ASSERT_COOKIE_EXISTS','ASSERT_COOKIE_EQUALS','ASSERT_COOKIE_ABSENT','ASSERT_LOCAL_STORAGE_EXISTS','ASSERT_LOCAL_STORAGE_EQUALS','ASSERT_LOCAL_STORAGE_ABSENT','ASSERT_SESSION_STORAGE_EXISTS','ASSERT_SESSION_STORAGE_EQUALS','ASSERT_SESSION_STORAGE_ABSENT']);
const NETWORK_ASSERTIONS = new Set(['ASSERT_REQUEST_SENT','ASSERT_REQUEST_COUNT_EQUALS','ASSERT_REQUEST_BODY_CONTAINS','ASSERT_REQUEST_HEADER_EQUALS','ASSERT_RESPONSE_STATUS','ASSERT_RESPONSE_BODY_CONTAINS','ASSERT_RESPONSE_HEADER_EQUALS']);
const PERFORMANCE_ASSERTIONS = new Set(['ASSERT_PAGE_LOAD_AT_MOST','ASSERT_DOM_CONTENT_LOADED_AT_MOST','ASSERT_RESOURCE_COUNT_AT_MOST','ASSERT_WEB_VITAL_AT_MOST']);
const VIEWPORT_ASSERTIONS = new Set(['ASSERT_VIEWPORT_WIDTH_EQUALS','ASSERT_VIEWPORT_HEIGHT_EQUALS']);

function clean(value) { return String(value ?? '').trim(); }
function hash(value) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value ?? null)).digest('hex'); }
function lower(value) { return clean(value).toLowerCase(); }
function elementType(element = {}) { return lower(element.type); }
function elementTag(element = {}) { return lower(element.tag); }
function isCheckbox(element) { return elementTag(element) === 'input' && elementType(element) === 'checkbox'; }
function isRadio(element) { return elementTag(element) === 'input' && elementType(element) === 'radio'; }
function isSelect(element) { return elementTag(element) === 'select' || elementType(element) === 'select'; }
function isFile(element) { return elementTag(element) === 'input' && elementType(element) === 'file'; }
function isTextEntry(element) {
  const tag = elementTag(element), type = elementType(element);
  if (tag === 'textarea') return true;
  if (element.contenteditable === true || lower(element.contenteditable) === 'true') return true;
  return tag === 'input' && (!type || TEXT_ENTRY_TYPES.has(type));
}
function isFormControl(element) { return FORM_TAGS.has(elementTag(element)); }
function isFocusable(element) {
  const tag = elementTag(element), role = lower(element.role);
  return isFormControl(element) || ['button','a'].includes(tag) || ['button','link','textbox','combobox','checkbox','radio','switch','tab'].includes(role) || element.contenteditable === true || Number.isFinite(Number(element.tabIndex));
}
function isClickable(element) {
  const caps = new Set(element.capabilities || []);
  const tag = elementTag(element), role = lower(element.role), type = elementType(element);
  return caps.has('CLICK') || ['button','a'].includes(tag) || ['button','link','checkbox','radio','switch','tab'].includes(role) || ['button','submit','reset','checkbox','radio','image'].includes(type);
}
function identity(element = {}) {
  return [element.elementRef, element.selector, element.testId, element.id, element.name, element.label, element.text, element.ariaLabel, element.placeholder].filter(Boolean).join(' ');
}
function textEvidence(testCase, context) {
  return [testCase?.title, testCase?.coverageRationale, testCase?.generationStory, context?.story, ...(testCase?.expectedResults || []), ...(testCase?.preconditions || [])].filter(Boolean).join('\n').toLowerCase();
}
function containsEvidence(haystack, value) {
  const needle = clean(value).toLowerCase();
  return Boolean(needle && haystack.includes(needle));
}
function numericEvidence(haystack, value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return false;
  const escaped = String(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^0-9.])${escaped}([^0-9.]|$)`).test(haystack);
}
function issue(code, message, details = null) { return { code, message, details }; }

function pagePath(page) {
  try { const url = new URL(page?.finalUrl || page?.url || 'http://local/'); return `${url.pathname}${url.search}` || '/'; }
  catch { return '/'; }
}

function discoveredNetwork(pageDiscoveries = []) {
  const out = [];
  for (const page of pageDiscoveries || []) for (const hint of page?.networkHints || []) out.push({ ...hint, page: page?.finalUrl || page?.url || null });
  return out;
}

function browserStateEvidence(pageDiscoveries = []) {
  const cookies = new Set(), localStorage = new Set(), sessionStorage = new Set();
  for (const page of pageDiscoveries || []) {
    for (const key of page?.browserState?.cookieNames || []) cookies.add(String(key));
    for (const key of page?.browserState?.localStorageKeys || []) localStorage.add(String(key));
    for (const key of page?.browserState?.sessionStorageKeys || []) sessionStorage.add(String(key));
  }
  return { cookies, localStorage, sessionStorage };
}

function resolveLoginRuntime(pageDiscoveries = []) {
  const entries = [];
  for (const page of pageDiscoveries || []) for (const item of page?.elements || []) entries.push({ page, item });
  const scoreIdentity = (item, pattern) => pattern.test([item?.testId,item?.id,item?.name,item?.label,item?.text,item?.ariaLabel,item?.placeholder,item?.autocomplete].filter(Boolean).join(' '));
  const passwords = entries.filter(({item}) => elementType(item) === 'password');
  const passwordEntry = passwords[0] || null;
  const sameSurface = ({page,item}) => {
    if (!passwordEntry) return true;
    const samePage = (page?.finalUrl || page?.url) === (passwordEntry.page?.finalUrl || passwordEntry.page?.url);
    const form = clean(passwordEntry.item?.formId || passwordEntry.item?.formName || passwordEntry.item?.formAction);
    if (!samePage) return false;
    if (!form) return true;
    return form === clean(item?.formId || item?.formName || item?.formAction);
  };
  const usernameEntry = entries.filter(sameSurface).find(({item}) => elementType(item) !== 'password' && isTextEntry(item) && scoreIdentity(item, /user.?name|email|login|account/i)) || null;
  const submitEntry = entries.filter(sameSurface).find(({item}) => isClickable(item) && (/submit/.test(elementType(item)) || scoreIdentity(item, /sign\s*in|log\s*in|login|continue|submit/i))) || null;
  const selector = (entry) => clean(entry?.item?.selector);
  return {
    path: pagePath(passwordEntry?.page || usernameEntry?.page || submitEntry?.page || pageDiscoveries?.[0]),
    selectors: { username: selector(usernameEntry), password: selector(passwordEntry), submit: selector(submitEntry) },
  };
}

function sessionContext(context = {}) {
  const current = requestContext.current();
  const session = current.sessionId ? getSession(current.sessionId) : null;
  const actorCredentialRefs = context.actorCredentialRefs?.length
    ? context.actorCredentialRefs.map(String)
    : Object.entries(session?.actorCredentials || {}).filter(([, value]) => value?.username && value?.password).map(([key]) => key);
  return {
    session,
    story: context.story || session?.story || '',
    hasCredentials: context.hasCredentials ?? Boolean(session?.credentials?.username && session?.credentials?.password),
    actorCredentialRefs,
  };
}

function registryMaps(registry = {}) {
  return {
    byRef: new Map((registry.elements || []).map((element) => [String(element.elementRef || ''), element])),
    bySelector: new Map((registry.elements || []).map((element) => [String(element.selector || ''), element])),
    paths: new Set((registry.pages || []).map((page) => String(page.path || ''))),
  };
}

function actionCompatibility(testCase, registry, runtime) {
  const problems = [];
  const map = registryMaps(registry);
  for (const action of testCase?.canonicalIr?.actions || []) {
    const op = clean(action?.operation).toUpperCase();
    const element = action?.elementRef ? map.byRef.get(String(action.elementRef)) : null;
    const reject = (code, message) => problems.push(issue(code, `${op}: ${message}`, { elementRef: action?.elementRef || null }));
    if (['TYPE','TYPE_RUNTIME_CREDENTIAL','CLEAR'].includes(op)) {
      if (!element || !isTextEntry(element)) reject('CYPRESS_ACTION_ELEMENT_MISMATCH', `requires a typeable input/textarea/contenteditable element, not ${identity(element) || 'an unknown element'}.`);
      else if (element.disabled === true || element.readonly === true) reject('CYPRESS_ACTION_ELEMENT_STATE', 'cannot target a discovered disabled/read-only control.');
    } else if (op === 'SELECT') {
      if (!element || !isSelect(element)) reject('CYPRESS_ACTION_ELEMENT_MISMATCH', 'requires a <select> element.');
    } else if (op === 'CHECK') {
      if (!element || (!isCheckbox(element) && !isRadio(element))) reject('CYPRESS_ACTION_ELEMENT_MISMATCH', 'requires a checkbox or radio input.');
    } else if (op === 'UNCHECK') {
      if (!element || !isCheckbox(element)) reject('CYPRESS_ACTION_ELEMENT_MISMATCH', 'Cypress .uncheck() is checkbox-only. A radio scenario must leave the group untouched, select another option, or use a real reset flow.');
    } else if (['CLICK','DBLCLICK'].includes(op)) {
      if (!element || !isClickable(element)) reject('CYPRESS_ACTION_ELEMENT_MISMATCH', 'requires an interactable rendered control/link.');
    } else if (op === 'RIGHTCLICK') {
      if (!element) reject('CYPRESS_ACTION_ELEMENT_MISMATCH', 'requires a discovered rendered element.');
    } else if (['FOCUS','BLUR','PRESS_KEY'].includes(op)) {
      if (!element || !isFocusable(element)) reject('CYPRESS_ACTION_ELEMENT_MISMATCH', 'requires a focusable rendered element.');
    } else if (['HOVER','SCROLL_INTO_VIEW'].includes(op)) {
      if (!element) reject('CYPRESS_ACTION_ELEMENT_MISMATCH', 'requires a discovered rendered element.');
    } else if (op === 'SELECT_FILE') {
      if (!element || !isFile(element)) reject('CYPRESS_ACTION_ELEMENT_MISMATCH', 'requires <input type="file">.');
    } else if (op === 'SUBMIT') {
      const tag = elementTag(element), type = elementType(element);
      if (!element || !((tag === 'form') || ((tag === 'button' || tag === 'input') && type === 'submit'))) reject('CYPRESS_ACTION_ELEMENT_MISMATCH', 'requires a form or submit control grounded to the rendered form.');
    } else if (op === 'NAVIGATE') {
      const path = clean(action.path || action.value);
      if (!path || !map.paths.has(path)) problems.push(issue('CYPRESS_NAVIGATION_UNGROUNDED', `NAVIGATE target is not a discovered page path: ${path || '(missing)'}.`));
    } else if (op === 'LOGIN_VALID') {
      const selectors = runtime.loginRuntime.selectors;
      if (!runtime.hasCredentials) problems.push(issue('CYPRESS_RUNTIME_CREDENTIALS_MISSING', 'LOGIN_VALID requires configured runtime credentials.'));
      if (!selectors.username || !selectors.password || !selectors.submit) problems.push(issue('CYPRESS_LOGIN_SURFACE_UNGROUNDED', 'LOGIN_VALID requires one rendered username, password and submit control on the same login surface.'));
    } else if (op === 'LOGIN_AS_ACTOR') {
      const actorRef = clean(action.actorRef);
      if (!runtime.actorCredentialRefs.includes(actorRef)) problems.push(issue('CYPRESS_ACTOR_CREDENTIALS_MISSING', `LOGIN_AS_ACTOR requires configured credentials for ${actorRef || '(missing actor)'}.`));
      const selectors = runtime.loginRuntime.selectors;
      if (!selectors.username || !selectors.password || !selectors.submit) problems.push(issue('CYPRESS_LOGIN_SURFACE_UNGROUNDED', 'LOGIN_AS_ACTOR requires grounded rendered login controls.'));
    } else if (op === 'SET_VIEWPORT') {
      const width = Number(action.width), height = Number(action.height);
      if (!Number.isFinite(width) || !Number.isFinite(height) || width < 240 || height < 240 || width > 7680 || height > 4320) problems.push(issue('CYPRESS_VIEWPORT_INVALID', `SET_VIEWPORT requires realistic numeric dimensions; received ${action.width}x${action.height}.`));
    }
  }
  return problems;
}

function assertionCompatibility(testCase, registry, runtime, pageDiscoveries, context = {}) {
  const problems = [];
  const map = registryMaps(registry);
  const evidence = textEvidence(testCase, { ...context, story: runtime.story });
  const network = discoveredNetwork(pageDiscoveries);
  const browserState = browserStateEvidence(pageDiscoveries);
  const pages = pageDiscoveries || [];
  const pageTexts = pages.map((page) => [page.pageTitle, page.documentLanguage, ...(page.meta || []).flatMap((m) => [m?.name,m?.content])].filter(Boolean).join(' ')).join('\n').toLowerCase();
  const networkMatches = (fragment, method = null) => network.filter((item) => clean(item.url).includes(clean(fragment)) && (!method || clean(item.method).toUpperCase() === clean(method).toUpperCase()));

  for (const assertion of testCase?.canonicalIr?.assertions || []) {
    const op = clean(assertion?.operation).toUpperCase();
    const element = assertion?.elementRef ? map.byRef.get(String(assertion.elementRef)) : null;
    const reject = (code, message) => problems.push(issue(code, `${op}: ${message}`, { elementRef: assertion?.elementRef || null }));

    if (ELEMENT_ASSERTIONS.has(op)) {
      if (!element) reject('CYPRESS_ASSERTION_ELEMENT_MISMATCH', 'requires a discovered rendered element.');
    } else if (TEXT_ASSERTIONS.has(op)) {
      if (!element || !(element.capabilities || []).includes('TEXT')) reject('CYPRESS_ASSERTION_ELEMENT_MISMATCH', 'requires a content-bearing rendered element.');
    } else if (VALUE_ASSERTIONS.has(op)) {
      if (!element || !(isFormControl(element) || element.contenteditable === true)) reject('CYPRESS_ASSERTION_ELEMENT_MISMATCH', 'requires a form/value control.');
    } else if (CHECK_ASSERTIONS.has(op)) {
      if (!element || (!isCheckbox(element) && !isRadio(element))) reject('CYPRESS_ASSERTION_ELEMENT_MISMATCH', 'requires a checkbox or radio input.');
    } else if (SELECT_ASSERTIONS.has(op)) {
      if (!element || !isSelect(element)) reject('CYPRESS_ASSERTION_ELEMENT_MISMATCH', 'requires a <select> element.');
    } else if (FORM_ASSERTIONS.has(op)) {
      if (!element || !isFormControl(element)) reject('CYPRESS_ASSERTION_ELEMENT_MISMATCH', 'requires a form control.');
    } else if (READONLY_ASSERTIONS.has(op)) {
      if (!element || !['input','textarea'].includes(elementTag(element))) reject('CYPRESS_ASSERTION_ELEMENT_MISMATCH', 'requires an input or textarea.');
    } else if (INPUT_ASSERTIONS.has(op)) {
      if (!element || elementTag(element) !== 'input') reject('CYPRESS_ASSERTION_ELEMENT_MISMATCH', 'requires an input element.');
    } else if (op === 'ASSERT_PLACEHOLDER_EQUALS') {
      if (!element || !['input','textarea'].includes(elementTag(element))) reject('CYPRESS_ASSERTION_ELEMENT_MISMATCH', 'requires an input or textarea.');
    } else if (IMAGE_ASSERTIONS.has(op)) {
      if (!element || elementTag(element) !== 'img') reject('CYPRESS_ASSERTION_ELEMENT_MISMATCH', 'requires an image element.');
    }

    if (LOCATION_ASSERTIONS.has(op)) {
      const literal = assertion.url ?? assertion.path ?? assertion.fragment ?? assertion.value ?? assertion.hash ?? '';
      const grounded = containsEvidence(evidence, literal) || pages.some((page) => [page?.url,page?.finalUrl].filter(Boolean).some((value) => String(value).includes(String(literal))));
      if (literal && !grounded && !['ASSERT_QUERY_PARAM_ABSENT'].includes(op)) problems.push(issue('CYPRESS_LOCATION_EXPECTATION_UNGROUNDED', `${op} uses a URL/path value not present in the story or rendered page evidence: ${literal}.`));
    }

    if (DOCUMENT_ASSERTIONS.has(op)) {
      const literal = assertion.text ?? assertion.value ?? assertion.name ?? '';
      if (literal && !containsEvidence(evidence, literal) && !pageTexts.includes(clean(literal).toLowerCase()) && op !== 'ASSERT_NO_HORIZONTAL_OVERFLOW') problems.push(issue('CYPRESS_DOCUMENT_EXPECTATION_UNGROUNDED', `${op} value is not present in the story or rendered document evidence: ${literal}.`));
    }

    if (STORAGE_ASSERTIONS.has(op)) {
      const key = clean(assertion.key || assertion.name);
      const set = op.startsWith('ASSERT_COOKIE_') ? browserState.cookies : op.startsWith('ASSERT_LOCAL_STORAGE_') ? browserState.localStorage : browserState.sessionStorage;
      if (key && !set.has(key) && !containsEvidence(evidence, key)) problems.push(issue('CYPRESS_BROWSER_STATE_UNGROUNDED', `${op} key is neither observed during rendered discovery nor stated in the test requirement: ${key}.`));
    }

    if (NETWORK_ASSERTIONS.has(op)) {
      const fragment = clean(assertion.urlFragment || assertion.value);
      const matches = fragment ? networkMatches(fragment, assertion.method) : [];
      if (!fragment || (!matches.length && !containsEvidence(evidence, fragment))) problems.push(issue('CYPRESS_NETWORK_EXPECTATION_UNGROUNDED', `${op} requires a network target observed during browser discovery or explicitly stated in the requirement: ${fragment || '(missing)'}.`));
      if (op === 'ASSERT_RESPONSE_STATUS') {
        const expectedStatus = Number(assertion.status);
        const discoveredStatus = matches.some((item) => Number(item.status) === expectedStatus || Number(item.statusCode) === expectedStatus);
        if (!discoveredStatus && !numericEvidence(evidence, expectedStatus)) problems.push(issue('CYPRESS_NETWORK_STATUS_UNGROUNDED', `${op} status ${assertion.status} was neither observed nor explicitly required.`));
      }
    }

    if (PERFORMANCE_ASSERTIONS.has(op)) {
      const threshold = assertion.max ?? assertion.count ?? assertion.milliseconds ?? assertion.value;
      const policyThresholds = context.performanceThresholds || {};
      const configured = Object.values(policyThresholds).some((value) => Number(value) === Number(threshold));
      if (!configured && !numericEvidence(evidence, threshold)) problems.push(issue('CYPRESS_PERFORMANCE_THRESHOLD_UNGROUNDED', `${op} threshold ${threshold} must come from the story or configured performance policy; AI may not invent it.`));
    }

    if (VIEWPORT_ASSERTIONS.has(op)) {
      const expected = Number(assertion.width ?? assertion.height ?? assertion.value);
      const actionMatch = (testCase?.canonicalIr?.actions || []).some((action) => clean(action.operation).toUpperCase() === 'SET_VIEWPORT' && (Number(action.width) === expected || Number(action.height) === expected));
      if (!actionMatch && !numericEvidence(evidence, expected)) problems.push(issue('CYPRESS_VIEWPORT_EXPECTATION_UNGROUNDED', `${op} dimension ${expected} is not tied to SET_VIEWPORT or a stated requirement.`));
    }
  }
  return problems;
}

function categoryCompatibility(testCase) {
  const category = clean(testCase?.testCategory || testCase?.category).toUpperCase();
  const actions = new Set((testCase?.canonicalIr?.actions || []).map((item) => clean(item.operation).toUpperCase()));
  const assertions = new Set((testCase?.canonicalIr?.assertions || []).map((item) => clean(item.operation).toUpperCase()));
  const has = (set) => [...assertions].some((op) => set.has(op));
  const problems = [];
  if (category === 'ACCESSIBILITY' && !assertions.has('ASSERT_NO_ACCESSIBILITY_VIOLATIONS')) problems.push(issue('CYPRESS_CATEGORY_CONTRACT_MISMATCH', 'ACCESSIBILITY cases must contain a deterministic accessibility assertion.'));
  if (category === 'PERFORMANCE' && !has(PERFORMANCE_ASSERTIONS)) problems.push(issue('CYPRESS_CATEGORY_CONTRACT_MISMATCH', 'PERFORMANCE cases must contain an actual deterministic performance assertion, not a generic page check.'));
  if (category === 'INTEGRATION' && !has(new Set([...NETWORK_ASSERTIONS,'ASSERT_STREAM_MESSAGE_CONTAINS','ASSERT_EXTERNAL_ADAPTER','ASSERT_DATABASE_VALUE_EQUALS','ASSERT_DATABASE_ROW_COUNT_EQUALS']))) problems.push(issue('CYPRESS_CATEGORY_CONTRACT_MISMATCH', 'INTEGRATION cases require an observable integration/network/stream/database/external-adapter assertion.'));
  if (category === 'COMPATIBILITY' && !actions.has('SET_VIEWPORT') && !has(new Set([...VIEWPORT_ASSERTIONS,'ASSERT_NO_HORIZONTAL_OVERFLOW']))) problems.push(issue('CYPRESS_CATEGORY_CONTRACT_MISMATCH', 'COMPATIBILITY cases require an explicit viewport/layout compatibility contract.'));
  return problems;
}

function validateGeneratedArtifact(testCase, runtime, pageDiscoveries) {
  try {
    const candidate = {
      ...testCase,
      automationReadiness: { ...(testCase.automationReadiness || {}), automationPlan: testCase?.automationReadiness?.automationPlan },
    };
    const generated = rawGenerator.generateDeterministicAutomation([candidate]);
    const script = String(generated.script || '');
    const validator = require('./scriptValidator');
    const result = validator.validateGroundedScript(script, {
      approvedTestCases: [testCase],
      pageDiscoveries,
      hasCredentials: runtime.hasCredentials,
      loginSelectors: runtime.loginRuntime.selectors,
      actorCredentialRefs: runtime.actorCredentialRefs,
      frameworkOwnedSelectors: ['body'],
    });
    const errors = [...(result.errors || [])];
    if (/\.prop\(\s*['"]checked['"]/.test(script)) errors.push('Generated Cypress artifact directly mutates checked state. User-observable state must be produced through supported Cypress interactions, not DOM mutation.');
    if ((script.match(/\bit\s*\(/g) || []).length !== 1) errors.push('A single-case readiness artifact must contain exactly one it() block.');
    return {
      ok: errors.length === 0,
      errors: [...new Set(errors)],
      scriptHash: hash(script),
      scriptLength: script.length,
      generationMode: generated.generationMode || null,
    };
  } catch (err) {
    return { ok: false, errors: [err.message], scriptHash: null, scriptLength: 0, generationMode: null };
  }
}

function validateCypressContract(testCase, context = {}) {
  const pageDiscoveries = context.pageDiscoveries || [];
  const registry = context.canonicalElementRegistry || buildCanonicalElementRegistry(pageDiscoveries);
  const session = sessionContext(context);
  const runtime = {
    story: testCase?.generationStory || session.story || '',
    hasCredentials: Boolean(session.hasCredentials),
    actorCredentialRefs: session.actorCredentialRefs,
    loginRuntime: resolveLoginRuntime(pageDiscoveries),
  };
  const problems = [
    ...actionCompatibility(testCase, registry, runtime),
    ...assertionCompatibility(testCase, registry, runtime, pageDiscoveries, context),
    ...categoryCompatibility(testCase),
  ];

  let artifact = { ok: false, errors: [], scriptHash: null, scriptLength: 0, generationMode: null };
  if (!problems.length) artifact = validateGeneratedArtifact(testCase, runtime, pageDiscoveries);
  for (const message of artifact.errors || []) problems.push(issue('CYPRESS_ARTIFACT_VALIDATION_FAILED', message));

  return {
    ok: problems.length === 0 && artifact.ok,
    version: VERSION,
    reasonCode: problems[0]?.code || null,
    reason: problems[0]?.message || null,
    errors: problems,
    scriptHash: artifact.scriptHash,
    scriptLength: artifact.scriptLength,
    generationMode: artifact.generationMode,
    registryHash: registry.registryHash || null,
    planHash: hash(testCase?.automationReadiness?.automationPlan || null),
    validatedAt: new Date().toISOString(),
  };
}

module.exports = {
  VERSION,
  validateCypressContract,
  resolveLoginRuntime,
  actionCompatibility,
  assertionCompatibility,
  categoryCompatibility,
};

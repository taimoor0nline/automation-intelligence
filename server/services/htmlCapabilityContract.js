const { runtimeCapabilities } = require('./progressiveTestGenerator');

const VERSION = 'HTML_CAPABILITY_CONTRACT_V1';
const TEXT_ASSERTIONS = new Set(['ASSERT_TEXT_EQUALS','ASSERT_TEXT_CONTAINS','ASSERT_TEXT_NOT_CONTAINS','ASSERT_TEXT_EMPTY','ASSERT_TEXT_NOT_EMPTY']);
const HTML_ASSERTIONS = new Set(['ASSERT_HTML_EQUALS','ASSERT_HTML_CONTAINS']);
const VALUE_ASSERTIONS = new Set(['ASSERT_VALUE_EQUALS','ASSERT_VALUE_CONTAINS','ASSERT_VALUE_EMPTY','ASSERT_VALUE_NOT_EMPTY','ASSERT_VALUE_LENGTH_EQUALS','ASSERT_VALUE_LENGTH_AT_MOST','ASSERT_VALUE_LENGTH_AT_LEAST']);
const CHECK_ASSERTIONS = new Set(['ASSERT_CHECKED','ASSERT_UNCHECKED']);
const SELECT_ASSERTIONS = new Set(['ASSERT_SELECTED_VALUE_EQUALS','ASSERT_SELECTED_TEXT_EQUALS','ASSERT_OPTION_COUNT_EQUALS']);
const INPUT_METADATA_ASSERTIONS = new Set(['ASSERT_INPUT_TYPE_EQUALS','ASSERT_MIN_EQUALS','ASSERT_MAX_EQUALS','ASSERT_MINLENGTH_EQUALS','ASSERT_MAXLENGTH_EQUALS','ASSERT_PATTERN_EQUALS','ASSERT_PLACEHOLDER_EQUALS']);
const IMAGE_ASSERTIONS = new Set(['ASSERT_IMAGE_LOADED','ASSERT_IMAGE_ALT_NOT_EMPTY']);

function clean(value) { return String(value ?? '').trim(); }
function op(value) { return clean(value).toUpperCase(); }
function lower(value) { return clean(value).toLowerCase(); }
function issue(code, message, details = null) { return { code, message, details }; }
function byRef(registry = {}) { return new Map((registry.elements || []).map((element) => [String(element.elementRef || ''), element])); }
function caps(element = {}) { return new Set(Array.isArray(element.capabilities) ? element.capabilities : []); }
function has(element, capability) { return caps(element).has(capability); }
function numeric(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }

function validDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean(value));
  if (!match) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
function validMonth(value) { const match = /^(\d{4})-(\d{2})$/.exec(clean(value)); return Boolean(match && Number(match[2]) >= 1 && Number(match[2]) <= 12); }
function validWeek(value) { const match = /^(\d{4})-W(\d{2})$/.exec(clean(value)); return Boolean(match && Number(match[2]) >= 1 && Number(match[2]) <= 53); }
function validTime(value) {
  const match = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(clean(value));
  if (!match) return false;
  return Number(match[1]) <= 23 && Number(match[2]) <= 59 && (match[3] == null || Number(match[3]) <= 59);
}
function validDateTimeLocal(value) {
  const parts = clean(value).split('T');
  return parts.length === 2 && validDate(parts[0]) && validTime(parts[1]);
}
function typeValueProblem(element = {}, value) {
  const type = lower(element.type || 'text');
  const text = String(value ?? '');
  if (type === 'number' && !/^-?(?:\d+|\d*\.\d+)$/.test(text)) return 'number inputs require a finite numeric text value.';
  if (type === 'date' && !validDate(text)) return 'date inputs require a real calendar date in YYYY-MM-DD format.';
  if (type === 'month' && !validMonth(text)) return 'month inputs require YYYY-MM with month 01-12.';
  if (type === 'week' && !validWeek(text)) return 'week inputs require YYYY-Www with week 01-53.';
  if (type === 'time' && !validTime(text)) return 'time inputs require HH:mm[:ss[.SSS]] with valid 24-hour components.';
  if (type === 'datetime-local' && !validDateTimeLocal(text)) return 'datetime-local inputs require YYYY-MM-DDTHH:mm[:ss[.SSS]] with valid date/time components.';
  return null;
}

const MIME_BY_EXT = Object.freeze({
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml',
  pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', json: 'application/json', xml: 'application/xml', html: 'text/html',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip', mp3: 'audio/mpeg', mp4: 'video/mp4', webm: 'video/webm',
});
function extension(fileName) { const match = /\.([A-Za-z0-9]+)$/.exec(clean(fileName)); return match ? match[1].toLowerCase() : ''; }
function fileAccepted(element = {}, fileName) {
  const accept = clean(element.accept);
  if (!accept) return true;
  const ext = extension(fileName);
  const mime = MIME_BY_EXT[ext] || '';
  return accept.split(',').map((token) => token.trim().toLowerCase()).filter(Boolean).some((token) => {
    if (token.startsWith('.')) return ext && token === `.${ext}`;
    if (token.endsWith('/*')) return mime && mime.startsWith(token.slice(0, -1));
    return mime && token === mime;
  });
}
function configuredFixtures() {
  const direct = runtimeCapabilities()?.direct?.FILE_UPLOAD || {};
  return new Set(Array.isArray(direct.fixtures) ? direct.fixtures.map(String) : []);
}
function actionFiles(action = {}) {
  if (Array.isArray(action.fileNames)) return [...new Set(action.fileNames.map((value) => clean(value)).filter(Boolean))];
  const single = clean(action.fileName);
  return single ? [single] : [];
}

function rangeProblem(element = {}, value) {
  const number = numeric(value);
  if (number == null) return 'range value must be numeric.';
  const min = element.min == null || clean(element.min) === '' ? 0 : numeric(element.min);
  const max = element.max == null || clean(element.max) === '' ? 100 : numeric(element.max);
  const stepText = clean(element.step);
  const step = !stepText || stepText === 'any' ? null : numeric(stepText);
  if (min != null && number < min) return `range value ${number} is below discovered min ${min}.`;
  if (max != null && number > max) return `range value ${number} is above discovered max ${max}.`;
  if (step != null && step > 0 && min != null) {
    const quotient = (number - min) / step;
    if (Math.abs(quotient - Math.round(quotient)) > 1e-9) return `range value ${number} does not align with discovered step ${step} from min ${min}.`;
  }
  return null;
}

function validateAction(action, elements, fixtures, problems) {
  const operation = op(action.operation);
  const element = action.elementRef ? elements.get(String(action.elementRef)) : null;
  const requireCapability = (capability, message = null) => {
    if (!element || !has(element, capability)) problems.push(issue('HTML_ACTION_CAPABILITY_MISMATCH', `${operation} requires discovered capability ${capability}${message ? ` (${message})` : ''}.`, { elementRef: action.elementRef || null, capability }));
  };
  const capabilityMap = {
    TYPE: 'TYPE', TYPE_RUNTIME_CREDENTIAL: 'TYPE', CLEAR: 'CLEAR', CLICK: 'CLICK', DBLCLICK: 'DBLCLICK', RIGHTCLICK: 'RIGHTCLICK',
    HOVER: 'HOVER', FOCUS: 'FOCUS', BLUR: 'BLUR', SELECT: 'SELECT', CHECK: 'CHECK', UNCHECK: 'UNCHECK', SUBMIT: 'SUBMIT',
    SCROLL_INTO_VIEW: 'SCROLL_INTO_VIEW', PRESS_KEY: 'PRESS_KEY', SELECT_FILE: 'SELECT_FILE', SET_RANGE_VALUE: 'SET_RANGE_VALUE',
    DROP_FILE: 'DROP_FILE', SELECT_FILES: 'SELECT_FILE', DROP_FILES: 'DROP_FILE',
  };
  if (capabilityMap[operation]) requireCapability(capabilityMap[operation]);

  if (element?.disabled === true && ['TYPE','TYPE_RUNTIME_CREDENTIAL','CLEAR','CLICK','DBLCLICK','RIGHTCLICK','FOCUS','SELECT','CHECK','UNCHECK','SUBMIT','PRESS_KEY','SELECT_FILE','SELECT_FILES','SET_RANGE_VALUE'].includes(operation)) {
    problems.push(issue('HTML_DISABLED_ELEMENT_INTERACTION', `${operation} targets an element discovered as disabled.`, { elementRef: action.elementRef }));
  }
  if (element?.readonly === true && ['TYPE','TYPE_RUNTIME_CREDENTIAL','CLEAR','SET_RANGE_VALUE'].includes(operation)) {
    problems.push(issue('HTML_READONLY_ELEMENT_INTERACTION', `${operation} targets an element discovered as read-only.`, { elementRef: action.elementRef }));
  }

  if (operation === 'TYPE') {
    const problem = typeValueProblem(element, action.value);
    if (problem) problems.push(issue('HTML_INPUT_VALUE_INVALID', `${operation}: ${problem}`, { elementRef: action.elementRef, inputType: element?.type || null, value: action.value }));
  }
  if (operation === 'SET_RANGE_VALUE') {
    const problem = rangeProblem(element, action.value);
    if (problem) problems.push(issue('HTML_RANGE_VALUE_INVALID', `${operation}: ${problem}`, { elementRef: action.elementRef, value: action.value }));
  }
  if (operation === 'SELECT' && element) {
    const requested = clean(action.value);
    const option = (element.options || []).find((item) => clean(item.value) === requested || clean(item.text) === requested);
    if (!option) problems.push(issue('HTML_SELECT_OPTION_NOT_FOUND', `SELECT value ${JSON.stringify(requested)} is not present in the discovered native select.`, { elementRef: action.elementRef }));
    else if (option.disabled === true) problems.push(issue('HTML_SELECT_OPTION_DISABLED', `SELECT value ${JSON.stringify(requested)} targets a discovered disabled option.`, { elementRef: action.elementRef }));
  }

  if (['SELECT_FILE','DROP_FILE','SELECT_FILES','DROP_FILES'].includes(operation)) {
    const files = actionFiles(action);
    if (!files.length) problems.push(issue('HTML_FILE_FIXTURE_REQUIRED', `${operation} requires at least one approved fixture.`, { elementRef: action.elementRef }));
    if (files.length > 10) problems.push(issue('HTML_FILE_COUNT_TOO_HIGH', `${operation} supports at most 10 files in one deterministic interaction.`, { elementRef: action.elementRef }));
    if (operation === 'SELECT_FILES' && files.length > 1 && element?.multiple !== true) problems.push(issue('HTML_FILE_MULTIPLE_NOT_ALLOWED', 'Multiple-file selection requires a discovered input[type=file] with multiple=true.', { elementRef: action.elementRef }));
    for (const fileName of files) {
      if (!fixtures.has(fileName)) problems.push(issue('HTML_FILE_FIXTURE_UNAVAILABLE', `${operation} references a file that is not present in the approved upload fixture inventory: ${fileName}.`, { elementRef: action.elementRef, fileName }));
      if (operation.startsWith('SELECT') && element && !fileAccepted(element, fileName)) problems.push(issue('HTML_FILE_ACCEPT_MISMATCH', `${fileName} does not match the discovered accept=${JSON.stringify(element.accept)} contract.`, { elementRef: action.elementRef, fileName, accept: element.accept }));
      if (element && has(element, 'IMAGE_UPLOAD') && !String(MIME_BY_EXT[extension(fileName)] || '').startsWith('image/')) problems.push(issue('HTML_IMAGE_UPLOAD_FIXTURE_MISMATCH', `${fileName} is not an image fixture for the discovered image-upload control.`, { elementRef: action.elementRef, fileName }));
    }
  }

  if (operation === 'DRAG_DROP') {
    const source = elements.get(String(action.sourceElementRef || ''));
    const target = elements.get(String(action.targetElementRef || ''));
    if (!source || !has(source, 'DRAG_SOURCE')) problems.push(issue('HTML_DRAG_SOURCE_UNGROUNDED', 'Element drag/drop requires a source discovered as natively draggable.', { sourceElementRef: action.sourceElementRef || null }));
    if (!target || !has(target, 'DROP_TARGET')) problems.push(issue('HTML_DROP_TARGET_UNGROUNDED', 'Element drag/drop requires a target with rendered native drop evidence.', { targetElementRef: action.targetElementRef || null }));
    if (source && target && source.pageRef !== target.pageRef) problems.push(issue('HTML_DRAG_DROP_CROSS_PAGE', 'Element drag/drop source and target must exist on the same rendered page.', { sourceElementRef: action.sourceElementRef, targetElementRef: action.targetElementRef }));
  }
}

function validateAssertion(assertion, elements, problems) {
  const operation = op(assertion.operation);
  const element = assertion.elementRef ? elements.get(String(assertion.elementRef)) : null;
  const requireCapability = (capability) => {
    if (!element || !has(element, capability)) problems.push(issue('HTML_ASSERTION_CAPABILITY_MISMATCH', `${operation} requires discovered capability ${capability}.`, { elementRef: assertion.elementRef || null, capability }));
  };
  if (TEXT_ASSERTIONS.has(operation)) requireCapability('TEXT');
  if (HTML_ASSERTIONS.has(operation)) requireCapability('HTML');
  if (VALUE_ASSERTIONS.has(operation)) requireCapability('VALUE');
  if (CHECK_ASSERTIONS.has(operation)) requireCapability('CHECK');
  if (SELECT_ASSERTIONS.has(operation)) requireCapability('SELECT');
  if (INPUT_METADATA_ASSERTIONS.has(operation)) requireCapability('INPUT_METADATA');
  if (IMAGE_ASSERTIONS.has(operation)) requireCapability('IMAGE');
  if (['ASSERT_REQUIRED','ASSERT_OPTIONAL'].includes(operation)) requireCapability('REQUIRED_STATE');
  if (['ASSERT_READONLY','ASSERT_NOT_READONLY'].includes(operation)) requireCapability('READONLY_STATE');
  if (['ASSERT_VALID','ASSERT_INVALID'].includes(operation)) requireCapability('VALIDITY');
}

function validateHtmlCapabilityContract(ir = {}, registry = {}) {
  const elements = byRef(registry);
  const fixtures = configuredFixtures();
  const problems = [];
  for (const action of ir.actions || []) validateAction(action || {}, elements, fixtures, problems);
  for (const assertion of ir.assertions || []) validateAssertion(assertion || {}, elements, problems);
  return {
    ok: problems.length === 0,
    version: VERSION,
    reasonCode: problems[0]?.code || null,
    reason: problems[0]?.message || null,
    errors: problems,
  };
}

function assertHtmlRuntimePrerequisites(testCase = {}) {
  const fixtures = configuredFixtures();
  const problems = [];
  for (const action of testCase?.automationReadiness?.automationPlan?.actions || []) {
    const operation = op(action.operation);
    if (!['SELECT_FILE','DROP_FILE','SELECT_FILES','DROP_FILES'].includes(operation)) continue;
    for (const fileName of actionFiles(action)) {
      if (!fixtures.has(fileName)) problems.push(issue('HTML_FILE_FIXTURE_UNAVAILABLE', `${operation} fixture is no longer available immediately before execution: ${fileName}.`, { fileName }));
    }
  }
  if (problems.length) {
    const error = new Error(problems[0].message);
    error.code = problems[0].code;
    error.validationErrors = problems;
    throw error;
  }
}

module.exports = {
  VERSION,
  validateHtmlCapabilityContract,
  assertHtmlRuntimePrerequisites,
  fileAccepted,
  typeValueProblem,
  rangeProblem,
};

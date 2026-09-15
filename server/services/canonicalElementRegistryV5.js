const crypto = require('crypto');
const v4 = require('./canonicalElementRegistryV4');

const ACTION_CAPABILITY_REQUIREMENTS = Object.freeze({
  TYPE: 'TYPE',
  TYPE_RUNTIME_CREDENTIAL: 'TYPE',
  CLEAR: 'CLEAR',
  CLICK: 'CLICK',
  DBLCLICK: 'DBLCLICK',
  RIGHTCLICK: 'RIGHTCLICK',
  HOVER: 'HOVER',
  FOCUS: 'FOCUS',
  BLUR: 'BLUR',
  PRESS_KEY: 'PRESS_KEY',
  SELECT: 'SELECT',
  CHECK: 'CHECK',
  UNCHECK: 'UNCHECK',
  SUBMIT: 'SUBMIT',
  SCROLL_INTO_VIEW: 'SCROLL_INTO_VIEW',
  SELECT_FILE: 'SELECT_FILE',
  SELECT_FILES: 'SELECT_FILE',
  DROP_FILE: 'DROP_FILE',
  DROP_FILES: 'DROP_FILE',
  SET_RANGE_VALUE: 'SET_RANGE_VALUE',
  DRAG_DROP_SOURCE: 'DRAG_SOURCE',
  DRAG_DROP_TARGET: 'DROP_TARGET',
});

const ASSERTION_CAPABILITY_REQUIREMENTS = Object.freeze({
  text: 'TEXT',
  html: 'HTML',
  value: 'VALUE',
  checked: 'CHECK',
  selectedOption: 'SELECT',
  inputMetadata: 'INPUT_METADATA',
  requiredState: 'REQUIRED_STATE',
  readonlyState: 'READONLY_STATE',
  validity: 'VALIDITY',
  image: 'IMAGE',
});

function lower(value) { return String(value ?? '').trim().toLowerCase(); }
function normalizeBrowserType(entry = {}) {
  const tag = lower(entry.tag);
  const type = lower(entry.type);
  // Per HTML browser semantics, an <input> with a missing/invalid type behaves as
  // a text input. Older discovery snapshots used the fallback literal "input".
  if (tag === 'input' && (!type || type === 'input')) return 'text';
  return type || null;
}

function buildCanonicalElementRegistry(pageDiscoveries = []) {
  const base = v4.buildCanonicalElementRegistry(pageDiscoveries);
  const elements = (base.elements || []).map((entry) => {
    const normalized = { ...entry, type: normalizeBrowserType(entry) };
    normalized.capabilities = v4.capabilitiesFor(normalized);
    return normalized;
  });
  const registryCore = {
    version: 5,
    pages: base.pages || [],
    elements,
    capabilitySummary: v4.capabilitySummary(elements),
  };
  const registryHash = crypto.createHash('sha256').update(JSON.stringify(registryCore)).digest('hex');
  return { ...registryCore, registryHash };
}

function registryForModel(registry = {}) {
  const model = v4.registryForModel(registry);
  return {
    ...model,
    version: registry.version || 5,
    capabilityContract: {
      authoritative: true,
      rule: 'For every elementRef, use only actions/assertion families supported by that exact element capabilities array. Tag/role similarity is never permission to invent an operation. If the required capability is absent, do not substitute another element, selector, operation, value, option, path, file, or expected behavior.',
      actionRequirements: ACTION_CAPABILITY_REQUIREMENTS,
      assertionRequirements: ASSERTION_CAPABILITY_REQUIREMENTS,
      specialRules: [
        'SELECT is only for an element advertising SELECT; an ARIA/custom combobox is not a native select unless its capabilities explicitly include SELECT.',
        'UNCHECK requires UNCHECK; radio controls normally advertise CHECK but not UNCHECK.',
        'SET_RANGE_VALUE requires SET_RANGE_VALUE and must obey discovered min/max/step.',
        'SELECT_FILE/SELECT_FILES require approved runtime fixtures and SELECT_FILE. Multiple files additionally require the discovered multiple=true contract.',
        'DROP_FILE/DROP_FILES require a discovered DROP_FILE target.',
        'DRAG_DROP requires a DRAG_SOURCE source and DROP_TARGET target on the same rendered page.',
        'Headings, paragraphs, spans, divs and other content elements are read/assert targets unless their own capability list proves an interaction.',
        'Exact static expectations must come from discovered metadata or the explicit user-authored requirement; never manufacture expected values.',
      ],
    },
  };
}

module.exports = {
  ...v4,
  buildCanonicalElementRegistry,
  registryForModel,
  normalizeBrowserType,
  ACTION_CAPABILITY_REQUIREMENTS,
  ASSERTION_CAPABILITY_REQUIREMENTS,
};

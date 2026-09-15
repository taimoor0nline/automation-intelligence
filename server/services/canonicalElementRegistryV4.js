const crypto = require('crypto');
const v3 = require('./canonicalElementRegistryV3');

const CYPRESS_TYPEABLE_INPUT_TYPES = new Set([
  'text','password','email','number','date','week','month','time','datetime-local','search','url','tel',
]);
const CLICKABLE_ROLES = new Set(['button','link','checkbox','radio','switch','tab','menuitem','option','combobox','slider','spinbutton','treeitem']);
const FOCUSABLE_ROLES = new Set(['button','link','textbox','combobox','checkbox','radio','switch','tab','menuitem','option','slider','spinbutton','treeitem','searchbox']);
const NATIVE_CLICK_TAGS = new Set(['button','a','summary']);
const BUTTON_INPUT_TYPES = new Set(['button','submit','reset','image']);

function clean(value, max = 1200) { return String(value ?? '').trim().slice(0, max); }
function lower(value) { return clean(value, 120).toLowerCase(); }
function pagePath(page) {
  try {
    const url = new URL(page?.finalUrl || page?.url || 'http://testnexus.local/');
    return `${url.pathname}${url.search}` || '/';
  } catch { return '/'; }
}
function rawKey(path, selector) { return `${clean(path)}|${clean(selector)}`; }
function isNativeFormControl(item = {}) { return ['input','textarea','select','button'].includes(lower(item.tag || item.tagName)); }
function isTypeable(item = {}) {
  const tag = lower(item.tag || item.tagName);
  const type = lower(item.type);
  return tag === 'textarea' || item.contenteditable === true || lower(item.contenteditable) === 'true' || (tag === 'input' && CYPRESS_TYPEABLE_INPUT_TYPES.has(type || 'text'));
}
function hasFocusableTabIndex(item = {}) {
  if (item.tabIndex === null || item.tabIndex === undefined || item.tabIndex === '') return false;
  const value = Number(item.tabIndex);
  return Number.isFinite(value) && value >= 0;
}
function isFocusable(item = {}) {
  const tag = lower(item.tag || item.tagName);
  const type = lower(item.type);
  const role = lower(item.role);
  if (tag === 'input' && type === 'hidden') return false;
  return isNativeFormControl(item) || tag === 'a' || item.contenteditable === true || FOCUSABLE_ROLES.has(role) || hasFocusableTabIndex(item);
}
function isClickable(item = {}) {
  const tag = lower(item.tag || item.tagName);
  const type = lower(item.type);
  const role = lower(item.role);
  return NATIVE_CLICK_TAGS.has(tag) || BUTTON_INPUT_TYPES.has(type) || ['checkbox','radio'].includes(type) || CLICKABLE_ROLES.has(role) || item.clickEvidence === true;
}
function isTextBearing(item = {}) {
  const tag = lower(item.tag || item.tagName);
  if (item.text) return true;
  if (['input','textarea','select','option'].includes(tag)) return false;
  return !['img','picture','video','audio','canvas','iframe','object','embed'].includes(tag);
}
function isImage(item = {}) { return lower(item.tag || item.tagName) === 'img'; }
function isMedia(item = {}) { return ['video','audio'].includes(lower(item.tag || item.tagName)); }
function isNativeSelect(item = {}) { return lower(item.tag || item.tagName) === 'select'; }
function isFileInput(item = {}) { return lower(item.tag || item.tagName) === 'input' && lower(item.type) === 'file'; }
function isRangeInput(item = {}) { return lower(item.tag || item.tagName) === 'input' && lower(item.type) === 'range'; }
function isCheckable(item = {}) { return lower(item.tag || item.tagName) === 'input' && ['checkbox','radio'].includes(lower(item.type)); }
function isCheckbox(item = {}) { return lower(item.tag || item.tagName) === 'input' && lower(item.type) === 'checkbox'; }
function isSubmitTarget(item = {}) {
  const tag = lower(item.tag || item.tagName), type = lower(item.type);
  return tag === 'form' || ((tag === 'button' || tag === 'input') && type === 'submit');
}

function capabilitiesFor(item = {}) {
  if (item.kind === 'page-root') return ['ASSERT_EXISTS','ASSERT_VISIBLE','TEXT','HTML','ATTRIBUTES','LAYOUT'];
  const tag = lower(item.tag || item.tagName);
  const type = lower(item.type);
  const caps = new Set(['ASSERT_EXISTS','ASSERT_VISIBLE','ATTRIBUTES','LAYOUT','SCROLL_INTO_VIEW','HOVER']);

  if (isTextBearing(item)) { caps.add('TEXT'); caps.add('HTML'); }
  if (isImage(item)) { caps.add('IMAGE'); caps.add('TEXT'); }
  if (isMedia(item)) caps.add('MEDIA');
  if (isNativeFormControl(item) || item.contenteditable === true) {
    caps.add('VALUE');
    caps.add('ENABLED_STATE');
    if (tag !== 'button') caps.add('VALIDITY');
  }
  if (['input','textarea','select'].includes(tag)) {
    caps.add('REQUIRED_STATE');
    caps.add('READONLY_STATE');
    caps.add('INPUT_METADATA');
  }
  if (isFocusable(item)) { caps.add('FOCUS'); caps.add('BLUR'); caps.add('PRESS_KEY'); }
  if (isClickable(item)) { caps.add('CLICK'); caps.add('DBLCLICK'); caps.add('RIGHTCLICK'); }
  if (isTypeable(item) && item.disabled !== true && item.readonly !== true) { caps.add('TYPE'); caps.add('CLEAR'); }
  if (isNativeSelect(item)) caps.add('SELECT');
  if (isCheckable(item)) caps.add('CHECK');
  if (isCheckbox(item)) caps.add('UNCHECK');
  if (isSubmitTarget(item)) caps.add('SUBMIT');
  if (isFileInput(item)) {
    caps.add('SELECT_FILE');
    if (/image\//i.test(clean(item.accept)) || /\.(png|jpe?g|gif|webp|avif|bmp|svg)/i.test(clean(item.accept))) caps.add('IMAGE_UPLOAD');
  }
  if (item.fileDropTarget === true) caps.add('DROP_FILE');
  if (item.draggable === true) caps.add('DRAG_SOURCE');
  if (item.nativeDropTarget === true) caps.add('DROP_TARGET');
  if (isRangeInput(item)) caps.add('SET_RANGE_VALUE');
  if (tag === 'form') caps.add('FORM');
  if (tag === 'table') caps.add('TABLE');
  if (['ul','ol'].includes(tag)) caps.add('LIST');
  if (/^h[1-6]$/.test(tag)) caps.add('HEADING');
  if (tag === 'p') caps.add('PARAGRAPH');
  if (tag === 'a') caps.add('LINK');
  if (type === 'hidden') {
    for (const cap of ['CLICK','DBLCLICK','RIGHTCLICK','FOCUS','BLUR','PRESS_KEY','TYPE','CLEAR']) caps.delete(cap);
  }
  return [...caps].sort();
}

function normalizedOptions(raw = []) {
  return (Array.isArray(raw) ? raw : []).slice(0, 150).map((option) => ({
    value: clean(option?.value ?? option?.text ?? option?.label, 300),
    text: clean(option?.text ?? option?.label ?? option?.value, 300),
    disabled: option?.disabled === true,
    selected: option?.selected === true,
  })).filter((option) => option.value || option.text);
}

function buildRawMap(pageDiscoveries = []) {
  const map = new Map();
  for (const page of pageDiscoveries || []) {
    const path = pagePath(page);
    for (const item of [...(page?.elements || []), ...(page?.messages || [])]) {
      if (!item?.selector) continue;
      map.set(rawKey(path, item.selector), item);
    }
  }
  return map;
}

function decorateElement(entry, raw = null) {
  if (!raw || entry.kind === 'page-root') return { ...entry, capabilities: capabilitiesFor(entry) };
  const merged = {
    ...entry,
    role: lower(raw.role) || entry.role || null,
    visible: raw.visible === true ? true : raw.visible === false ? false : null,
    shadowDom: raw.shadowDom === true,
    shadowHostSelector: clean(raw.shadowHostSelector, 300) || null,
    inputmode: clean(raw.inputmode, 120) || null,
    list: clean(raw.list, 180) || null,
    step: raw.step ?? null,
    accept: clean(raw.accept, 1000) || null,
    capture: clean(raw.capture, 120) || null,
    multiple: raw.multiple === true,
    draggable: raw.draggable === true,
    nativeDropTarget: raw.nativeDropTarget === true,
    fileDropTarget: raw.fileDropTarget === true,
    clickEvidence: raw.clickEvidence === true,
    alt: clean(raw.alt, 1000) || null,
    src: clean(raw.src, 1600) || null,
    complete: raw.complete === true ? true : raw.complete === false ? false : null,
    naturalWidth: Number.isFinite(Number(raw.naturalWidth)) ? Number(raw.naturalWidth) : null,
    naturalHeight: Number.isFinite(Number(raw.naturalHeight)) ? Number(raw.naturalHeight) : null,
    mediaReadyState: Number.isFinite(Number(raw.mediaReadyState)) ? Number(raw.mediaReadyState) : null,
    duration: Number.isFinite(Number(raw.duration)) ? Number(raw.duration) : null,
    rangeValue: raw.rangeValue != null ? clean(raw.rangeValue, 100) : null,
    controlValue: ['checkbox','radio'].includes(lower(raw.type)) ? clean(raw.controlValue, 500) || null : null,
    ariaChecked: clean(raw.ariaChecked, 30) || null,
    ariaSelected: clean(raw.ariaSelected, 30) || null,
    ariaExpanded: clean(raw.ariaExpanded, 30) || null,
    options: normalizedOptions(raw.options?.length ? raw.options : entry.options),
  };
  merged.capabilities = capabilitiesFor(merged);
  return merged;
}

function capabilitySummary(elements = []) {
  const byCapability = {};
  const byInputType = {};
  for (const element of elements) {
    for (const capability of element.capabilities || []) byCapability[capability] = (byCapability[capability] || 0) + 1;
    if (lower(element.tag) === 'input') {
      const type = lower(element.type) || 'text';
      byInputType[type] = (byInputType[type] || 0) + 1;
    }
  }
  return { byCapability, byInputType, elementCount: elements.length };
}

function buildCanonicalElementRegistry(pageDiscoveries = []) {
  const base = v3.buildCanonicalElementRegistry(pageDiscoveries);
  const raw = buildRawMap(pageDiscoveries);
  const elements = (base.elements || []).map((entry) => decorateElement(entry, raw.get(rawKey(entry.path, entry.selector)) || null));
  const registryCore = { version: 4, pages: base.pages || [], elements, capabilitySummary: capabilitySummary(elements) };
  const registryHash = crypto.createHash('sha256').update(JSON.stringify(registryCore)).digest('hex');
  return { ...registryCore, registryHash };
}

function registryForModel(registry = {}) {
  return {
    version: registry.version || 4,
    registryHash: registry.registryHash || null,
    capabilitySummary: registry.capabilitySummary || capabilitySummary(registry.elements || []),
    pages: (registry.pages || []).map((page) => ({ pageRef: page.pageRef, path: page.path, title: page.title, origin: page.origin || null })),
    elements: (registry.elements || []).map((entry) => ({
      elementRef: entry.elementRef,
      pageRef: entry.pageRef,
      path: entry.path,
      kind: entry.kind,
      tag: entry.tag,
      type: entry.type,
      role: entry.role,
      label: entry.label,
      text: entry.text,
      ariaLabel: entry.ariaLabel,
      placeholder: entry.placeholder,
      autocomplete: entry.autocomplete,
      inputmode: entry.inputmode,
      contenteditable: entry.contenteditable,
      tabIndex: entry.tabIndex,
      checked: entry.checked,
      required: entry.required,
      disabled: entry.disabled,
      readonly: entry.readonly,
      visible: entry.visible,
      min: entry.min,
      max: entry.max,
      step: entry.step,
      minlength: entry.minlength,
      maxlength: entry.maxlength,
      pattern: entry.pattern,
      list: entry.list,
      accept: entry.accept,
      capture: entry.capture,
      multiple: entry.multiple,
      formId: entry.formId,
      formName: entry.formName,
      groupName: entry.groupName,
      groupLabel: entry.groupLabel,
      href: entry.href,
      destinationPath: entry.destinationPath,
      destinationOrigin: entry.destinationOrigin,
      target: entry.target,
      alt: entry.alt,
      src: entry.src,
      draggable: entry.draggable,
      nativeDropTarget: entry.nativeDropTarget,
      fileDropTarget: entry.fileDropTarget,
      shadowDom: entry.shadowDom,
      options: entry.options,
      capabilities: entry.capabilities,
      selectorStrategy: entry.selectorStrategy,
      selectorStability: entry.selectorStability,
      errorRef: entry.errorRef || null,
    })),
  };
}

module.exports = {
  ...v3,
  buildCanonicalElementRegistry,
  registryForModel,
  capabilitiesFor,
  capabilitySummary,
  CYPRESS_TYPEABLE_INPUT_TYPES,
};

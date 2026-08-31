const crypto = require('crypto');

function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function pagePath(page) {
  try {
    const url = new URL(page?.finalUrl || page?.url || 'http://testnexus.local/');
    return `${url.pathname}${url.search}` || '/';
  } catch {
    return '/';
  }
}

function selectorFor(item) {
  if (!item) return '';
  if (item.selector) return clean(item.selector, 300);
  if (item.testId) return `[data-testid="${clean(item.testId, 180)}"]`;
  if (item.id) return `#${clean(item.id, 180)}`;
  if (item.name) return `[name="${clean(item.name, 180)}"]`;
  return '';
}

function slug(value, fallback = 'element') {
  const normalized = clean(value, 180)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
  return normalized || fallback;
}

function identityToken(value) {
  return clean(value, 300).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function optionList(item = {}) {
  const raw = Array.isArray(item.options) ? item.options : [];
  return raw.slice(0, 100).map((option) => {
    if (option && typeof option === 'object') {
      return {
        value: clean(option.value ?? option.text ?? option.label, 300),
        text: clean(option.text ?? option.label ?? option.value, 300),
      };
    }
    return { value: clean(option, 300), text: clean(option, 300) };
  }).filter((option) => option.value || option.text);
}

function capabilitiesFor(item = {}) {
  const tag = clean(item.tag || item.tagName, 30).toLowerCase();
  const type = clean(item.type, 40).toLowerCase();
  const capabilities = new Set(['ASSERT_EXISTS', 'ASSERT_VISIBLE']);
  const isFormControl = ['input', 'textarea', 'select'].includes(tag);
  const nonTypeableInputTypes = new Set(['checkbox','radio','file','button','submit','reset','image','hidden']);
  const isTypeable = tag === 'textarea' || (tag === 'input' && !nonTypeableInputTypes.has(type));
  const textLike = !isFormControl || ['button', 'submit'].includes(type);

  if (textLike || item.text) capabilities.add('TEXT');
  if (isFormControl) {
    capabilities.add('VALUE');
    capabilities.add('VALIDITY');
  }
  if (isTypeable) capabilities.add('TYPE');
  if (tag === 'select') capabilities.add('SELECT');
  if (type === 'checkbox' || type === 'radio') capabilities.add('CHECK');
  if (tag === 'button' || type === 'button' || type === 'submit' || type === 'checkbox' || type === 'radio' || item.href) capabilities.add('CLICK');
  if (type === 'file') capabilities.add('SELECT_FILE');
  if (item.required !== undefined) capabilities.add('REQUIRED_STATE');
  return [...capabilities].sort();
}

function aliasesFor(item = {}, selector = '') {
  return [...new Set([
    selector,
    item.testId,
    item.id,
    item.name,
    item.label,
    item.ariaLabel,
    item.placeholder,
    item.text,
    item.groupLabel,
  ].map((value) => clean(value, 300)).filter(Boolean))];
}

function preferredIdentity(item = {}, selector = '', kind = 'element') {
  return item.testId || item.id || item.name || item.label || item.ariaLabel || item.placeholder || item.text || selector || kind;
}

function sameErrorIdentity(control, error) {
  const bases = [control.name, control.testId, control.id, control.groupName]
    .map(identityToken)
    .filter(Boolean);
  const errors = [error.testId, error.id, error.name, error.elementRef]
    .map(identityToken)
    .filter(Boolean);
  return bases.some((base) => errors.some((candidate) => candidate === `${base}error` || candidate.endsWith(`${base}error`)));
}

function linkValidationErrors(elements) {
  const errorEntries = elements.filter((entry) => {
    const signature = [entry.kind, entry.elementRef, entry.testId, entry.id, entry.name].filter(Boolean).join(' ').toLowerCase();
    return entry.kind === 'validation-error' || /error|validation/.test(signature);
  });

  for (const control of elements) {
    if (control.errorRef || !['input','textarea','select'].includes(control.tag)) continue;
    const match = errorEntries.find((error) => error.pageRef === control.pageRef && sameErrorIdentity(control, error));
    if (match) control.errorRef = match.elementRef;
  }

  const grouped = new Map();
  for (const control of elements) {
    if (!['checkbox','radio'].includes(control.type) || !control.name) continue;
    const key = `${control.pageRef}|${control.formId || ''}|${control.name}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(control);
  }
  for (const group of grouped.values()) {
    const direct = group.find((item) => item.errorRef)?.errorRef || null;
    const inferred = direct || errorEntries.find((error) => error.pageRef === group[0]?.pageRef && sameErrorIdentity(group[0], error))?.elementRef || null;
    if (inferred) group.forEach((item) => { item.errorRef ||= inferred; });
  }
}

function buildCanonicalElementRegistry(pageDiscoveries = []) {
  const elements = [];
  const pages = [];
  const selectorToRef = new Map();
  const usedRefs = new Set();

  function uniqueRef(base, prefix = 'el') {
    const root = `${prefix}_${slug(base, prefix)}`;
    let candidate = root;
    let suffix = 2;
    while (usedRefs.has(candidate)) candidate = `${root}_${suffix++}`;
    usedRefs.add(candidate);
    return candidate;
  }

  function register(item, page, kind = 'element', preferredPrefix = 'el') {
    if (!item || typeof item !== 'object') return null;
    const selector = selectorFor(item);
    if (!selector) return null;
    if (selectorToRef.has(selector)) return selectorToRef.get(selector);
    const elementRef = uniqueRef(preferredIdentity(item, selector, kind), preferredPrefix);
    const entry = {
      elementRef,
      selector,
      pageRef: page.pageRef,
      path: page.path,
      kind,
      tag: clean(item.tag || item.tagName, 40).toLowerCase() || null,
      type: clean(item.type, 60).toLowerCase() || null,
      testId: clean(item.testId, 180) || null,
      id: clean(item.id, 180) || null,
      name: clean(item.name, 180) || null,
      label: clean(item.label, 300) || null,
      text: clean(item.text, 500) || null,
      ariaLabel: clean(item.ariaLabel, 300) || null,
      placeholder: clean(item.placeholder, 300) || null,
      required: item.required === true ? true : item.required === false ? false : null,
      disabled: item.disabled === true ? true : item.disabled === false ? false : null,
      min: item.min ?? null,
      max: item.max ?? null,
      minlength: item.minlength ?? item.minLength ?? null,
      maxlength: item.maxlength ?? item.maxLength ?? null,
      pattern: clean(item.pattern, 300) || null,
      formId: clean(item.formId, 180) || null,
      formName: clean(item.formName, 180) || null,
      formAction: clean(item.formAction, 500) || null,
      formMethod: clean(item.formMethod, 20).toUpperCase() || null,
      groupName: clean(item.groupName, 180) || null,
      groupLabel: clean(item.groupLabel, 300) || null,
      options: optionList(item),
      aliases: aliasesFor(item, selector),
      capabilities: capabilitiesFor(item),
    };
    elements.push(entry);
    selectorToRef.set(selector, elementRef);
    return elementRef;
  }

  for (let index = 0; index < (pageDiscoveries || []).length; index += 1) {
    const rawPage = pageDiscoveries[index] || {};
    const path = pagePath(rawPage);
    const pageRef = uniqueRef(path === '/' ? 'root' : path, 'page');
    const page = {
      pageRef,
      path,
      url: clean(rawPage.finalUrl || rawPage.url, 1200) || null,
      title: clean(rawPage.title || rawPage.pageTitle, 300) || null,
    };
    pages.push(page);

    for (const item of rawPage.elements || []) {
      const elementRef = register(item, page, 'element', 'el');
      if (item?.errorElement) {
        const errorRef = register({ ...item.errorElement, formId: item.formId || item.errorElement.formId, groupName: item.groupName || item.errorElement.groupName }, page, 'validation-error', 'err');
        const owner = elements.find((entry) => entry.elementRef === elementRef);
        if (owner && errorRef) owner.errorRef = errorRef;
      }
    }
    for (const message of rawPage.messages || []) register(message, page, 'message', 'msg');
  }

  linkValidationErrors(elements);

  const registryCore = {
    version: 1,
    pages,
    elements,
  };
  const registryHash = crypto.createHash('sha256').update(JSON.stringify(registryCore)).digest('hex');
  return { ...registryCore, registryHash };
}

function registryIndex(registry = {}) {
  return {
    byRef: new Map((registry.elements || []).map((entry) => [entry.elementRef, entry])),
    bySelector: new Map((registry.elements || []).map((entry) => [entry.selector, entry])),
    paths: new Set((registry.pages || []).map((page) => page.path)),
  };
}

function registryForModel(registry = {}) {
  return {
    version: registry.version || 1,
    registryHash: registry.registryHash || null,
    pages: (registry.pages || []).map((page) => ({ pageRef: page.pageRef, path: page.path, title: page.title })),
    elements: (registry.elements || []).map((entry) => ({
      elementRef: entry.elementRef,
      pageRef: entry.pageRef,
      path: entry.path,
      kind: entry.kind,
      tag: entry.tag,
      type: entry.type,
      label: entry.label,
      text: entry.text,
      ariaLabel: entry.ariaLabel,
      placeholder: entry.placeholder,
      required: entry.required,
      min: entry.min,
      max: entry.max,
      minlength: entry.minlength,
      maxlength: entry.maxlength,
      pattern: entry.pattern,
      formId: entry.formId,
      formName: entry.formName,
      groupName: entry.groupName,
      groupLabel: entry.groupLabel,
      options: entry.options,
      capabilities: entry.capabilities,
      errorRef: entry.errorRef || null,
    })),
  };
}

module.exports = {
  buildCanonicalElementRegistry,
  registryIndex,
  registryForModel,
  selectorFor,
  pagePath,
  capabilitiesFor,
  linkValidationErrors,
};

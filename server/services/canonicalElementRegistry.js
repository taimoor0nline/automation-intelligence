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
  const textLike = !['input', 'textarea', 'select'].includes(tag) || ['button', 'submit'].includes(type);
  if (textLike || item.text || item.label || item.ariaLabel) capabilities.add('TEXT');
  if (tag === 'input' || tag === 'textarea' || tag === 'select') capabilities.add('VALUE');
  if (tag === 'input' || tag === 'textarea') capabilities.add('TYPE');
  if (tag === 'select') capabilities.add('SELECT');
  if (type === 'checkbox' || type === 'radio') capabilities.add('CHECK');
  if (tag === 'button' || type === 'button' || type === 'submit' || type === 'checkbox' || type === 'radio' || item.href) capabilities.add('CLICK');
  if (type === 'file') capabilities.add('SELECT_FILE');
  if (item.required !== undefined) capabilities.add('REQUIRED_STATE');
  if (item.min !== undefined || item.max !== undefined || item.minlength !== undefined || item.maxlength !== undefined || item.pattern) capabilities.add('VALIDITY');
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
  ].map((value) => clean(value, 300)).filter(Boolean))];
}

function preferredIdentity(item = {}, selector = '', kind = 'element') {
  return item.testId || item.id || item.name || item.label || item.ariaLabel || item.placeholder || item.text || selector || kind;
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
      title: clean(rawPage.title, 300) || null,
    };
    pages.push(page);

    for (const item of rawPage.elements || []) {
      const elementRef = register(item, page, 'element', 'el');
      if (item?.errorElement) {
        const errorRef = register(item.errorElement, page, 'validation-error', 'err');
        const owner = elements.find((entry) => entry.elementRef === elementRef);
        if (owner && errorRef) owner.errorRef = errorRef;
      }
    }
    for (const message of rawPage.messages || []) register(message, page, 'message', 'msg');
  }

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
};

const GLOBAL_ELEMENT_CAPABILITIES = ['VISIBLE','HIDDEN','EXISTS'];

function add(set, ...values) {
  for (const value of values) if (value) set.add(value);
}

function capabilitiesForElement(element = {}) {
  const tag = String(element.tag || '').toLowerCase();
  const type = String(element.type || '').toLowerCase();
  const role = String(element.role || '').toLowerCase();
  const capabilities = new Set(GLOBAL_ELEMENT_CAPABILITIES);

  // Text/markup are meaningful for content-bearing elements and controls with labels/text.
  if (element.text != null || element.label != null || ['div','span','p','label','button','a','h1','h2','h3','td','th','li','option'].includes(tag)) {
    add(capabilities, 'TEXT', 'HTML');
  }

  if (tag === 'input' || tag === 'textarea') {
    add(capabilities, 'VALUE', 'VALUE_EMPTY', 'VALUE_NON_EMPTY', 'ENABLED', 'DISABLED', 'FOCUSED', 'REQUIRED', 'OPTIONAL', 'READONLY', 'EDITABLE');
    if (!['button','submit','reset','image','hidden'].includes(type)) add(capabilities, 'VALID', 'INVALID');
    if (element.min != null) add(capabilities, 'MIN');
    if (element.max != null) add(capabilities, 'MAX');
    if (element.minlength != null) add(capabilities, 'MIN_LENGTH');
    if (element.maxlength != null) add(capabilities, 'MAX_LENGTH');
    if (element.pattern != null) add(capabilities, 'PATTERN');
    if (element.placeholder != null) add(capabilities, 'PLACEHOLDER');
  }

  if (type === 'checkbox' || type === 'radio') {
    add(capabilities, 'CHECKED', 'UNCHECKED', 'ENABLED', 'DISABLED', 'REQUIRED', 'OPTIONAL');
  }

  if (tag === 'select' || type === 'select') {
    add(capabilities, 'SELECTED_VALUE', 'SELECTED_TEXT', 'OPTION_COUNT', 'VALUE', 'ENABLED', 'DISABLED', 'REQUIRED', 'OPTIONAL', 'VALID', 'INVALID');
  }

  if (tag === 'button' || role === 'button' || type === 'button' || type === 'submit' || type === 'reset') {
    add(capabilities, 'ENABLED', 'DISABLED', 'FOCUSED', 'TEXT');
  }

  if (tag === 'a' || role === 'link' || type === 'link') {
    add(capabilities, 'TEXT', 'HREF', 'ENABLED');
  }

  if (tag === 'img') add(capabilities, 'IMAGE_LOADED', 'IMAGE_ALT', 'WIDTH', 'HEIGHT');
  if (tag === 'table') add(capabilities, 'COUNT', 'TEXT', 'HTML');

  if (element.className != null) add(capabilities, 'CLASS', 'CSS');
  if (element.ariaLabel != null || element.ariaDescribedBy != null || role) add(capabilities, 'ARIA');
  if (element.id || element.testId || element.name) add(capabilities, 'ATTRIBUTE', 'PROPERTY');

  return [...capabilities];
}

function annotateElement(element) {
  if (!element || typeof element !== 'object') return element;
  const annotated = { ...element, capabilities: capabilitiesForElement(element) };
  if (element.errorElement) annotated.errorElement = annotateElement(element.errorElement);
  return annotated;
}

function annotatePageDiscovery(page = {}) {
  return {
    ...page,
    elements: (page.elements || []).map(annotateElement),
    messages: (page.messages || []).map(annotateElement),
  };
}

function buildWebCapabilityMatrix(pageDiscoveries = []) {
  const pages = [];
  const capabilityCounts = new Map();
  let elementCount = 0;
  for (const page of pageDiscoveries || []) {
    const annotated = annotatePageDiscovery(page);
    const elements = [];
    const seen = new Set();
    const register = (element) => {
      const selector = String(element?.selector || '').trim();
      if (!selector || seen.has(selector)) return;
      seen.add(selector);
      elementCount += 1;
      for (const capability of element.capabilities || []) capabilityCounts.set(capability, (capabilityCounts.get(capability) || 0) + 1);
      elements.push({
        selector,
        tag: element.tag || null,
        type: element.type || null,
        label: element.label || element.text || element.ariaLabel || null,
        capabilities: [...(element.capabilities || [])],
      });
    };
    for (const element of annotated.elements || []) {
      register(element);
      if (element?.errorElement) register(element.errorElement);
    }
    for (const message of annotated.messages || []) register(message);
    pages.push({ url: annotated.finalUrl || annotated.url || null, elements });
  }
  return {
    version: 1,
    pageCount: pages.length,
    elementCount,
    capabilities: [...capabilityCounts.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([capability, count]) => ({ capability, count })),
    pages,
  };
}

function supportsCapability(element, capability) {
  if (!capability) return true;
  const capabilities = Array.isArray(element?.capabilities) ? element.capabilities : capabilitiesForElement(element);
  return capabilities.includes(capability);
}

module.exports = {
  GLOBAL_ELEMENT_CAPABILITIES,
  capabilitiesForElement,
  annotateElement,
  annotatePageDiscovery,
  buildWebCapabilityMatrix,
  supportsCapability,
};
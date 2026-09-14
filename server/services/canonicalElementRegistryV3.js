const crypto = require('crypto');
const v2 = require('./canonicalElementRegistryV2');

function pageRootRef(pageRef, index) {
  const base = String(pageRef || `page_${index + 1}`).replace(/[^A-Za-z0-9_-]+/g, '-');
  return `${base}_root`;
}

function buildCanonicalElementRegistry(pageDiscoveries = []) {
  const registry = v2.buildCanonicalElementRegistry(pageDiscoveries);
  const existingRefs = new Set((registry.elements || []).map((item) => String(item.elementRef || '')));
  const roots = [];

  for (let index = 0; index < (registry.pages || []).length; index += 1) {
    const page = registry.pages[index];
    const elementRef = pageRootRef(page.pageRef, index);
    if (existingRefs.has(elementRef)) continue;
    roots.push({
      elementRef,
      selector: 'body',
      pageRef: page.pageRef,
      path: page.path,
      kind: 'page-root',
      tag: 'body',
      type: 'document-root',
      testId: null,
      id: null,
      name: null,
      label: page.title || 'Page body',
      text: null,
      ariaLabel: null,
      placeholder: null,
      required: null,
      disabled: null,
      min: null,
      max: null,
      minlength: null,
      maxlength: null,
      pattern: null,
      formId: null,
      formName: null,
      formAction: null,
      formMethod: null,
      groupName: null,
      groupLabel: null,
      options: [],
      aliases: ['body', page.path, page.title].filter(Boolean),
      // Page-root capabilities are deliberately read-only. They permit grounded
      // page/content assertions but never typing/clicking invented controls.
      capabilities: ['ASSERT_EXISTS', 'ASSERT_VISIBLE', 'TEXT'],
      selectorStrategy: 'FRAMEWORK_PAGE_ROOT',
      selectorStability: 'HIGH',
    });
  }

  const elements = [...(registry.elements || []), ...roots];
  const registryCore = {
    version: 2,
    pages: registry.pages || [],
    elements,
  };
  const registryHash = crypto.createHash('sha256').update(JSON.stringify(registryCore)).digest('hex');
  return { ...registryCore, registryHash };
}

module.exports = {
  ...v2,
  buildCanonicalElementRegistry,
};

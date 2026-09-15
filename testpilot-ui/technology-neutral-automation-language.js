(function () {
  if (window.__testNexusTechnologyNeutralAutomationLanguage) return;
  window.__testNexusTechnologyNeutralAutomationLanguage = true;

  const phraseRules = [
    [/Edit Cypress Syntax/gi, 'Edit Automation Script'],
    [/Cypress Preview/gi, 'Automation Script Preview'],
    [/Cypress-style commands?/gi, 'automation commands'],
    [/Cypress commands?/gi, 'automation commands'],
    [/Cypress assertions?/gi, 'automation assertions'],
    [/Cypress syntax/gi, 'Automation Script syntax'],
    [/Cypress projection/gi, 'automation script projection'],
    [/Cypress artifact/gi, 'executable automation artifact'],
    [/Cypress execution contract/gi, 'automation execution contract'],
    [/Cypress approach/gi, 'automation approach'],
    [/strict Cypress/gi, 'strict automation'],
    [/CYPRESS_/g, 'AUTOMATION_'],
    [/Cypress/gi, 'Automation Engine'],
  ];

  function neutralize(value) {
    let output = String(value ?? '');
    for (const [pattern, replacement] of phraseRules) output = output.replace(pattern, replacement);
    return output;
  }

  function scrubText(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE) return;
    const next = neutralize(node.nodeValue);
    if (next !== node.nodeValue) node.nodeValue = next;
  }

  function scrubElement(element) {
    if (!(element instanceof Element)) return;
    for (const attr of ['title', 'aria-label', 'placeholder', 'data-tooltip']) {
      if (!element.hasAttribute(attr)) continue;
      const current = element.getAttribute(attr);
      const next = neutralize(current);
      if (next !== current) element.setAttribute(attr, next);
    }
    if (element instanceof HTMLInputElement && ['button', 'submit'].includes(String(element.type || '').toLowerCase())) {
      const next = neutralize(element.value);
      if (next !== element.value) element.value = next;
    }
  }

  function scrubTree(root) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) return scrubText(root);
    if (root.nodeType === Node.ELEMENT_NODE) scrubElement(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.TEXT_NODE) scrubText(node);
      else scrubElement(node);
    }
  }

  scrubTree(document.body || document.documentElement);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') scrubText(mutation.target);
      for (const node of mutation.addedNodes || []) scrubTree(node);
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  window.testNexusNeutralizeAutomationLanguage = neutralize;
})();

(function () {
  if (window.__testNexusJourneyFormOrder) return;
  window.__testNexusJourneyFormOrder = true;

  function fieldFor(id) {
    return document.getElementById(id)?.closest('.field') || null;
  }

  function environmentBlock() {
    const field = fieldFor('environment');
    if (!field) return null;
    const parent = field.parentElement;
    // Environment historically shared a two-column wrapper with the now-hidden
    // legacy username field. Keep the wrapper so existing compatibility code is
    // untouched while presenting Environment as a full-width first control.
    return parent?.classList?.contains('two') ? parent : field;
  }

  function applicationLoginField() {
    const knownIds = [
      'applicationLogin', 'applicationLoginMode', 'loginMode',
      'loginRequirement', 'authenticationMode', 'authMode',
    ];
    for (const id of knownIds) {
      const select = document.getElementById(id);
      if (select?.tagName === 'SELECT') return select.closest('.field') || select.parentElement;
    }

    for (const select of document.querySelectorAll('select')) {
      const labels = [...(select.labels || [])].map((label) => label.textContent || '').join(' ');
      const fieldLabel = select.closest?.('.field')?.querySelector?.('label')?.textContent || '';
      const optionText = [...(select.options || [])].map((option) => option.textContent || '').join(' ');
      if (/application login|login requirement|authentication/i.test(`${labels} ${fieldLabel}`)
        || /no\s+login\s+required/i.test(optionText)) {
        return select.closest('.field') || select.parentElement;
      }
    }
    return null;
  }

  function modelField() {
    const direct = fieldFor('aiModelTier');
    if (direct) return direct;
    return [...document.querySelectorAll('.field')].find((field) =>
      /ai\s+quality\s+profile/i.test(field.querySelector('label')?.textContent || '')
    ) || null;
  }

  function moveIntoOrder() {
    const form = document.querySelector('aside.panel.pad');
    const heading = form?.querySelector(':scope > .section-head');
    if (!form || !heading) return false;

    const nodes = [
      environmentBlock(),
      modelField(),
      fieldFor('targetUrl'),
      fieldFor('additionalPaths'),
      applicationLoginField(),
      document.getElementById('testActorPanel'),
      fieldFor('story'),
    ].filter(Boolean);

    // Remove duplicates in case a compatibility wrapper contains a matched field.
    const unique = nodes.filter((node, index) => nodes.indexOf(node) === index);

    // Insert in reverse so the final visible order immediately after the section
    // heading is exactly the order above. Other generation controls remain below
    // Business user story in their existing relative order.
    for (const node of [...unique].reverse()) {
      heading.insertAdjacentElement('afterend', node);
    }

    return Boolean(
      document.getElementById('environment')
      && document.getElementById('aiModelTier')
      && document.getElementById('targetUrl')
      && document.getElementById('additionalPaths')
    );
  }

  window.syncTestNexusJourneyFormOrder = moveIntoOrder;

  // The form is assembled by several small asynchronous UI modules. Bounded
  // retries keep it ordered without a permanent whole-document MutationObserver.
  [0, 60, 150, 300, 600, 1000, 1600, 2400, 3600, 5000].forEach((delay) => {
    setTimeout(moveIntoOrder, delay);
  });

  document.addEventListener('change', (event) => {
    if (event.target?.tagName === 'SELECT') setTimeout(moveIntoOrder, 0);
  });
})();
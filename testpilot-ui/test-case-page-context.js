(function () {
  if (window.__testNexusTestPageContext) return;
  window.__testNexusTestPageContext = true;

  const style = document.createElement('style');
  style.textContent = `
    .test-case-page-context{display:flex;align-items:flex-start;gap:5px;flex-wrap:wrap;margin-top:5px;font-size:10px;color:#64748b;min-width:0}
    .test-case-page-context strong{color:#475569;font-weight:800;flex:0 0 auto}
    .test-case-page-context a{display:inline-block;max-width:100%;color:#3157c8;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:bottom}
    .test-case-page-context a:hover{text-decoration:underline}
    .automation-page-context{padding:10px 14px;border-bottom:1px solid #eef1f6;background:#fbfdff}
    .automation-page-context h4{margin:0 0 6px;font-size:11px;color:#334155}
    .automation-page-context-list{display:flex;flex-direction:column;gap:4px;font-size:10.5px}
    .automation-page-context-list a{color:#3157c8;text-decoration:none;word-break:break-all}
    .automation-page-context-list a:hover{text-decoration:underline}
  `;
  document.head.appendChild(style);

  function getCases() {
    try {
      if (typeof testCases !== 'undefined' && Array.isArray(testCases)) return testCases;
    } catch {}
    return Array.isArray(window.testCases) ? window.testCases : [];
  }

  function targetUrl() {
    return String(document.getElementById('targetUrl')?.value || '').trim();
  }

  function absoluteUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    try { return new URL(raw, targetUrl() || window.location.origin).toString(); }
    catch { return null; }
  }

  function pageUrls(tc) {
    const urls = [];
    const add = (value) => {
      const url = absoluteUrl(value);
      if (url && !urls.includes(url)) urls.push(url);
    };

    for (const value of Array.isArray(tc?.pageUrls) ? tc.pageUrls : []) add(value);
    add(tc?.pageUrl);

    const ir = tc?.canonicalIr || {};
    for (const action of Array.isArray(ir.actions) ? ir.actions : []) {
      if (String(action?.operation || '').toUpperCase() === 'NAVIGATE') add(action.path || action.value);
    }
    for (const assertion of Array.isArray(ir.assertions) ? ir.assertions : []) {
      const op = String(assertion?.operation || '').toUpperCase();
      if (op === 'ASSERT_PATH_EQUALS') add(assertion.path || assertion.value);
      if (op === 'ASSERT_URL_EQUALS') add(assertion.url || assertion.value);
    }

    // Legacy/manual structured steps can still contribute an explicit navigation path.
    for (const step of Array.isArray(tc?.steps) ? tc.steps : []) {
      if (/navigate|visit|open/i.test(String(step?.action || ''))) add(step?.value || step?.target);
    }

    if (!urls.length) add(targetUrl());
    return urls.slice(0, 8);
  }

  function idFromCard(card) {
    const text = card.querySelector('.case-title,.generation-case-preview-title')?.textContent || '';
    return text.match(/\bTC\d+\b/i)?.[0]?.toUpperCase() || null;
  }

  function caseForCard(card, index) {
    const cases = getCases();
    const id = idFromCard(card);
    return (id && cases.find((tc) => String(tc?.id || '').toUpperCase() === id)) || cases[index] || null;
  }

  function linkHtml(url) {
    const escaped = String(url).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return `<a href="${escaped}" target="_blank" rel="noopener" title="${escaped}">${escaped}</a>`;
  }

  function decorateCards() {
    const cards = [...document.querySelectorAll('#cases .case,#cases .generation-case-preview')];
    cards.forEach((card, index) => {
      const tc = caseForCard(card, index);
      if (!tc) return;
      const urls = pageUrls(tc);
      const signature = urls.join('|');
      let row = card.querySelector('.test-case-page-context');
      if (!row) {
        row = document.createElement('div');
        row.className = 'test-case-page-context';
        const title = card.querySelector('.case-title,.generation-case-preview-title');
        if (title) title.insertAdjacentElement('afterend', row);
        else card.prepend(row);
      }
      if (row.dataset.signature === signature) return;
      row.dataset.signature = signature;
      row.innerHTML = `<strong>${urls.length > 1 ? 'Pages:' : 'Page:'}</strong>${urls.map(linkHtml).join('<span>·</span>')}`;
    });
  }

  function currentCase() {
    const id = String(document.getElementById('editId')?.value || '').trim();
    const cases = getCases();
    if (id) {
      const byId = cases.find((tc) => String(tc?.id || '') === id);
      if (byId) return byId;
    }
    const index = Number(document.getElementById('editIndex')?.value ?? -1);
    return index >= 0 ? cases[index] || null : null;
  }

  function decorateAutomationDetails() {
    const view = document.getElementById('editorAutomationView');
    const tc = currentCase();
    if (!view || !tc) return;
    const urls = pageUrls(tc);
    const signature = `${tc.id || ''}|${urls.join('|')}`;
    let section = view.querySelector('.automation-page-context');
    if (!section) {
      section = document.createElement('div');
      section.className = 'automation-page-context';
      const head = view.querySelector('.automation-head');
      if (head) head.insertAdjacentElement('afterend', section);
      else view.prepend(section);
    }
    if (section.dataset.signature === signature) return;
    section.dataset.signature = signature;
    section.innerHTML = `<h4>${urls.length > 1 ? 'Page URLs' : 'Page URL'}</h4><div class="automation-page-context-list">${urls.map(linkHtml).join('')}</div>`;
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      decorateCards();
      decorateAutomationDetails();
    }, 20);
  }

  const casesRoot = document.getElementById('cases');
  if (casesRoot) new MutationObserver(schedule).observe(casesRoot, { childList: true, subtree: true });
  const modal = document.getElementById('editorModal');
  if (modal) {
    new MutationObserver(schedule).observe(modal, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });
    modal.addEventListener('click', schedule);
  }
  document.getElementById('targetUrl')?.addEventListener('change', schedule);
  schedule();
})();

(function () {
  const CATEGORIES = [
    'FUNCTIONAL','SMOKE','REGRESSION','SECURITY','PERFORMANCE','ACCESSIBILITY',
    'INTEGRATION','API','UI','COMPATIBILITY','LOAD','STRESS','CUSTOM'
  ];

  function normalize(value) {
    const v = String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
    return CATEGORIES.includes(v) ? v : 'FUNCTIONAL';
  }

  function inferCategory(tc) {
    const explicit = String(tc?.testCategory || tc?.category || tc?.testData?.__testCategory || '').trim();
    if (explicit) return normalize(explicit);
    const text = `${tc?.title || ''}\n${(tc?.preconditions || []).join(' ')}\n${(tc?.expectedResults || []).join(' ')}`.toLowerCase();
    if (/\bstress\b|peak\s+concurrency|breaking\s+point|saturation/.test(text)) return 'STRESS';
    if (/\bload\s+test|concurrent\s+users?|virtual\s+users?|requests?\s+per\s+second|\brps\b|throughput/.test(text)) return 'LOAD';
    if (/\bsecurity\b|authorization|access\s+control|xss|cross[- ]site|sql\s+injection|csrf|session\s+security|secure\s+cookie|security\s+header/.test(text)) return 'SECURITY';
    if (/\bperformance\b|response\s+time|page\s+load|latency|web\s+vitals?|largest\s+contentful|\blcp\b|\bfcp\b/.test(text)) return 'PERFORMANCE';
    if (/\baccessibility\b|\ba11y\b|\bwcag\b|keyboard\s+navigation|screen\s+reader|aria/.test(text)) return 'ACCESSIBILITY';
    if (/\bintegration\b|service\s+integration|system\s+integration|cross[- ]service/.test(text)) return 'INTEGRATION';
    if (/\bapi\b|endpoint|request\s+body|response\s+body|http\s+status/.test(text)) return 'API';
    if (/\bcompatibility\b|cross[- ]browser|browser\s+compatibility|device\s+compatibility/.test(text)) return 'COMPATIBILITY';
    if (/\buser interface\b|\bui\b|layout|visual\s+state/.test(text)) return 'UI';
    if (/\bsmoke\b|\bsanity\b|critical\s+path|health\s+check|basic\s+availability/.test(text)) return 'SMOKE';
    if (/\bregression\b|previously\s+working|existing\s+behavior|existing\s+behaviour/.test(text)) return 'REGRESSION';
    return 'FUNCTIONAL';
  }

  function casesArray() {
    try {
      if (Array.isArray(window.testCases)) return window.testCases;
      if (typeof testCases !== 'undefined' && Array.isArray(testCases)) return testCases;
    } catch {}
    return [];
  }

  function ensureStyle() {
    if (document.getElementById('testCategoryStyle')) return;
    const style = document.createElement('style');
    style.id = 'testCategoryStyle';
    style.textContent = `
      .test-classification-row{grid-template-columns:repeat(3,minmax(0,1fr))!important;align-items:start}
      .test-classification-row>.field,.test-classification-row>.test-category-field{margin-top:13px}
      .test-category-field label{display:flex;align-items:center;gap:6px;margin-bottom:6px;color:#4b5563;font-size:12px;font-weight:700}
      .test-category-field select{width:100%;border:1px solid var(--border);border-radius:9px;padding:10px 11px;background:#fff}
      .test-category-field small{display:block;color:var(--muted);margin-top:5px;font-size:10.5px;line-height:1.45}
      .tag.test-category{font-weight:800;background:#eef2ff;color:#3730a3}
      .tag.category-security{background:#fee2e2;color:#991b1b}
      .tag.category-smoke{background:#ecfdf5;color:#047857}
      .tag.category-regression{background:#fff7ed;color:#9a3412}
      .tag.category-performance,.tag.category-load,.tag.category-stress{background:#fef3c7;color:#92400e}
      .tag.category-accessibility{background:#f3e8ff;color:#7e22ce}
      .tag.category-api,.tag.category-integration{background:#e0f2fe;color:#075985}
      .tag.category-ui,.tag.category-compatibility{background:#f1f5f9;color:#334155}
      @media(max-width:760px){.test-classification-row{grid-template-columns:1fr!important}}
    `;
    document.head.appendChild(style);
  }

  function relabelScenarioType() {
    const type = document.getElementById('editType');
    const label = type?.closest('.field')?.querySelector('label');
    if (label) label.textContent = 'Scenario Type';
  }

  function ensureEditorField() {
    const modal = document.getElementById('editorModal');
    if (!modal) return;
    relabelScenarioType();
    if (document.getElementById('editTestCategory')) return;

    const type = document.getElementById('editType');
    const priority = document.getElementById('editPriority');
    const row = type?.closest('.two') || priority?.closest('.two');
    if (!row) return;
    row.classList.add('test-classification-row');

    const field = document.createElement('div');
    field.className = 'test-category-field';
    field.innerHTML = `<label for="editTestCategory">Test Category</label><select id="editTestCategory">${CATEGORIES.map(x => `<option value="${x}">${x.replaceAll('_',' ')}</option>`).join('')}</select><small>Testing purpose; separate from Scenario Type and Priority.</small>`;
    row.appendChild(field);

    const select = field.querySelector('select');
    select.addEventListener('change', () => {
      const id = document.getElementById('editId')?.value;
      const tc = casesArray().find(x => String(x?.id || '') === String(id || ''));
      if (tc) tc.testCategory = normalize(select.value);
    });
  }

  function currentCase() {
    const id = document.getElementById('editId')?.value;
    return casesArray().find(x => String(x?.id || '') === String(id || '')) || null;
  }

  function syncEditorCategory() {
    const select = document.getElementById('editTestCategory');
    if (!select) return;
    const tc = currentCase();
    select.value = inferCategory(tc);
  }

  function persistEditorCategory() {
    const select = document.getElementById('editTestCategory');
    const id = document.getElementById('editId')?.value;
    if (!select || !id) return;
    const chosen = normalize(select.value);
    setTimeout(() => {
      const tc = casesArray().find(x => String(x?.id || '') === String(id));
      if (!tc) return;
      tc.testCategory = chosen;
      try { if (typeof renderCases === 'function') renderCases(); } catch {}
    }, 0);
  }

  function decorateCards() {
    const cases = casesArray();
    document.querySelectorAll('#cases .case').forEach((card, index) => {
      const meta = card.querySelector('.case-meta');
      if (!meta) return;
      const tc = cases[index];
      if (!tc) return;
      const category = inferCategory(tc);
      tc.testCategory = category;
      let tag = meta.querySelector('.tag.test-category');
      if (!tag) { tag = document.createElement('span'); meta.appendChild(tag); }
      tag.className = `tag test-category category-${category.toLowerCase()}`;
      tag.textContent = category.replaceAll('_',' ');
      tag.title = 'Test category';
    });
  }

  function decorateAutomationDetails() {
    const view = document.getElementById('editorAutomationView');
    if (!view) return;
    view.querySelector('[data-test-category-detail]')?.remove();
    const tc = currentCase();
    if (!tc) return;
    const section = document.createElement('div');
    section.className = 'automation-section';
    section.dataset.testCategoryDetail = 'true';
    section.innerHTML = `<h4>Test Classification</h4><div style="font-size:10.5px;color:#475569"><b>Scenario Type:</b> ${String(tc.type || 'functional').toUpperCase()} &nbsp; <b>Category:</b> ${inferCategory(tc).replaceAll('_',' ')} &nbsp; <b>Priority:</b> ${String(tc.priority || 'medium').toUpperCase()}</div>`;
    const head = view.querySelector('.automation-head');
    if (head) head.insertAdjacentElement('afterend', section); else view.prepend(section);
  }

  function syncFieldVisibility(viewName) {
    const field = document.getElementById('editTestCategory')?.closest('.test-category-field');
    if (field) field.style.display = viewName === 'automation' ? 'none' : '';
    if (viewName === 'automation') setTimeout(decorateAutomationDetails, 0);
  }

  function init() {
    ensureStyle();
    ensureEditorField();
    relabelScenarioType();

    document.getElementById('saveEditorBtn')?.addEventListener('click', persistEditorCategory, true);
    document.getElementById('editorViewTabs')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-editor-view]');
      if (button) syncFieldVisibility(button.dataset.editorView);
    });

    const modal = document.getElementById('editorModal');
    if (modal) new MutationObserver(() => {
      if (modal.classList.contains('show')) {
        ensureEditorField();
        relabelScenarioType();
        syncEditorCategory();
        syncFieldVisibility('human');
        setTimeout(decorateAutomationDetails, 0);
      }
    }).observe(modal, { attributes:true, attributeFilter:['class'] });

    const cases = document.getElementById('cases');
    if (cases) new MutationObserver(decorateCards).observe(cases, { childList:true, subtree:true });
    decorateCards();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();

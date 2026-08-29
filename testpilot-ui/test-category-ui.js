(function () {
  const CATEGORIES = [
    'FUNCTIONAL','SMOKE','REGRESSION','SECURITY','PERFORMANCE','ACCESSIBILITY',
    'INTEGRATION','API','UI','COMPATIBILITY','LOAD','STRESS','CUSTOM'
  ];

  function normalize(value) {
    const v = String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
    return CATEGORIES.includes(v) ? v : 'FUNCTIONAL';
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
      .test-category-field{margin-top:13px}
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
    `;
    document.head.appendChild(style);
  }

  function ensureEditorField() {
    const modal = document.getElementById('editorModal');
    if (!modal || document.getElementById('editTestCategory')) return;
    const priority = document.getElementById('editPriority');
    const anchor = priority?.closest('.two') || priority?.closest('.field') || document.getElementById('editType')?.closest('.two');
    if (!anchor) return;

    const field = document.createElement('div');
    field.className = 'test-category-field';
    field.innerHTML = `<label for="editTestCategory">Test Category</label><select id="editTestCategory">${CATEGORIES.map(x => `<option value="${x}">${x.replaceAll('_',' ')}</option>`).join('')}</select><small>Category describes the testing purpose. It is separate from Type (for example: Negative + Security, or Boundary + Performance).</small>`;
    anchor.insertAdjacentElement('afterend', field);

    const select = field.querySelector('select');
    select.addEventListener('change', () => {
      const id = document.getElementById('editId')?.value;
      const tc = casesArray().find(x => String(x?.id || '') === String(id || ''));
      if (tc) tc.testCategory = normalize(select.value);
    });
  }

  function syncEditorCategory() {
    const select = document.getElementById('editTestCategory');
    if (!select) return;
    const id = document.getElementById('editId')?.value;
    const tc = casesArray().find(x => String(x?.id || '') === String(id || ''));
    select.value = normalize(tc?.testCategory || tc?.category || 'FUNCTIONAL');
  }

  function persistEditorCategory() {
    const select = document.getElementById('editTestCategory');
    const id = document.getElementById('editId')?.value;
    if (!select || !id) return;
    setTimeout(() => {
      const tc = casesArray().find(x => String(x?.id || '') === String(id));
      if (!tc) return;
      tc.testCategory = normalize(select.value);
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
      const category = normalize(tc.testCategory || tc.category || 'FUNCTIONAL');
      tc.testCategory = category;
      let tag = meta.querySelector('.tag.test-category');
      if (!tag) {
        tag = document.createElement('span');
        meta.appendChild(tag);
      }
      tag.className = `tag test-category category-${category.toLowerCase()}`;
      tag.textContent = category.replaceAll('_',' ');
      tag.title = 'Test category';
    });
  }

  function decorateAutomationDetails() {
    const view = document.getElementById('editorAutomationView');
    if (!view || view.querySelector('[data-test-category-detail]')) return;
    const id = document.getElementById('editId')?.value;
    const tc = casesArray().find(x => String(x?.id || '') === String(id || ''));
    if (!tc) return;
    const section = document.createElement('div');
    section.className = 'automation-section';
    section.dataset.testCategoryDetail = 'true';
    section.innerHTML = `<h4>Test Classification</h4><div style="font-size:10.5px;color:#475569"><b>Type:</b> ${String(tc.type || 'functional').toUpperCase()} &nbsp; <b>Category:</b> ${normalize(tc.testCategory || tc.category).replaceAll('_',' ')}</div>`;
    const head = view.querySelector('.automation-head');
    if (head) head.insertAdjacentElement('afterend', section); else view.prepend(section);
  }

  function init() {
    ensureStyle();
    ensureEditorField();

    document.getElementById('saveEditorBtn')?.addEventListener('click', persistEditorCategory, true);

    const modal = document.getElementById('editorModal');
    if (modal) new MutationObserver(() => {
      if (modal.classList.contains('show')) {
        ensureEditorField();
        syncEditorCategory();
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

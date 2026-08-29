(function () {
  const CATEGORIES = [
    'FUNCTIONAL','SMOKE','REGRESSION','SECURITY','PERFORMANCE','ACCESSIBILITY',
    'INTEGRATION','API','UI','COMPATIBILITY','LOAD','STRESS','CUSTOM'
  ];
  const STORAGE_KEY = 'aiTestPilotGenerationCategories';

  function label(value) { return String(value || '').replaceAll('_', ' '); }
  function selectedValues() {
    const checked = [...document.querySelectorAll('#generationCategoryMenu input[data-test-category]:checked')].map((input) => input.value);
    return checked.length ? checked : [...CATEGORIES];
  }
  function persist() {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(selectedValues())); } catch {}
  }
  function updateSummary() {
    const button = document.getElementById('generationCategoryButton');
    const selectAll = document.getElementById('generationCategorySelectAll');
    if (!button || !selectAll) return;
    const selected = selectedValues();
    const all = selected.length === CATEGORIES.length;
    selectAll.checked = all;
    selectAll.indeterminate = !all && selected.length > 0;
    button.textContent = all ? 'All test categories' : `${selected.length} categor${selected.length === 1 ? 'y' : 'ies'} selected`;
    button.title = selected.map(label).join(', ');
    persist();
  }

  function restore() {
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null'); } catch {}
    const selected = Array.isArray(saved) && saved.length ? new Set(saved.filter((x) => CATEGORIES.includes(x))) : new Set(CATEGORIES);
    document.querySelectorAll('#generationCategoryMenu input[data-test-category]').forEach((input) => { input.checked = selected.has(input.value); });
    updateSummary();
  }

  function installFetchBridge() {
    if (window.__aiTestPilotGenerationCategoryFetchInstalled) return;
    window.__aiTestPilotGenerationCategoryFetchInstalled = true;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async function (input, init) {
      try {
        const url = typeof input === 'string' ? input : input?.url || '';
        const method = String(init?.method || (typeof input !== 'string' ? input?.method : '') || 'GET').toUpperCase();
        if (method === 'POST' && /\/api\/chat(?:\?|$)/.test(url) && typeof init?.body === 'string') {
          const body = JSON.parse(init.body);
          body.selectedTestCategories = selectedValues();
          init = { ...init, body: JSON.stringify(body) };
        }
      } catch {}
      return originalFetch(input, init);
    };
  }

  function inject() {
    if (document.getElementById('generationCategoryPicker')) return;
    const story = document.getElementById('story');
    const storyField = story?.closest('.field');
    if (!storyField) return;

    const style = document.createElement('style');
    style.textContent = `
      .generation-category-picker{margin-top:13px;position:relative}
      .generation-category-picker>label{display:flex;align-items:center;gap:6px;margin-bottom:6px;color:#4b5563;font-size:12px;font-weight:700}
      .generation-category-button{width:100%;text-align:left;border:1px solid var(--border);border-radius:9px;padding:10px 11px;background:#fff;color:#111827;cursor:pointer;font-weight:650}
      .generation-category-button:focus{outline:none;border-color:var(--blue);box-shadow:0 0 0 3px #eaf0ff}
      .generation-category-menu{display:none;position:absolute;left:0;right:0;top:64px;z-index:45;background:#fff;border:1px solid var(--border);border-radius:10px;box-shadow:0 14px 32px rgba(15,23,42,.16);max-height:340px;overflow:auto;padding:8px}
      .generation-category-picker.open .generation-category-menu{display:block}
      .generation-category-option{display:flex;align-items:center;gap:9px;padding:8px;border-radius:7px;cursor:pointer;font-size:11.5px;color:#374151}
      .generation-category-option:hover{background:#f8fafc}.generation-category-option input{width:auto;margin:0}
      .generation-category-all{font-weight:850;border-bottom:1px solid #eef1f6;margin-bottom:5px;padding-bottom:10px}
      .generation-category-note{display:block;color:var(--muted);margin-top:5px;font-size:10.5px;line-height:1.45}
      .generation-category-engine-note{margin:6px 8px 2px;padding:7px 8px;border-radius:7px;background:#fff7ed;color:#9a3412;font-size:10px;line-height:1.4}
    `;
    document.head.appendChild(style);

    const picker = document.createElement('div');
    picker.id = 'generationCategoryPicker';
    picker.className = 'generation-category-picker';
    picker.innerHTML = `
      <label>Test categories to generate</label>
      <button id="generationCategoryButton" class="generation-category-button" type="button" aria-haspopup="true" aria-expanded="false">All test categories</button>
      <div id="generationCategoryMenu" class="generation-category-menu">
        <label class="generation-category-option generation-category-all"><input id="generationCategorySelectAll" type="checkbox" checked> Select All</label>
        ${CATEGORIES.map((category) => `<label class="generation-category-option"><input type="checkbox" data-test-category value="${category}" checked> ${label(category)}</label>`).join('')}
        <div class="generation-category-engine-note">Load and Stress can be planned and reported as categories, but true concurrent load/stress execution requires the dedicated load engine rather than normal Cypress browser execution.</div>
      </div>
      <small class="generation-category-note">Choose one or more testing purposes. Type remains separate: a generated test may be Negative + Security, Boundary + Performance, and so on.</small>`;
    storyField.insertAdjacentElement('afterend', picker);

    const button = document.getElementById('generationCategoryButton');
    const menu = document.getElementById('generationCategoryMenu');
    const selectAll = document.getElementById('generationCategorySelectAll');

    button.addEventListener('click', () => {
      const open = picker.classList.toggle('open');
      button.setAttribute('aria-expanded', String(open));
    });
    selectAll.addEventListener('change', () => {
      menu.querySelectorAll('input[data-test-category]').forEach((input) => { input.checked = selectAll.checked; });
      updateSummary();
    });
    menu.querySelectorAll('input[data-test-category]').forEach((input) => input.addEventListener('change', updateSummary));
    document.addEventListener('click', (event) => {
      if (!picker.contains(event.target)) {
        picker.classList.remove('open');
        button.setAttribute('aria-expanded', 'false');
      }
    });
    restore();
  }

  function init() {
    inject();
    installFetchBridge();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();

(function () {
  const CATEGORIES = [
    'FUNCTIONAL','SMOKE','REGRESSION','SECURITY','PERFORMANCE','ACCESSIBILITY',
    'INTEGRATION','API','UI','COMPATIBILITY','LOAD','STRESS','CUSTOM'
  ];
  const SECURITY_SUBCATEGORIES = [
    'AUTHENTICATION','AUTHORIZATION_RBAC','SESSION_MANAGEMENT','INPUT_VALIDATION','XSS','SQL_COMMAND_INJECTION','CSRF',
    'SECURITY_HEADERS','COOKIES','SENSITIVE_DATA_EXPOSURE','API_SECURITY','FILE_UPLOAD','ACCESS_CONTROL','RATE_LIMITING',
    'ERROR_INFORMATION_LEAKAGE','CORS','TLS_TRANSPORT','BUSINESS_LOGIC_ABUSE','LOGGING_AUDIT','DEPENDENCY_VULNERABILITY_SCAN','CUSTOM'
  ];
  const SECURITY_SEVERITIES = ['INFORMATIONAL','LOW','MEDIUM','HIGH','CRITICAL'];
  const STORAGE_KEY = 'aiTestPilotGenerationCategories';
  const SECURITY_STORAGE_KEY = 'aiTestPilotSecuritySubcategories';
  const SEVERITY_STORAGE_KEY = 'aiTestPilotSecuritySeverities';

  function label(value) { return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (m) => m.toUpperCase()); }
  function selectedValues() {
    const checked = [...document.querySelectorAll('#generationCategoryMenu input[data-test-category]:checked')].map((input) => input.value);
    return checked.length ? checked : [...CATEGORIES];
  }
  function selectedSecuritySubcategories() {
    const checked = [...document.querySelectorAll('#securitySubcategoryMenu input[data-security-subcategory]:checked')].map((input) => input.value);
    return checked.length ? checked : [...SECURITY_SUBCATEGORIES];
  }
  function selectedSecuritySeverities() {
    const checked = [...document.querySelectorAll('#securitySeverityMenu input[data-security-severity]:checked')].map((input) => input.value);
    return checked.length ? checked : [...SECURITY_SEVERITIES];
  }
  function persist() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(selectedValues()));
      sessionStorage.setItem(SECURITY_STORAGE_KEY, JSON.stringify(selectedSecuritySubcategories()));
      sessionStorage.setItem(SEVERITY_STORAGE_KEY, JSON.stringify(selectedSecuritySeverities()));
    } catch {}
  }
  function updateSecurityVisibility() {
    const visible = selectedValues().includes('SECURITY');
    const security = document.getElementById('generationSecurityOptions');
    if (security) security.style.display = visible ? '' : 'none';
  }
  function updateSummary() {
    const button = document.getElementById('generationCategoryButton');
    const selectAll = document.getElementById('generationCategorySelectAll');
    const count = document.getElementById('generationCategoryCount');
    if (!button || !selectAll) return;
    const selected = selectedValues();
    const all = selected.length === CATEGORIES.length;
    selectAll.checked = all;
    selectAll.indeterminate = !all && selected.length > 0;
    button.innerHTML = `<span>${all ? 'All test categories' : `${selected.length} categor${selected.length === 1 ? 'y' : 'ies'} selected`}</span><span class="generation-chevron">⌄</span>`;
    button.title = selected.map(label).join(', ');
    if (count) count.textContent = all ? 'All' : String(selected.length);
    updateSecurityVisibility();
    persist();
  }
  function updateSecuritySummary(kind) {
    const isSubcategory = kind === 'subcategory';
    const button = document.getElementById(isSubcategory ? 'securitySubcategoryButton' : 'securitySeverityButton');
    const selectAll = document.getElementById(isSubcategory ? 'securitySubcategorySelectAll' : 'securitySeveritySelectAll');
    const values = isSubcategory ? selectedSecuritySubcategories() : selectedSecuritySeverities();
    const allValues = isSubcategory ? SECURITY_SUBCATEGORIES : SECURITY_SEVERITIES;
    if (!button || !selectAll) return;
    const all = values.length === allValues.length;
    selectAll.checked = all;
    selectAll.indeterminate = !all && values.length > 0;
    const text = all ? (isSubcategory ? 'All security areas' : 'All severities') : `${values.length} selected`;
    button.innerHTML = `<span>${text}</span><span class="generation-chevron">⌄</span>`;
    button.title = values.map(label).join(', ');
    persist();
  }

  function restore() {
    let saved = null, savedSecurity = null, savedSeverities = null;
    try {
      saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
      savedSecurity = JSON.parse(sessionStorage.getItem(SECURITY_STORAGE_KEY) || 'null');
      savedSeverities = JSON.parse(sessionStorage.getItem(SEVERITY_STORAGE_KEY) || 'null');
    } catch {}
    const selected = Array.isArray(saved) && saved.length ? new Set(saved.filter((x) => CATEGORIES.includes(x))) : new Set(CATEGORIES);
    const selectedSecurity = Array.isArray(savedSecurity) && savedSecurity.length ? new Set(savedSecurity.filter((x) => SECURITY_SUBCATEGORIES.includes(x))) : new Set(SECURITY_SUBCATEGORIES);
    const selectedSeverities = Array.isArray(savedSeverities) && savedSeverities.length ? new Set(savedSeverities.filter((x) => SECURITY_SEVERITIES.includes(x))) : new Set(SECURITY_SEVERITIES);
    document.querySelectorAll('#generationCategoryMenu input[data-test-category]').forEach((input) => { input.checked = selected.has(input.value); });
    document.querySelectorAll('#securitySubcategoryMenu input[data-security-subcategory]').forEach((input) => { input.checked = selectedSecurity.has(input.value); });
    document.querySelectorAll('#securitySeverityMenu input[data-security-severity]').forEach((input) => { input.checked = selectedSeverities.has(input.value); });
    updateSummary();
    updateSecuritySummary('subcategory');
    updateSecuritySummary('severity');
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
          body.selectedSecuritySubcategories = selectedSecuritySubcategories();
          body.selectedSecuritySeverities = selectedSecuritySeverities();
          init = { ...init, body: JSON.stringify(body) };
        }
      } catch {}
      return originalFetch(input, init);
    };
  }

  function pickerHtml({ id, buttonId, menuId, allId, values, attr, allLabel }) {
    return `<div class="security-picker" id="${id}"><button id="${buttonId}" class="generation-category-button generation-category-button-compact" type="button"><span>${allLabel}</span><span class="generation-chevron">⌄</span></button><div id="${menuId}" class="generation-category-menu security-menu"><label class="generation-category-option generation-category-all"><input id="${allId}" type="checkbox" checked> Select All</label>${values.map((value) => `<label class="generation-category-option"><input type="checkbox" ${attr} value="${value}" checked> ${label(value)}</label>`).join('')}</div></div>`;
  }

  function bindPicker({ rootId, buttonId, menuId, allId, attrSelector, update }) {
    const root = document.getElementById(rootId), button = document.getElementById(buttonId), menu = document.getElementById(menuId), selectAll = document.getElementById(allId);
    if (!root || !button || !menu || !selectAll) return;
    button.addEventListener('click', (event) => { event.stopPropagation(); root.classList.toggle('open'); });
    selectAll.addEventListener('change', () => { menu.querySelectorAll(attrSelector).forEach((input) => { input.checked = selectAll.checked; }); update(); });
    menu.querySelectorAll(attrSelector).forEach((input) => input.addEventListener('change', update));
    document.addEventListener('click', (event) => { if (!root.contains(event.target)) root.classList.remove('open'); });
  }

  function inject() {
    if (document.getElementById('generationCategoryPicker')) return;
    const story = document.getElementById('story');
    const storyField = story?.closest('.field');
    if (!storyField) return;

    const style = document.createElement('style');
    style.textContent = `.generation-category-picker,.security-picker{position:relative}.generation-category-picker{margin-top:14px}.generation-category-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:7px}.generation-category-heading label{margin:0;color:#344054;font-size:12px;font-weight:800}.generation-category-count{display:inline-flex;align-items:center;justify-content:center;min-width:28px;height:22px;padding:0 7px;border-radius:999px;background:#eef2ff;color:#3b5ccc;font-size:10px;font-weight:850}.generation-category-button{width:100%;display:flex;align-items:center;justify-content:space-between;gap:10px;text-align:left;border:1px solid #dfe4ee;border-radius:11px;padding:11px 13px;background:#fff;color:#101828;cursor:pointer;font-weight:750;box-shadow:0 1px 2px rgba(16,24,40,.02);transition:border-color .15s ease,box-shadow .15s ease}.generation-category-button:hover{border-color:#b7c3ff;box-shadow:0 0 0 3px rgba(47,91,255,.06)}.generation-category-button-compact{min-height:43px;font-size:12px}.generation-chevron{color:#667085;font-size:15px;line-height:1}.generation-category-menu{display:none;position:absolute;left:0;right:0;top:48px;z-index:45;background:#fff;border:1px solid #e3e8ef;border-radius:12px;box-shadow:0 16px 38px rgba(15,23,42,.16);max-height:340px;overflow:auto;padding:8px}.generation-category-picker.open>#generationCategoryMenu,.security-picker.open>.generation-category-menu{display:block}.generation-category-option{display:flex;align-items:center;gap:9px;padding:8px 9px;border-radius:8px;cursor:pointer;font-size:11.5px;color:#344054}.generation-category-option:hover{background:#f8fafc}.generation-category-option input{width:auto;margin:0}.generation-category-all{font-weight:850;border-bottom:1px solid #eef1f6;margin-bottom:5px;padding-bottom:10px}.generation-category-note{display:block;color:#667085;margin-top:6px;font-size:10.5px;line-height:1.45}.generation-category-engine-note{margin:6px 8px 2px;padding:7px 8px;border-radius:7px;background:#fff7ed;color:#9a3412;font-size:10px;line-height:1.4}.security-options{margin-top:12px;padding:12px;border:1px solid #e5e7eb;background:linear-gradient(180deg,#fbfcff,#f8faff);border-radius:12px}.security-options-header{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:9px}.security-options-title{display:flex;align-items:center;gap:7px;color:#344054;font-size:11.5px;font-weight:850}.security-options-icon{width:23px;height:23px;border-radius:7px;display:inline-grid;place-items:center;background:#eef2ff;color:#3857c8;font-size:12px}.security-options-badge{padding:4px 7px;border-radius:999px;background:#eef2ff;color:#3857c8;font-size:9.5px;font-weight:800}.security-options-grid{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,.75fr);gap:8px}.security-picker{margin-top:0}.security-menu{top:47px}.security-options-note{display:flex;gap:6px;align-items:flex-start;margin-top:9px;color:#667085;font-size:10px;line-height:1.45}.security-options-note strong{color:#475467}.generation-category-primary-note{margin-top:6px;color:#667085;font-size:10.5px;line-height:1.45}@media(max-width:760px){.security-options-grid{grid-template-columns:1fr}}`;
    document.head.appendChild(style);

    const picker = document.createElement('div');
    picker.id = 'generationCategoryPicker'; picker.className = 'generation-category-picker';
    picker.innerHTML = `<div class="generation-category-heading"><label>Test categories to generate</label><span id="generationCategoryCount" class="generation-category-count">All</span></div><button id="generationCategoryButton" class="generation-category-button" type="button"><span>All test categories</span><span class="generation-chevron">⌄</span></button><div id="generationCategoryMenu" class="generation-category-menu"><label class="generation-category-option generation-category-all"><input id="generationCategorySelectAll" type="checkbox" checked> Select All</label>${CATEGORIES.map((category) => `<label class="generation-category-option"><input type="checkbox" data-test-category value="${category}" checked> ${label(category)}</label>`).join('')}<div class="generation-category-engine-note">Load and Stress can be selected for planning and reporting; true concurrent load/stress execution is outside the normal browser/API execution path.</div></div><div class="generation-category-primary-note">Choose the testing purposes you want the generated suite to cover.</div><div id="generationSecurityOptions" class="security-options"><div class="security-options-header"><div class="security-options-title"><span class="security-options-icon">◈</span><span>Security options</span></div><span class="security-options-badge">Security selected</span></div><div class="security-options-grid">${pickerHtml({id:'securitySubcategoryPicker',buttonId:'securitySubcategoryButton',menuId:'securitySubcategoryMenu',allId:'securitySubcategorySelectAll',values:SECURITY_SUBCATEGORIES,attr:'data-security-subcategory',allLabel:'All security areas'})}${pickerHtml({id:'securitySeverityPicker',buttonId:'securitySeverityButton',menuId:'securitySeverityMenu',allId:'securitySeveritySelectAll',values:SECURITY_SEVERITIES,attr:'data-security-severity',allLabel:'All severities'})}</div><div class="security-options-note"><span>ⓘ</span><span><strong>Scope:</strong> Security-functional browser/API checks only. Package scanning, active exploitation, password spraying and network attacks are outside this execution engine.</span></div></div>`;
    storyField.insertAdjacentElement('afterend', picker);

    const button = document.getElementById('generationCategoryButton'), menu = document.getElementById('generationCategoryMenu'), selectAll = document.getElementById('generationCategorySelectAll');
    button.addEventListener('click', (event) => { event.stopPropagation(); picker.classList.toggle('open'); });
    selectAll.addEventListener('change', () => { menu.querySelectorAll('input[data-test-category]').forEach((input) => { input.checked = selectAll.checked; }); updateSummary(); });
    menu.querySelectorAll('input[data-test-category]').forEach((input) => input.addEventListener('change', updateSummary));
    document.addEventListener('click', (event) => { if (!picker.contains(event.target)) picker.classList.remove('open'); });

    bindPicker({rootId:'securitySubcategoryPicker',buttonId:'securitySubcategoryButton',menuId:'securitySubcategoryMenu',allId:'securitySubcategorySelectAll',attrSelector:'input[data-security-subcategory]',update:()=>updateSecuritySummary('subcategory')});
    bindPicker({rootId:'securitySeverityPicker',buttonId:'securitySeverityButton',menuId:'securitySeverityMenu',allId:'securitySeveritySelectAll',attrSelector:'input[data-security-severity]',update:()=>updateSecuritySummary('severity')});
    restore();
  }

  function init() { inject(); installFetchBridge(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true }); else init();
})();

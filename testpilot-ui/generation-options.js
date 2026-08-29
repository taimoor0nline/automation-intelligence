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

  function label(value) { return String(value || '').replaceAll('_', ' '); }
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
    if (!button || !selectAll) return;
    const selected = selectedValues();
    const all = selected.length === CATEGORIES.length;
    selectAll.checked = all;
    selectAll.indeterminate = !all && selected.length > 0;
    button.textContent = all ? 'All test categories' : `${selected.length} categor${selected.length === 1 ? 'y' : 'ies'} selected`;
    button.title = selected.map(label).join(', ');
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
    button.textContent = all ? (isSubcategory ? 'All security subcategories' : 'All severities') : `${values.length} selected`;
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
    return `<div class="security-picker" id="${id}"><button id="${buttonId}" class="generation-category-button" type="button">${allLabel}</button><div id="${menuId}" class="generation-category-menu security-menu"><label class="generation-category-option generation-category-all"><input id="${allId}" type="checkbox" checked> Select All</label>${values.map((value) => `<label class="generation-category-option"><input type="checkbox" ${attr} value="${value}" checked> ${label(value)}</label>`).join('')}</div></div>`;
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
    style.textContent = `.generation-category-picker,.security-picker{margin-top:13px;position:relative}.generation-category-picker>label,.security-options>label{display:flex;align-items:center;gap:6px;margin-bottom:6px;color:#4b5563;font-size:12px;font-weight:700}.generation-category-button{width:100%;text-align:left;border:1px solid var(--border);border-radius:9px;padding:10px 11px;background:#fff;color:#111827;cursor:pointer;font-weight:650}.generation-category-menu{display:none;position:absolute;left:0;right:0;top:44px;z-index:45;background:#fff;border:1px solid var(--border);border-radius:10px;box-shadow:0 14px 32px rgba(15,23,42,.16);max-height:340px;overflow:auto;padding:8px}.generation-category-picker.open>.generation-category-menu,.security-picker.open>.generation-category-menu{display:block}.generation-category-option{display:flex;align-items:center;gap:9px;padding:8px;border-radius:7px;cursor:pointer;font-size:11.5px;color:#374151}.generation-category-option:hover{background:#f8fafc}.generation-category-option input{width:auto;margin:0}.generation-category-all{font-weight:850;border-bottom:1px solid #eef1f6;margin-bottom:5px;padding-bottom:10px}.generation-category-note{display:block;color:var(--muted);margin-top:5px;font-size:10.5px;line-height:1.45}.generation-category-engine-note{margin:6px 8px 2px;padding:7px 8px;border-radius:7px;background:#fff7ed;color:#9a3412;font-size:10px;line-height:1.4}.security-options{margin-top:10px;padding:10px;border:1px solid #fecaca;background:#fffafa;border-radius:10px}.security-options-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.security-picker{margin-top:0}.security-menu{top:44px}@media(max-width:760px){.security-options-grid{grid-template-columns:1fr}}`;
    document.head.appendChild(style);

    const picker = document.createElement('div');
    picker.id = 'generationCategoryPicker'; picker.className = 'generation-category-picker';
    picker.innerHTML = `<label>Test categories to generate</label><button id="generationCategoryButton" class="generation-category-button" type="button">All test categories</button><div id="generationCategoryMenu" class="generation-category-menu"><label class="generation-category-option generation-category-all"><input id="generationCategorySelectAll" type="checkbox" checked> Select All</label>${CATEGORIES.map((category) => `<label class="generation-category-option"><input type="checkbox" data-test-category value="${category}" checked> ${label(category)}</label>`).join('')}<div class="generation-category-engine-note">Load and Stress can be planned/reported here; true concurrent load/stress execution requires the dedicated load engine.</div></div><small class="generation-category-note">Choose one or more testing purposes. Scenario Type remains separate.</small><div id="generationSecurityOptions" class="security-options"><label>Security scope</label><div class="security-options-grid">${pickerHtml({id:'securitySubcategoryPicker',buttonId:'securitySubcategoryButton',menuId:'securitySubcategoryMenu',allId:'securitySubcategorySelectAll',values:SECURITY_SUBCATEGORIES,attr:'data-security-subcategory',allLabel:'All security subcategories'})}${pickerHtml({id:'securitySeverityPicker',buttonId:'securitySeverityButton',menuId:'securitySeverityMenu',allId:'securitySeveritySelectAll',values:SECURITY_SEVERITIES,attr:'data-security-severity',allLabel:'All severities'})}</div><small class="generation-category-note">Security-functional scenarios only. Active penetration, dependency scanning and network exploitation require dedicated security engines/tools.</small></div>`;
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

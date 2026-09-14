(function () {
  if (window.__testNexusWebUiApiSeparation) return;
  window.__testNexusWebUiApiSeparation = true;

  const WEB_EXCLUDED_CATEGORIES = new Set(['API', 'CUSTOM']);
  const WEB_EXCLUDED_SECURITY_AREAS = new Set(['API_SECURITY', 'CUSTOM']);

  function pretty(value) { return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (m) => m.toUpperCase()); }
  function sanitizeStoredArray(key, excludedValues) {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (!Array.isArray(parsed)) return;
      const cleaned = parsed.filter((value) => !excludedValues.has(String(value).toUpperCase()));
      if (cleaned.length !== parsed.length) sessionStorage.setItem(key, JSON.stringify(cleaned));
    } catch {}
  }

  function hideGenerationExcludedOptions() {
    document.querySelectorAll('#generationCategoryMenu input[data-test-category]').forEach((input) => {
      if (!WEB_EXCLUDED_CATEGORIES.has(String(input.value).toUpperCase())) return;
      input.checked = false;
      input.closest('.generation-category-option')?.remove();
    });
    document.querySelectorAll('#securitySubcategoryMenu input[data-security-subcategory]').forEach((input) => {
      if (!WEB_EXCLUDED_SECURITY_AREAS.has(String(input.value).toUpperCase())) return;
      input.checked = false;
      input.closest('.generation-category-option')?.remove();
    });
    document.getElementById('generationCustomCategories')?.remove();
  }

  function removeReviewExcludedOptions() {
    for (const value of WEB_EXCLUDED_CATEGORIES) {
      document.querySelector(`#reviewCategory option[value="${value}"]`)?.remove();
      document.querySelector(`#editTestCategory option[value="${value}"]`)?.remove();
    }
    for (const value of WEB_EXCLUDED_SECURITY_AREAS) {
      document.querySelector(`#reviewSecuritySubcategory option[value="${value}"]`)?.remove();
      document.querySelector(`#editSecuritySubcategory option[value="${value}"]`)?.remove();
    }
    // Defensive cleanup for any stale navigation/button injected by older cached scripts.
    document.querySelectorAll('a[href="/rest.html"],button[data-mode="api"],button[data-test-mode="api"]').forEach((node) => node.remove());
    const mode = document.getElementById('testModeSwitch'); if (mode) mode.remove();
  }

  function syncCategorySummary() {
    const menu = document.getElementById('generationCategoryMenu');
    const button = document.getElementById('generationCategoryButton');
    const count = document.getElementById('generationCategoryCount');
    const selectAll = document.getElementById('generationCategorySelectAll');
    if (!menu || !button || !selectAll) return;
    const visibleInputs = [...menu.querySelectorAll('input[data-test-category]:not(:disabled)')]
      .filter((input) => !WEB_EXCLUDED_CATEGORIES.has(String(input.value).toUpperCase()));
    const selected = visibleInputs.filter((input) => input.checked);
    const all = visibleInputs.length > 0 && selected.length === visibleInputs.length;
    selectAll.checked = all; selectAll.indeterminate = !all && selected.length > 0;
    const text = all ? 'All available test categories' : `${selected.length} categor${selected.length === 1 ? 'y' : 'ies'} selected`;
    button.innerHTML = `<span>${text}</span><span class="generation-chevron">⌄</span>`;
    button.title = selected.map((input) => pretty(input.value)).join(', ');
    if (count) count.textContent = all ? 'All' : String(selected.length);
  }

  function syncSecuritySummary() {
    const menu = document.getElementById('securitySubcategoryMenu');
    const button = document.getElementById('securitySubcategoryButton');
    const selectAll = document.getElementById('securitySubcategorySelectAll');
    if (!menu || !button || !selectAll) return;
    const visibleInputs = [...menu.querySelectorAll('input[data-security-subcategory]')]
      .filter((input) => !WEB_EXCLUDED_SECURITY_AREAS.has(String(input.value).toUpperCase()));
    const selected = visibleInputs.filter((input) => input.checked);
    const all = visibleInputs.length > 0 && selected.length === visibleInputs.length;
    selectAll.checked = all; selectAll.indeterminate = !all && selected.length > 0;
    const text = all ? 'All security areas' : `${selected.length} selected`;
    button.innerHTML = `<span>${text}</span><span class="generation-chevron">⌄</span>`;
    button.title = selected.map((input) => pretty(input.value)).join(', ');
  }

  function enforceWebOnlyUi() { hideGenerationExcludedOptions(); removeReviewExcludedOptions(); syncCategorySummary(); syncSecuritySummary(); }

  sanitizeStoredArray('aiTestPilotGenerationCategories', WEB_EXCLUDED_CATEGORIES);
  sanitizeStoredArray('aiTestPilotSecuritySubcategories', WEB_EXCLUDED_SECURITY_AREAS);
  try { sessionStorage.removeItem('testNexusCustomCategories'); } catch {}

  const previousFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    try {
      const url = typeof input === 'string' ? input : input?.url || '';
      const method = String(init?.method || (typeof input !== 'string' ? input?.method : '') || 'GET').toUpperCase();
      const isGenerationRequest = method === 'POST' && (/\/api\/generation\/start(?:\?|$)/.test(url) || /\/api\/chat(?:\?|$)/.test(url));
      if (isGenerationRequest && typeof init?.body === 'string') {
        const body = JSON.parse(init.body);
        if (Array.isArray(body.selectedTestCategories)) {
          body.selectedTestCategories = body.selectedTestCategories.filter((value) => !WEB_EXCLUDED_CATEGORIES.has(String(value).toUpperCase()));
        }
        if (Array.isArray(body.selectedSecuritySubcategories)) {
          body.selectedSecuritySubcategories = body.selectedSecuritySubcategories.filter((value) => !WEB_EXCLUDED_SECURITY_AREAS.has(String(value).toUpperCase()));
        }
        body.customTestCategories = [];
        body.customScenarioTypes = [];
        init = { ...init, body: JSON.stringify(body) };
      }
    } catch {}
    return previousFetch(input, init);
  };

  document.addEventListener('change', (event) => {
    const target = event.target;
    if (!target?.matches?.('#generationCategoryMenu input, #securitySubcategoryMenu input')) return;
    setTimeout(enforceWebOnlyUi, 0);
  });

  function start() { [0,40,100,220,500,900,1500].forEach((delay) => setTimeout(enforceWebOnlyUi, delay)); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();

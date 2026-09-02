(function () {
  if (window.__testNexusWebUiApiSeparation) return;
  window.__testNexusWebUiApiSeparation = true;

  const WEB_EXCLUDED_CATEGORY = 'API';
  const WEB_EXCLUDED_SECURITY_AREA = 'API_SECURITY';

  function pretty(value) { return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (m) => m.toUpperCase()); }
  function sanitizeStoredArray(key, excludedValue) {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (!Array.isArray(parsed)) return;
      const cleaned = parsed.filter((value) => String(value).toUpperCase() !== excludedValue);
      if (cleaned.length !== parsed.length) sessionStorage.setItem(key, JSON.stringify(cleaned));
    } catch {}
  }

  function hideGenerationApiOptions() {
    const apiInput = document.querySelector(`#generationCategoryMenu input[data-test-category][value="${WEB_EXCLUDED_CATEGORY}"]`);
    if (apiInput) { apiInput.checked = false; const option = apiInput.closest('.generation-category-option'); if (option) option.remove(); }
    const apiSecurityInput = document.querySelector(`#securitySubcategoryMenu input[data-security-subcategory][value="${WEB_EXCLUDED_SECURITY_AREA}"]`);
    if (apiSecurityInput) { apiSecurityInput.checked = false; const option = apiSecurityInput.closest('.generation-category-option'); if (option) option.remove(); }
  }

  function removeReviewApiOptions() {
    document.querySelector('#reviewCategory option[value="API"]')?.remove();
    document.querySelector('#reviewSecuritySubcategory option[value="API_SECURITY"]')?.remove();
    document.querySelector('#editTestCategory option[value="API"]')?.remove();
    document.querySelector('#editSecuritySubcategory option[value="API_SECURITY"]')?.remove();
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
    const visibleInputs = [...menu.querySelectorAll('input[data-test-category]:not(:disabled)')].filter((input) => String(input.value).toUpperCase() !== WEB_EXCLUDED_CATEGORY);
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
    const visibleInputs = [...menu.querySelectorAll('input[data-security-subcategory]')].filter((input) => String(input.value).toUpperCase() !== WEB_EXCLUDED_SECURITY_AREA);
    const selected = visibleInputs.filter((input) => input.checked);
    const all = visibleInputs.length > 0 && selected.length === visibleInputs.length;
    selectAll.checked = all; selectAll.indeterminate = !all && selected.length > 0;
    const text = all ? 'All security areas' : `${selected.length} selected`;
    button.innerHTML = `<span>${text}</span><span class="generation-chevron">⌄</span>`;
    button.title = selected.map((input) => pretty(input.value)).join(', ');
  }

  function enforceWebOnlyUi() { hideGenerationApiOptions(); removeReviewApiOptions(); syncCategorySummary(); syncSecuritySummary(); }

  sanitizeStoredArray('aiTestPilotGenerationCategories', WEB_EXCLUDED_CATEGORY);
  sanitizeStoredArray('aiTestPilotSecuritySubcategories', WEB_EXCLUDED_SECURITY_AREA);

  const previousFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    try {
      const url = typeof input === 'string' ? input : input?.url || '';
      const method = String(init?.method || (typeof input !== 'string' ? input?.method : '') || 'GET').toUpperCase();
      const isGenerationRequest = method === 'POST' && (/\/api\/generation\/start(?:\?|$)/.test(url) || /\/api\/chat(?:\?|$)/.test(url));
      if (isGenerationRequest && typeof init?.body === 'string') {
        const body = JSON.parse(init.body);
        if (Array.isArray(body.selectedTestCategories)) body.selectedTestCategories = body.selectedTestCategories.filter((value) => String(value).toUpperCase() !== WEB_EXCLUDED_CATEGORY);
        if (Array.isArray(body.selectedSecuritySubcategories)) body.selectedSecuritySubcategories = body.selectedSecuritySubcategories.filter((value) => String(value).toUpperCase() !== WEB_EXCLUDED_SECURITY_AREA);
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
(function () {
  if (window.__testNexusPageScopeUi) return;
  window.__testNexusPageScopeUi = true;

  const STORAGE_KEY = 'testNexusPageScope';
  const ALL = 'ALL_DISCOVERED_PAGES';
  const START = 'STARTING_PAGE_ONLY';

  function normalize(value) {
    return String(value || '').toUpperCase() === START ? START : ALL;
  }

  function install() {
    if (document.getElementById('pageScope')) return;
    const knownPages = document.getElementById('additionalPaths');
    const knownField = knownPages?.closest('.field');
    if (!knownField) return;

    const field = document.createElement('div');
    field.id = 'pageScopeField';
    field.className = 'field';
    field.innerHTML = `
      <label for="pageScope">Page scope</label>
      <select id="pageScope">
        <option value="ALL_DISCOVERED_PAGES">All discovered pages</option>
        <option value="STARTING_PAGE_ONLY">Starting page only</option>
      </select>
      <small id="pageScopeHelp">TestNexus may follow same-origin page hints and Known pages, then plan tests across the discovered application pages.</small>`;
    knownField.insertAdjacentElement('afterend', field);

    const select = field.querySelector('#pageScope');
    const help = field.querySelector('#pageScopeHelp');
    try { select.value = normalize(sessionStorage.getItem(STORAGE_KEY)); } catch { select.value = ALL; }

    function sync() {
      const scope = normalize(select.value);
      select.value = scope;
      try { sessionStorage.setItem(STORAGE_KEY, scope); } catch {}
      const startingOnly = scope === START;
      if (knownPages) {
        knownPages.disabled = startingOnly;
        knownPages.setAttribute('aria-disabled', startingOnly ? 'true' : 'false');
      }
      if (help) {
        help.textContent = startingOnly
          ? 'Only the Target URL is discovered and tested. Route hints and Known pages are not crawled in this mode.'
          : 'TestNexus may follow same-origin page hints and Known pages, then plan tests across the discovered application pages.';
      }
      const knownSmall = knownField.querySelector('small');
      if (knownSmall) knownSmall.style.opacity = startingOnly ? '.55' : '';
      if (typeof window.syncTestNexusJourneyFormOrder === 'function') setTimeout(window.syncTestNexusJourneyFormOrder, 0);
    }

    select.addEventListener('change', sync);
    sync();
  }

  window.getTestNexusPageScope = function () {
    return normalize(document.getElementById('pageScope')?.value);
  };

  // Add pageScope to both canonical progressive generation and the legacy chat
  // generation path. Starting-page mode also strips Known pages from the request;
  // the server independently enforces the same discovery boundary.
  const previousFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const rawUrl = typeof input === 'string' ? input : input?.url || '';
    let pathname = '';
    try { pathname = new URL(rawUrl, window.location.href).pathname; } catch {}
    const method = String(init?.method || (typeof input !== 'string' ? input?.method : '') || 'GET').toUpperCase();
    const relevant = method === 'POST' && (pathname === '/api/generation/start' || pathname === '/api/chat');
    if (relevant && typeof init?.body === 'string') {
      try {
        const payload = JSON.parse(init.body);
        const generationRequest = pathname === '/api/generation/start'
          || Boolean(payload.targetUrl && payload.message !== 'approve reviewed cases');
        if (generationRequest) {
          const pageScope = window.getTestNexusPageScope();
          payload.pageScope = pageScope;
          if (pageScope === START) payload.additionalPaths = [];
          return previousFetch(input, { ...init, body: JSON.stringify(payload) });
        }
      } catch (err) {
        return Promise.reject(err);
      }
    }
    return previousFetch(input, init);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
  [80, 180, 400, 800, 1400].forEach((delay) => setTimeout(install, delay));
})();

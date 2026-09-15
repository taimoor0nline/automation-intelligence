(function () {
  if (window.__aiTestPilotGenerationExperience) return;
  window.__aiTestPilotGenerationExperience = true;

  // Behavior-rule discovery sync is intentionally idempotent, but the Rules UI uses
  // both a MutationObserver and a timer. During a render burst those two triggers can
  // overlap before the first sync finishes. Coalesce identical in-flight POSTs so only
  // one network request reaches the server for a given session at a time.
  if (!window.__testNexusBehaviorRuleSyncFetchGuard) {
    window.__testNexusBehaviorRuleSyncFetchGuard = true;
    const baseFetch = window.fetch.bind(window);
    const inFlightSync = new Map();
    window.fetch = function testNexusCoalescedFetch(input, init) {
      const rawUrl = typeof input === 'string' ? input : input?.url;
      const method = String(init?.method || (typeof input === 'object' ? input?.method : '') || 'GET').toUpperCase();
      let pathname = '';
      try { pathname = new URL(rawUrl, window.location.origin).pathname; } catch {}
      const isRuleSync = method === 'POST' && /^\/api\/test-rules\/[^/]+\/sync-discovery$/.test(pathname);
      if (!isRuleSync) return baseFetch(input, init);

      const key = pathname;
      const existing = inFlightSync.get(key);
      if (existing) return existing.then((response) => response.clone());

      const request = baseFetch(input, init);
      inFlightSync.set(key, request);
      const release = () => setTimeout(() => {
        if (inFlightSync.get(key) === request) inFlightSync.delete(key);
      }, 1500);
      request.then(release, release);
      return request.then((response) => response.clone());
    };
  }

  if (!window.__aiTestPilotNativeFetch) window.__aiTestPilotNativeFetch = window.fetch.bind(window);

  const INTERNAL_READINESS_BATCH_SIZE = 5;
  window.__aiTestPilotReadinessBatchSize = INTERNAL_READINESS_BATCH_SIZE;
  try { document.cookie = `aiTestPilotReadinessBatchSize=${INTERNAL_READINESS_BATCH_SIZE}; Path=/; SameSite=Lax`; } catch {}

  function setFastProfile() {
    const select = document.getElementById('aiModelTier');
    if (!select) return;
    const hasFast = Array.from(select.options || []).some((option) => String(option.value).toLowerCase() === 'fast');
    if (!hasFast) return;
    select.value = 'fast';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function loadScript(src, marker, ordered = false) {
    if (document.querySelector(`script[${marker}]`)) return;
    const script = document.createElement('script');
    script.src = src;
    script.async = !ordered;
    script.setAttribute(marker, 'true');
    document.body.appendChild(script);
  }

  function prepareBaseUi() {
    setFastProfile();
    const obsoleteBatchField = document.getElementById('readinessBatchSize')?.closest('.field');
    if (obsoleteBatchField) obsoleteBatchField.remove();
    document.querySelectorAll('.human-note').forEach((node) => node.remove());

    // Critical journey controls execute in a deterministic order. Web/API separation
    // is deliberately part of this chain so API options never flash/select in the demo.
    loadScript('/page-scope.js', 'data-page-scope', true);
    loadScript('/test-actors.js', 'data-test-actors', true);
    loadScript('/test-actor-directory.js', 'data-test-actor-directory', true);
    loadScript('/test-actor-login-visibility.js', 'data-test-actor-login-visibility', true);
    loadScript('/generation-options.js', 'data-ai-testpilot-generation-options', true);
    loadScript('/web-ui-api-separation.js', 'data-web-ui-api-separation', true);
    loadScript('/generation-types.js', 'data-generation-types', true);
    loadScript('/journey-form-order.js', 'data-journey-form-order', true);
    loadScript('/generation-activity-ui.js', 'data-generation-activity-ui', true);
    loadScript('/test-category-ui.js', 'data-ai-testpilot-category-ui', true);
    loadScript('/test-case-context-tags.js', 'data-test-case-context-tags', true);

    const generateBtn = document.getElementById('generateBtn');
    if (generateBtn && generateBtn.dataset.fastProfileBound !== '1') {
      generateBtn.dataset.fastProfileBound = '1';
      generateBtn.addEventListener('click', () => setFastProfile(), true);
    }
  }

  function loadPrimaryEnhancements() {
    loadScript('/testnexus-branding.js', 'data-testnexus-branding');
    loadScript('/selection-master-fix.js', 'data-selection-master-fix');
    loadScript('/custom-generation-scopes.js', 'data-custom-generation-scopes');
    loadScript('/generation-loading-ux.js', 'data-generation-loading-ux');
    loadScript('/progressive-generation.js', 'data-progressive-generation');
    loadScript('/requirement-coverage-ui.js', 'data-requirement-coverage-ui');
    loadScript('/generation-progress-clarity.js', 'data-generation-progress-clarity');
    loadScript('/review-filters.js', 'data-review-filters');
    loadScript('/generation-dropdown-search.js', 'data-generation-dropdown-search');
    loadScript('/automation-details-cypress-preview.js', 'data-automation-details-cypress-preview');
    loadScript('/test-case-page-context.js', 'data-test-case-page-context');
    loadScript('/manual-cypress-authoring.js', 'data-manual-cypress-authoring', true);
    loadScript('/manual-cypress-authoring-ux.js', 'data-manual-cypress-authoring-ux', true);
    loadScript('/test-case-repair-workbench.js', 'data-test-case-repair-workbench', true);
  }

  function loadSecondaryEnhancements() {
    loadScript('/test-case-compare.js', 'data-test-case-compare');
    loadScript('/execution-report-actions.js', 'data-execution-report-actions');
    loadScript('/execution-controls.js', 'data-execution-controls', true);
    loadScript('/execution-error-classification.js', 'data-execution-error-classification');
    loadScript('/streaming-failure-analysis.js', 'data-streaming-failure-analysis');
  }

  function scheduleEnhancements() {
    const afterLoad = () => {
      setTimeout(loadPrimaryEnhancements, 20);
      setTimeout(loadSecondaryEnhancements, 450);
    };
    if (document.readyState === 'complete') afterLoad();
    else window.addEventListener('load', afterLoad, { once: true });
  }

  function start() {
    prepareBaseUi();
    scheduleEnhancements();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();

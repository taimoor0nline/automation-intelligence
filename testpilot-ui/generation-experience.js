(function () {
  if (window.__aiTestPilotGenerationExperience) return;
  window.__aiTestPilotGenerationExperience = true;

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

  function loadScript(src, marker) {
    if (document.querySelector(`script[${marker}]`)) return;
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.setAttribute(marker, 'true');
    document.body.appendChild(script);
  }

  function prepareBaseUi() {
    setFastProfile();
    const obsoleteBatchField = document.getElementById('readinessBatchSize')?.closest('.field');
    if (obsoleteBatchField) obsoleteBatchField.remove();

    // Keep the review pane compact immediately. This lightweight helper removes the
    // legacy review banner, shows an animated AI-working state and numbers test cards.
    document.querySelectorAll('.human-note').forEach((node) => node.remove());
    loadScript('/generation-activity-ui.js', 'data-generation-activity-ui');

    const generateBtn = document.getElementById('generateBtn');
    if (generateBtn && generateBtn.dataset.fastProfileBound !== '1') {
      generateBtn.dataset.fastProfileBound = '1';
      generateBtn.addEventListener('click', () => setFastProfile(), true);
    }
  }

  function loadPrimaryEnhancements() {
    loadScript('/testnexus-branding.js', 'data-testnexus-branding');
    loadScript('/generation-types.js', 'data-generation-types');
    loadScript('/selection-master-fix.js', 'data-selection-master-fix');
    loadScript('/custom-generation-scopes.js', 'data-custom-generation-scopes');
    loadScript('/generation-loading-ux.js', 'data-generation-loading-ux');
    loadScript('/progressive-generation.js', 'data-progressive-generation');
    loadScript('/generation-progress-clarity.js', 'data-generation-progress-clarity');
    loadScript('/review-filters.js', 'data-review-filters');
    loadScript('/web-ui-api-separation.js', 'data-web-ui-api-separation');
    loadScript('/generation-dropdown-search.js', 'data-generation-dropdown-search');
  }

  function loadSecondaryEnhancements() {
    loadScript('/test-case-compare.js', 'data-test-case-compare');
    loadScript('/execution-report-actions.js', 'data-execution-report-actions');
    loadScript('/execution-controls.js', 'data-execution-controls');
    loadScript('/execution-error-classification.js', 'data-execution-error-classification');
    loadScript('/streaming-failure-analysis.js', 'data-streaming-failure-analysis');
  }

  function scheduleEnhancements() {
    const afterLoad = () => {
      const primary = () => loadPrimaryEnhancements();
      if (typeof requestIdleCallback === 'function') requestIdleCallback(primary, { timeout: 700 });
      else setTimeout(primary, 80);

      setTimeout(() => {
        if (typeof requestIdleCallback === 'function') requestIdleCallback(loadSecondaryEnhancements, { timeout: 1500 });
        else loadSecondaryEnhancements();
      }, 700);
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

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
    script.async = false;
    script.setAttribute(marker, 'true');
    document.body.appendChild(script);
  }

  function start() {
    setFastProfile();
    const obsoleteBatchField = document.getElementById('readinessBatchSize')?.closest('.field');
    if (obsoleteBatchField) obsoleteBatchField.remove();

    const generateBtn = document.getElementById('generateBtn');
    if (generateBtn && generateBtn.dataset.fastProfileBound !== '1') {
      generateBtn.dataset.fastProfileBound = '1';
      generateBtn.addEventListener('click', () => setFastProfile(), true);
    }

    loadScript('/generation-types.js', 'data-generation-types');
    loadScript('/selection-master-fix.js', 'data-selection-master-fix');
    loadScript('/web-category-capabilities.js', 'data-web-category-capabilities');
    loadScript('/progressive-generation.js', 'data-progressive-generation');
    loadScript('/review-filters.js', 'data-review-filters');
    loadScript('/review-security-visibility.js', 'data-review-security-visibility');
    loadScript('/generation-dropdown-search.js', 'data-generation-dropdown-search');
    loadScript('/test-case-compare.js', 'data-test-case-compare');
    loadScript('/execution-error-classification.js', 'data-execution-error-classification');
    loadScript('/execution-report-actions.js', 'data-execution-report-actions');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
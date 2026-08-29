(function () {
  if (window.__aiTestPilotGenerationExperience) return;
  window.__aiTestPilotGenerationExperience = true;

  if (!window.__aiTestPilotNativeFetch) window.__aiTestPilotNativeFetch = window.fetch.bind(window);

  // Readiness batching remains an internal platform concern.
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

  function loadProgressiveGeneration() {
    if (document.querySelector('script[data-progressive-generation]')) return;
    const script = document.createElement('script');
    script.src = '/progressive-generation.js';
    script.async = false;
    script.dataset.progressiveGeneration = 'true';
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
    loadProgressiveGeneration();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();

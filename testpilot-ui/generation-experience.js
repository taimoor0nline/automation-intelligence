(function () {
  if (window.__aiTestPilotGenerationExperience) return;
  window.__aiTestPilotGenerationExperience = true;

  // Preserve the browser's original fetch before readiness.js is loaded. The generation path
  // must remain owned by the original index.html handler and must not depend on fetch wrappers.
  if (!window.__aiTestPilotNativeFetch) window.__aiTestPilotNativeFetch = window.fetch.bind(window);

  // Keep generation deliberately simple and non-invasive.
  // The original index.html handler owns /api/chat, Response.json(), testCases and renderCases().
  // This helper only selects the Fast profile for the UI. It does not add overlays,
  // timers, MutationObservers, readiness hooks, or dynamically loaded scripts.
  function setFastProfile() {
    const select = document.getElementById('aiModelTier');
    if (!select) return;
    const hasFast = Array.from(select.options || []).some((option) => String(option.value).toLowerCase() === 'fast');
    if (!hasFast) return;
    select.value = 'fast';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function start() {
    setFastProfile();
    const generateBtn = document.getElementById('generateBtn');
    if (!generateBtn || generateBtn.dataset.fastProfileBound === '1') return;
    generateBtn.dataset.fastProfileBound = '1';
    generateBtn.addEventListener('click', () => setFastProfile(), true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();

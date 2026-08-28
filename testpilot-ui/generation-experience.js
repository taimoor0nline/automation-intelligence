(function () {
  if (window.__aiTestPilotGenerationExperience) return;
  window.__aiTestPilotGenerationExperience = true;

  // Preserve the browser's original fetch before readiness.js is loaded. The generation path
  // must remain owned by the original index.html handler and must not depend on fetch wrappers.
  if (!window.__aiTestPilotNativeFetch) window.__aiTestPilotNativeFetch = window.fetch.bind(window);

  const DEFAULT_BATCH_SIZE = 2;
  const MIN_BATCH_SIZE = 1;
  const MAX_BATCH_SIZE = 50;
  const BATCH_COOKIE = 'aiTestPilotReadinessBatchSize';

  function normalizeBatchSize(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return DEFAULT_BATCH_SIZE;
    return Math.max(MIN_BATCH_SIZE, Math.min(MAX_BATCH_SIZE, parsed));
  }

  function readBatchCookie() {
    const match = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${BATCH_COOKIE}=`));
    if (!match) return DEFAULT_BATCH_SIZE;
    return normalizeBatchSize(decodeURIComponent(match.slice(BATCH_COOKIE.length + 1)));
  }

  function writeBatchCookie(value) {
    const normalized = normalizeBatchSize(value);
    document.cookie = `${BATCH_COOKIE}=${encodeURIComponent(normalized)}; Path=/; SameSite=Lax`;
    return normalized;
  }

  // Keep generation deliberately simple and non-invasive.
  // The original index.html handler owns /api/chat, Response.json(), testCases and renderCases().
  // This helper only selects the Fast profile and adds passive UI settings. It does not add
  // overlays, timers, MutationObservers, readiness hooks, or fetch/response interception.
  function setFastProfile() {
    const select = document.getElementById('aiModelTier');
    if (!select) return;
    const hasFast = Array.from(select.options || []).some((option) => String(option.value).toLowerCase() === 'fast');
    if (!hasFast) return;
    select.value = 'fast';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function ensureBatchInput() {
    if (document.getElementById('readinessBatchSize')) return;

    const passwordField = document.getElementById('password')?.closest('.field');
    const aiProfileField = document.getElementById('aiModelTier')?.closest('.field');
    const discoveryField = document.getElementById('bypassDiscoveryCache')?.closest('.field');
    const anchor = discoveryField || aiProfileField || passwordField;
    if (!anchor) return;

    const field = document.createElement('div');
    field.className = 'field';
    field.innerHTML = `
      <label for="readinessBatchSize">Readiness validation batch size</label>
      <input id="readinessBatchSize" type="number" min="1" max="50" step="1" inputmode="numeric" value="${readBatchCookie()}">
      <small>Number of test cases processed per deterministic readiness batch. Default: 2.</small>`;
    anchor.insertAdjacentElement('afterend', field);

    const input = document.getElementById('readinessBatchSize');
    if (!input) return;
    input.addEventListener('change', () => {
      input.value = String(writeBatchCookie(input.value));
    });
    input.addEventListener('blur', () => {
      input.value = String(writeBatchCookie(input.value));
    });
    writeBatchCookie(input.value);
  }

  function start() {
    setFastProfile();
    ensureBatchInput();

    const generateBtn = document.getElementById('generateBtn');
    if (!generateBtn || generateBtn.dataset.fastProfileBound === '1') return;
    generateBtn.dataset.fastProfileBound = '1';
    generateBtn.addEventListener('click', () => {
      setFastProfile();
      const input = document.getElementById('readinessBatchSize');
      if (input) input.value = String(writeBatchCookie(input.value));
    }, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();

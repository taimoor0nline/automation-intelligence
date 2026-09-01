(function () {
  let healthPromise = null;
  let cachedHealth = null;
  const HEALTH_TIMEOUT_MS = Math.max(750, Math.min(Number(window.__testNexusHealthTimeoutMs || 2200), 5000));

  async function loadHealth({ force = false } = {}) {
    if (!force && cachedHealth) return cachedHealth;
    if (!force && healthPromise) return healthPromise;

    healthPromise = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
      try {
        const response = await fetch('/health', {
          method: 'GET',
          headers: { Accept: 'application/json' },
          cache: 'no-store',
          signal: controller.signal,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.reply || `Health request failed (${response.status}).`);
        cachedHealth = data;
        return data;
      } catch (err) {
        if (err?.name === 'AbortError') throw new Error(`Health check exceeded ${HEALTH_TIMEOUT_MS} ms. The UI remains available while services initialize.`);
        throw err;
      } finally {
        clearTimeout(timer);
      }
    })().finally(() => {
      healthPromise = null;
    });

    return healthPromise;
  }

  window.aiTestPilotGetHealth = loadHealth;
  window.aiTestPilotHealth = () => cachedHealth;

  function loadUiExtension(src, marker) {
    if (document.querySelector(`script[${marker}]`)) return;
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.setAttribute(marker, 'true');
    document.head.appendChild(script);
  }

  function ensureClickThrough() {
    if (document.getElementById('testNexusStartupInteractionGuard')) return;
    const style = document.createElement('style');
    style.id = 'testNexusStartupInteractionGuard';
    style.textContent = `
      html,body{pointer-events:auto!important}
      body{cursor:auto!important}
      .modal:not(.show),.platform-modal:not(.show){pointer-events:none!important;display:none!important}
      #testModeSwitch,#testModeSwitch *{pointer-events:auto!important}
    `;
    document.head.appendChild(style);
  }

  ensureClickThrough();

  // The mode switch is the only startup enhancement allowed to load before first paint.
  // It is intentionally independent of health, auth, database and AI readiness.
  loadUiExtension('/fast-mode-navigation.js', 'data-fast-mode-navigation');
  // Demo/status enhancement reads /health and keeps no-database mode obvious while
  // making the reusable rule-review action prominent. It does not gate core startup.
  loadUiExtension('/demo-ui.js', 'data-testnexus-demo-ui');

  function loadOptionalExtensions() {
    loadUiExtension('/test-case-help.js', 'data-ai-testpilot-help');
    loadUiExtension('/test-category-ui.js', 'data-ai-testpilot-category-ui');
    loadUiExtension('/generation-options.js', 'data-ai-testpilot-generation-options');
  }

  function scheduleOptionalExtensions() {
    const run = () => {
      if (typeof requestIdleCallback === 'function') requestIdleCallback(loadOptionalExtensions, { timeout: 1200 });
      else setTimeout(loadOptionalExtensions, 150);
    };
    if (document.readyState === 'complete') run();
    else window.addEventListener('load', run, { once: true });
  }

  scheduleOptionalExtensions();
})();

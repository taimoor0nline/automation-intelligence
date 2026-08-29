(function () {
  let healthPromise = null;
  let cachedHealth = null;

  async function loadHealth({ force = false } = {}) {
    if (!force && cachedHealth) return cachedHealth;
    if (!force && healthPromise) return healthPromise;

    healthPromise = fetch('/health', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.reply || `Health request failed (${response.status}).`);
        cachedHealth = data;
        return data;
      })
      .finally(() => {
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
    script.defer = true;
    script.setAttribute(marker, 'true');
    document.head.appendChild(script);
  }

  function loadExtensions() {
    loadUiExtension('/test-case-help.js', 'data-ai-testpilot-help');
    loadUiExtension('/test-category-ui.js', 'data-ai-testpilot-category-ui');
    loadUiExtension('/generation-options.js', 'data-ai-testpilot-generation-options');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadExtensions, { once: true });
  else loadExtensions();
})();

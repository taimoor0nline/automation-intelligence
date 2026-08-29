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

  function loadEditorHelp() {
    if (document.querySelector('script[data-ai-testpilot-help]')) return;
    const script = document.createElement('script');
    script.src = '/test-case-help.js';
    script.defer = true;
    script.dataset.aiTestpilotHelp = 'true';
    document.head.appendChild(script);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadEditorHelp, { once: true });
  else loadEditorHelp();
})();

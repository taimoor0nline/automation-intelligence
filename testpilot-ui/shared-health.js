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

  function loadEnhancement(src, marker) {
    if (document.querySelector(`script[${marker}]`)) return;
    const script = document.createElement('script');
    script.src = src;
    script.defer = true;
    script.setAttribute(marker, 'true');
    document.head.appendChild(script);
  }

  function loadEditorEnhancements() {
    loadEnhancement('/test-case-help.js', 'data-ai-testpilot-help');
    loadEnhancement('/test-category-ui.js', 'data-ai-testpilot-category-ui');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadEditorEnhancements, { once: true });
  else loadEditorEnhancements();
})();

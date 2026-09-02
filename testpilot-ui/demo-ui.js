(function () {
  if (window.__testNexusDemoUiInstalled) return;
  window.__testNexusDemoUiInstalled = true;

  function installStyles() {
    if (document.getElementById('testNexusDemoUiStyles')) return;
    const style = document.createElement('style');
    style.id = 'testNexusDemoUiStyles';
    style.textContent = `
      #behaviorRuleToolbar{
        margin:0 18px 12px!important;padding:11px 12px!important;
        border:1px solid #bfdbfe!important;border-radius:10px!important;
        background:#eff6ff!important;display:flex!important;align-items:center!important;
        gap:9px!important;flex-wrap:wrap!important
      }
      #behaviorRuleToolbar #openBehaviorRules{
        border:1px solid #1d4ed8!important;background:#2563eb!important;color:#fff!important;
        border-radius:8px!important;padding:8px 11px!important;font-size:11px!important;
        font-weight:800!important;cursor:pointer!important;box-shadow:0 1px 2px rgba(37,99,235,.15)!important
      }
      #behaviorRuleToolbar .testnexus-rule-summary{font-size:10.5px;color:#475569;line-height:1.45}
      #demoModeBadge{display:inline-flex;align-items:center;gap:5px;padding:5px 8px;border-radius:999px;
        border:1px solid #fde68a;background:#fffbeb;color:#92400e;font-size:10px;font-weight:800;white-space:nowrap}
    `;
    document.head.appendChild(style);
  }

  function improveRuleToolbar() {
    const toolbar = document.getElementById('behaviorRuleToolbar');
    if (!toolbar) return false;
    const button = document.getElementById('openBehaviorRules');
    if (button) {
      button.textContent = 'Validation & Behavior Rules';
      button.title = 'Review, override, export or import reusable validation and behavior rules.';
    }
    const summary = toolbar.querySelector('span');
    if (summary) {
      summary.className = 'testnexus-rule-summary';
      summary.textContent = 'Applied automatically after generation and grounding · review only when you need an override/import/export';
    }
    return true;
  }

  function showDemoBadge(health) {
    const databaseConnected = health?.database?.connected === true;
    const databaseEnabled = health?.database?.enabled === true;
    if (databaseConnected) return;

    const header = document.querySelector('header');
    const status = document.getElementById('healthText');
    if (status) {
      const ai = health?.aiConnected ? 'AI connected' : 'AI not connected';
      status.textContent = `${ai} · Demo mode · No database connected`;
    }

    if (header && !document.getElementById('demoModeBadge')) {
      const badge = document.createElement('span');
      badge.id = 'demoModeBadge';
      badge.textContent = databaseEnabled ? 'Demo · Database unavailable' : 'Demo · Session memory only';
      badge.title = databaseEnabled
        ? 'PostgreSQL is enabled but unavailable.'
        : 'PostgreSQL is disabled. Current demo state uses memory/session storage.';
      const statusBox = header.querySelector('.status');
      if (statusBox) statusBox.insertAdjacentElement('beforebegin', badge);
      else header.appendChild(badge);
    }
  }

  async function applyHealthMode() {
    try {
      const health = typeof window.aiTestPilotGetHealth === 'function' ? await window.aiTestPilotGetHealth() : null;
      if (health?.database?.connected !== true) showDemoBadge(health || {});
    } catch {
      showDemoBadge({ aiConnected: false, database: { enabled: false, connected: false } });
    }
  }

  installStyles();
  applyHealthMode();

  // The rules toolbar is created by a later script. Bounded retries are enough;
  // avoid a permanent whole-document MutationObserver on the demo page.
  [0, 120, 300, 700, 1400, 2500].forEach((delay) => setTimeout(improveRuleToolbar, delay));
})();
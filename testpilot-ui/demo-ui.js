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

      /* Rule registry is an application modal, not a second scrolling page. */
      #behaviorRuleModal.rule-modal{padding:22px!important;align-items:center!important;overflow:hidden!important;background:rgba(15,23,42,.5)!important}
      #behaviorRuleModal .rule-dialog{width:min(1240px,calc(100vw - 44px))!important;height:min(780px,calc(100vh - 44px))!important;
        max-width:none!important;max-height:none!important;overflow:hidden!important;padding:0!important;border-radius:16px!important;
        display:flex!important;flex-direction:column!important;background:#fff!important;border:1px solid #e2e8f0!important;
        box-shadow:0 28px 80px rgba(15,23,42,.3)!important}
      #behaviorRuleModal .rule-head{padding:18px 20px 13px!important;border-bottom:1px solid #e2e8f0!important;flex:0 0 auto!important}
      #behaviorRuleModal .rule-head h3{font-size:18px!important;line-height:1.2!important;color:#0f172a!important}
      #behaviorRuleModal .rule-note{font-size:11px!important;color:#64748b!important}
      #behaviorRuleModal .rule-close{width:34px!important;height:34px!important;border-radius:9px!important;display:grid!important;place-items:center!important;
        font-size:23px!important;color:#475569!important;background:#f8fafc!important;border:1px solid #e2e8f0!important}
      #behaviorRuleModal .rule-close:hover{background:#eef2ff!important;color:#1d4ed8!important}
      #behaviorRuleModal .rule-toolbar{margin:0!important;padding:12px 20px!important;border-bottom:1px solid #eef2f7!important;gap:8px!important;flex:0 0 auto!important;background:#fff!important}
      #behaviorRuleModal .rule-toolbar button,#behaviorRuleModal .rule-conflict button{
        appearance:none!important;border:1px solid #cbd5e1!important;background:#fff!important;color:#334155!important;border-radius:8px!important;
        padding:8px 11px!important;font-size:11px!important;font-weight:750!important;cursor:pointer!important;line-height:1.1!important}
      #behaviorRuleModal .rule-toolbar #ruleAdd{background:#2563eb!important;border-color:#2563eb!important;color:#fff!important}
      #behaviorRuleModal .rule-toolbar button:hover,#behaviorRuleModal .rule-conflict button:hover{border-color:#93c5fd!important;background:#eff6ff!important;color:#1d4ed8!important}
      #behaviorRuleModal .rule-toolbar #ruleAdd:hover{background:#1d4ed8!important;color:#fff!important}
      #behaviorRuleModal .rule-conflict{margin:10px 20px 0!important;flex:0 0 auto!important}
      #behaviorRuleModal .rule-dialog>div:last-child{overflow:auto!important;min-height:0!important;flex:1 1 auto!important;margin:0!important;padding:0 20px 18px!important;scrollbar-gutter:stable!important}
      #behaviorRuleModal .rule-grid{margin-top:0!important;min-width:980px!important}
      #behaviorRuleModal .rule-grid th{top:0!important;z-index:2!important;background:#f8fafc!important;padding:10px 7px!important}
      #behaviorRuleModal .rule-grid td{padding:9px 7px!important}
      #behaviorRuleModal .rule-edit{word-break:break-word!important}
      #behaviorRuleModal .rule-dialog>div:last-child::-webkit-scrollbar{width:10px;height:10px}
      #behaviorRuleModal .rule-dialog>div:last-child::-webkit-scrollbar-track{background:#f8fafc;border-radius:10px}
      #behaviorRuleModal .rule-dialog>div:last-child::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:10px;border:2px solid #f8fafc}
      @media(max-width:760px){#behaviorRuleModal.rule-modal{padding:8px!important}#behaviorRuleModal .rule-dialog{width:calc(100vw - 16px)!important;height:calc(100vh - 16px)!important}}
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
      badge.title = databaseEnabled ? 'PostgreSQL is enabled but unavailable.' : 'PostgreSQL is disabled. Current demo state uses memory/session storage.';
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
  [0, 120, 300, 700, 1400, 2500].forEach((delay) => setTimeout(improveRuleToolbar, delay));
})();
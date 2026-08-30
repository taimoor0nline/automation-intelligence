(function () {
  if (window.__testNexusActorLoginVisibility) return;
  window.__testNexusActorLoginVisibility = true;

  const KNOWN_LOGIN_SELECT_IDS = [
    'applicationLogin',
    'applicationLoginMode',
    'loginMode',
    'loginRequirement',
    'authenticationMode',
    'authMode',
  ];

  function normalize(value) {
    return String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  }

  function selectLabelText(select) {
    const labels = [...(select?.labels || [])].map((label) => label.textContent || '');
    const fieldLabel = select?.closest?.('.field')?.querySelector?.('label')?.textContent || '';
    return normalize([...labels, fieldLabel].join(' '));
  }

  function findApplicationLoginSelect() {
    for (const id of KNOWN_LOGIN_SELECT_IDS) {
      const direct = document.getElementById(id);
      if (direct?.tagName === 'SELECT') return direct;
    }

    const selects = [...document.querySelectorAll('select')];
    const labelled = selects.find((select) => /application login|login requirement|authentication/.test(selectLabelText(select)));
    if (labelled) return labelled;

    // Fallback for dynamically injected login controls whose label is not connected
    // with for=/labels. The option text itself is distinctive and stable in the UI.
    return selects.find((select) => [...select.options].some((option) => /no\s+login\s+required/i.test(option.textContent || ''))) || null;
  }

  function isNoLoginSelection(select) {
    if (!select) return false;
    const optionText = select.selectedOptions?.[0]?.textContent || '';
    const selected = normalize(`${select.value || ''} ${optionText}`);
    return /\bno login(?: required)?\b/.test(selected)
      || /\blogin not required\b/.test(selected)
      || /\bno authentication\b/.test(selected)
      || /\banonymous\b/.test(selected)
      || selected === 'none'
      || selected === 'public';
  }

  function applicationLoginRequired() {
    const select = findApplicationLoginSelect();
    // If this deployment does not expose an application-login selector, preserve
    // the historical actor-panel behavior rather than hiding it unexpectedly.
    return !select || !isNoLoginSelection(select);
  }

  window.testNexusApplicationLoginRequired = applicationLoginRequired;

  let originalGetActors = null;
  let originalGetWorkflow = null;
  let gettersWrapped = false;

  function wrapRuntimeGetters() {
    if (gettersWrapped) return;
    if (typeof window.getTestNexusTestActors !== 'function' || typeof window.getTestNexusWorkflowRequirements !== 'function') return;
    originalGetActors = window.getTestNexusTestActors.bind(window);
    originalGetWorkflow = window.getTestNexusWorkflowRequirements.bind(window);

    window.getTestNexusTestActors = function () {
      return applicationLoginRequired() ? originalGetActors() : [];
    };
    window.getTestNexusWorkflowRequirements = function () {
      return applicationLoginRequired() ? originalGetWorkflow() : '';
    };
    window.getTestNexusRuntimeWorkflowContext = function () {
      return {
        testActors: window.getTestNexusTestActors(),
        workflowRequirements: window.getTestNexusWorkflowRequirements(),
      };
    };
    gettersWrapped = true;
  }

  function syncPanelVisibility() {
    const panel = document.getElementById('testActorPanel');
    if (!panel) return false;
    const visible = applicationLoginRequired();
    panel.hidden = !visible;
    panel.style.display = visible ? '' : 'none';
    panel.setAttribute('aria-hidden', visible ? 'false' : 'true');
    if (!visible) panel.open = false;
    return true;
  }

  let fetchGuardInstalled = false;
  function installFetchGuard() {
    if (fetchGuardInstalled) return;
    // Wait until both actor modules have installed their fetch bridges, then become
    // the outermost guard so no-login mode cannot reintroduce an imported directory.
    if (!window.__testNexusActorDirectoryFetchBridge || typeof window.getTestNexusTestActors !== 'function') return;
    wrapRuntimeGetters();
    const previousFetch = window.fetch.bind(window);
    window.fetch = async function (input, init = {}) {
      const rawUrl = typeof input === 'string' ? input : input?.url || '';
      let pathname = '';
      try { pathname = new URL(rawUrl, window.location.href).pathname; } catch {}
      const method = String(init?.method || (typeof input !== 'string' ? input?.method : '') || 'GET').toUpperCase();
      const relevant = method === 'POST' && (pathname === '/api/generation/start' || pathname === '/api/chat');
      if (!relevant || applicationLoginRequired()) return previousFetch(input, init);

      let nextInit = init;
      if (typeof init?.body === 'string') {
        try {
          const payload = JSON.parse(init.body);
          delete payload.testActors;
          delete payload.workflowRequirements;
          delete payload.actorDirectorySessionId;
          nextInit = { ...init, body: JSON.stringify(payload) };
        } catch {}
      }

      const savedDirectorySessionId = window.__testNexusActorDirectorySessionId;
      try {
        // The inner actor-directory fetch bridge uses this global handle. Temporarily
        // blank it so public/no-login generation cannot attach role identities.
        window.__testNexusActorDirectorySessionId = '';
        return await previousFetch(input, nextInit);
      } finally {
        window.__testNexusActorDirectorySessionId = savedDirectorySessionId;
      }
    };
    fetchGuardInstalled = true;
  }

  function sync() {
    wrapRuntimeGetters();
    syncPanelVisibility();
    installFetchGuard();
  }

  document.addEventListener('change', (event) => {
    if (event.target?.tagName === 'SELECT') setTimeout(sync, 0);
  });

  // Application-login and actor controls are injected by independent lightweight UI
  // modules. Bounded retries avoid a long-lived whole-document MutationObserver.
  [0, 80, 180, 400, 800, 1400, 2400, 4000].forEach((delay) => setTimeout(sync, delay));
})();
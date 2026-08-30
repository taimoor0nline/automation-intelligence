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
    return !select || !isNoLoginSelection(select);
  }

  window.testNexusApplicationLoginRequired = applicationLoginRequired;

  let originalGetActors = null;
  let originalGetWorkflow = null;
  let originalGetPrimaryCredentials = null;
  let gettersWrapped = false;

  function wrapRuntimeGetters() {
    if (gettersWrapped) return;
    if (typeof window.getTestNexusTestActors !== 'function' || typeof window.getTestNexusWorkflowRequirements !== 'function') return;
    originalGetActors = window.getTestNexusTestActors.bind(window);
    originalGetWorkflow = window.getTestNexusWorkflowRequirements.bind(window);
    originalGetPrimaryCredentials = typeof window.getTestNexusPrimaryCredentials === 'function'
      ? window.getTestNexusPrimaryCredentials.bind(window)
      : null;

    window.getTestNexusTestActors = function () {
      return applicationLoginRequired() ? originalGetActors() : [];
    };
    window.getTestNexusWorkflowRequirements = function () {
      return applicationLoginRequired() ? originalGetWorkflow() : '';
    };
    window.getTestNexusPrimaryCredentials = function () {
      if (!applicationLoginRequired()) return { username: '', password: '', actorRef: null };
      return originalGetPrimaryCredentials ? originalGetPrimaryCredentials() : { username: '', password: '', actorRef: null };
    };
    window.getTestNexusRuntimeWorkflowContext = function () {
      return {
        testActors: window.getTestNexusTestActors(),
        workflowRequirements: window.getTestNexusWorkflowRequirements(),
        credentials: window.getTestNexusPrimaryCredentials(),
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

    // #username/#password are hidden compatibility fields. Keep them empty in
    // public/no-login mode so older request builders cannot accidentally classify
    // the run as authenticated.
    if (!visible) {
      const username = document.getElementById('username');
      const password = document.getElementById('password');
      if (username) username.value = '';
      if (password) password.value = '';
    } else if (typeof window.getTestNexusPrimaryCredentials === 'function') {
      try { window.getTestNexusPrimaryCredentials(); } catch {}
    }
    return true;
  }

  let fetchGuardInstalled = false;
  function installFetchGuard() {
    if (fetchGuardInstalled) return;
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
          delete payload.credentials;
          delete payload.username;
          delete payload.password;
          nextInit = { ...init, body: JSON.stringify(payload) };
        } catch {}
      }

      const savedDirectorySessionId = window.__testNexusActorDirectorySessionId;
      try {
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

  [0, 80, 180, 400, 800, 1400, 2400, 4000].forEach((delay) => setTimeout(sync, delay));
})();
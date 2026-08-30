(function () {
  if (window.__testNexusActorUi) return;
  window.__testNexusActorUi = true;

  const legacyUsername = document.getElementById('username');
  const legacyPassword = document.getElementById('password');
  const legacyUsernameField = legacyUsername?.closest('.field') || null;
  const legacyPasswordField = legacyPassword?.closest('.field') || null;
  const legacyCredentialGrid = legacyUsernameField?.parentElement?.classList?.contains('two') ? legacyUsernameField.parentElement : null;
  if (!legacyPasswordField && !legacyUsernameField) return;

  const originalLegacyCredentials = {
    username: String(legacyUsername?.value || ''),
    password: String(legacyPassword?.value || ''),
  };

  function normalize(value) {
    return String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  }

  function findApplicationLoginSelect() {
    const knownIds = ['applicationLogin','applicationLoginMode','loginMode','loginRequirement','authenticationMode','authMode'];
    for (const id of knownIds) {
      const direct = document.getElementById(id);
      if (direct?.tagName === 'SELECT') return direct;
    }
    const selects = [...document.querySelectorAll('select')];
    const labelled = selects.find((select) => {
      const labels = [...(select.labels || [])].map((label) => label.textContent || '').join(' ');
      const fieldLabel = select.closest?.('.field')?.querySelector?.('label')?.textContent || '';
      return /application login|login requirement|authentication/i.test(`${labels} ${fieldLabel}`);
    });
    if (labelled) return labelled;
    return selects.find((select) => [...select.options].some((option) => /no\s+login\s+required/i.test(option.textContent || ''))) || null;
  }

  function loginRequired() {
    if (typeof window.testNexusApplicationLoginRequired === 'function') return window.testNexusApplicationLoginRequired();
    const select = findApplicationLoginSelect();
    if (!select) return true;
    const selected = normalize(`${select.value || ''} ${select.selectedOptions?.[0]?.textContent || ''}`);
    return !(/\bno login(?: required)?\b/.test(selected)
      || /\blogin not required\b/.test(selected)
      || /\bno authentication\b/.test(selected)
      || /\banonymous\b/.test(selected)
      || selected === 'none'
      || selected === 'public');
  }

  function hideLegacyCredentialUi() {
    if (legacyUsernameField) {
      legacyUsernameField.hidden = true;
      legacyUsernameField.style.display = 'none';
      legacyUsernameField.setAttribute('aria-hidden', 'true');
    }
    if (legacyPasswordField) {
      legacyPasswordField.hidden = true;
      legacyPasswordField.style.display = 'none';
      legacyPasswordField.setAttribute('aria-hidden', 'true');
    }
    if (legacyCredentialGrid) legacyCredentialGrid.style.gridTemplateColumns = '1fr';
  }

  const style = document.createElement('style');
  style.textContent = `
    .test-actors{margin-top:12px;border:1px solid var(--border);border-radius:10px;background:#f8fafc;overflow:hidden}
    .test-actors summary{cursor:pointer;padding:10px 11px;font-size:11px;font-weight:800;color:#334155;display:flex;align-items:center;justify-content:space-between;gap:8px}
    .test-actors-body{padding:0 11px 11px}.test-actors-note{font-size:10.5px;line-height:1.45;color:#64748b;margin-bottom:8px}
    .workflow-requirement-field{margin:8px 0 10px}.workflow-requirement-field label{display:block;font-size:9.5px;font-weight:800;color:#475569;margin-bottom:4px}
    .workflow-requirement-field textarea{width:100%;min-height:82px;resize:vertical;border:1px solid var(--border);border-radius:8px;background:#fff;padding:8px 9px;font-size:10.5px;line-height:1.45}
    .workflow-requirement-field small{display:block;margin-top:4px;font-size:9.5px;line-height:1.4;color:#64748b}
    .test-actor-row{display:grid;grid-template-columns:1fr 1.15fr 1.15fr auto;gap:6px;align-items:end;padding:8px 0;border-top:1px solid #e2e8f0}
    .test-actor-row:first-of-type{border-top:0}.test-actor-row label{display:block;font-size:9.5px;font-weight:800;color:#64748b;margin-bottom:4px}
    .test-actor-row input{width:100%;border:1px solid var(--border);border-radius:7px;padding:7px 8px;background:#fff;font-size:10.5px}
    .test-actor-remove{height:31px;min-width:31px;padding:0!important}.test-actor-actions{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:8px}
    .test-actor-count{font-size:10px;color:#64748b}.test-actor-example{font-size:10px;color:#475569;margin-top:7px}
    .test-actor-primary-note{padding:7px 8px;border-radius:7px;background:#eef2ff;color:#475569;font-size:9.5px;line-height:1.4;margin:7px 0}
    @media(max-width:760px){.test-actor-row{grid-template-columns:1fr}.test-actor-remove{width:100%}}
  `;
  document.head.appendChild(style);

  const panel = document.createElement('details');
  panel.id = 'testActorPanel';
  panel.className = 'test-actors';
  panel.innerHTML = `
    <summary><span>Test users & workflow <small style="font-weight:600;color:#64748b">optional workflow</small></span><span id="testActorSummaryCount">0</span></summary>
    <div class="test-actors-body">
      <div class="test-actors-note">For an authenticated application, add the test account(s) here. A simple single-user application needs only one Default User. For role workflows, add Requester, Manager, Approver, Checker, or any other required roles. Credentials stay runtime-only and are never sent to the AI model or persisted in PostgreSQL.</div>
      <div class="test-actor-primary-note"><strong>Single user:</strong> keep one row with role <b>Default User</b>. <strong>Workflow:</strong> add one row per participating user/role or import a CSV/Excel actor directory.</div>
      <div class="workflow-requirement-field">
        <label for="workflowRequirements">Workflow requirements <span style="font-weight:600;color:#64748b">optional</span></label>
        <textarea id="workflowRequirements" maxlength="5000" placeholder="Example: Requester submits a request. Manager reviews it. Approver approves it. Requester then verifies the final approved status."></textarea>
        <small>Use this only when role handoffs, approval order, state transitions, prerequisites, or other workflow rules matter. Do not enter passwords, tokens, connection strings, or other secrets here.</small>
      </div>
      <div id="testActorRows"></div>
      <div class="test-actor-actions"><span id="testActorCount" class="test-actor-count">No test users configured.</span><button id="addTestActorBtn" class="btn ghost" type="button">+ Add user</button></div>
      <div class="test-actor-example">The first configured user is the compatibility/default login account unless an imported actor directory is active. AI-generated role workflows use the explicit actor reference instead.</div>
    </div>`;

  const anchor = legacyPasswordField || legacyCredentialGrid || legacyUsernameField;
  anchor?.insertAdjacentElement('afterend', panel);
  hideLegacyCredentialUi();

  const rows = panel.querySelector('#testActorRows');
  const addBtn = panel.querySelector('#addTestActorBtn');
  const count = panel.querySelector('#testActorCount');
  const summaryCount = panel.querySelector('#testActorSummaryCount');
  const workflowInput = panel.querySelector('#workflowRequirements');
  const MAX_ACTORS = 12;

  function escapeAttr(value) {
    return String(value ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function actorSlug(role, index) {
    const normalizedRole = normalize(role);
    if (['default','default user','single user','primary user'].includes(normalizedRole)) return 'actor_default';
    const slug = String(role || '').trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,60);
    return `actor_${slug || `user_${index + 1}`}`;
  }

  function rawActors({ validate = true } = {}) {
    const actors = [];
    const usedRefs = new Set();
    for (const [index, row] of [...rows.querySelectorAll('.test-actor-row')].entries()) {
      const role = row.querySelector('[data-actor-role]')?.value.trim() || '';
      const username = row.querySelector('[data-actor-username]')?.value || '';
      const password = row.querySelector('[data-actor-password]')?.value || '';
      if (!role && !username && !password) continue;
      if (validate && (!role || !username || !password)) throw new Error(`Test user ${index + 1} is incomplete. Role, username and password are all required.`);
      if (!role || !username || !password) continue;
      let actorRef = actorSlug(role, index);
      const base = actorRef;
      let suffix = 2;
      while (usedRefs.has(actorRef)) actorRef = `${base}_${String(suffix++).padStart(2,'0')}`;
      usedRefs.add(actorRef);
      actors.push({ actorRef, role, displayName: role, username, password });
    }
    return actors;
  }

  function primaryCredentials() {
    const actors = rawActors({ validate: false });
    const primary = actors.find((actor) => actor.actorRef === 'actor_default') || actors[0] || null;
    if (primary) return { username: primary.username, password: primary.password, actorRef: primary.actorRef };
    if (window.__testNexusImportedActorDirectoryActive) {
      return { username: String(legacyUsername?.value || ''), password: String(legacyPassword?.value || ''), actorRef: null };
    }
    return { username: '', password: '', actorRef: null };
  }

  function syncLegacyPrimaryCredentials() {
    if (!loginRequired()) {
      if (legacyUsername) legacyUsername.value = '';
      if (legacyPassword) legacyPassword.value = '';
      return;
    }
    if (window.__testNexusImportedActorDirectoryActive && !rows.querySelector('.test-actor-row')) return;
    const primary = primaryCredentials();
    if (legacyUsername) legacyUsername.value = primary.username || '';
    if (legacyPassword) legacyPassword.value = primary.password || '';
  }

  function updateCount() {
    const n = rows.querySelectorAll('.test-actor-row').length;
    count.textContent = n ? `${n} test user${n === 1 ? '' : 's'} configured.` : (window.__testNexusImportedActorDirectoryActive ? 'Imported actor directory is active.' : 'No test users configured.');
    summaryCount.textContent = String(n);
    addBtn.disabled = n >= MAX_ACTORS;
    syncLegacyPrimaryCredentials();
  }

  function addRow(values = {}, { focus = true } = {}) {
    if (rows.querySelectorAll('.test-actor-row').length >= MAX_ACTORS) return;
    const row = document.createElement('div');
    row.className = 'test-actor-row';
    row.innerHTML = `
      <div><label>Role</label><input data-actor-role placeholder="Default User" value="${escapeAttr(values.role || '')}"></div>
      <div><label>Username</label><input data-actor-username autocomplete="off" placeholder="test.user" value="${escapeAttr(values.username || '')}"></div>
      <div><label>Password</label><input data-actor-password type="password" autocomplete="new-password" placeholder="Test password" value="${escapeAttr(values.password || '')}"></div>
      <button type="button" class="btn ghost danger test-actor-remove" title="Remove user" aria-label="Remove user">×</button>`;
    row.querySelector('.test-actor-remove').addEventListener('click', () => { row.remove(); updateCount(); });
    row.querySelectorAll('input').forEach((input) => input.addEventListener('input', updateCount));
    rows.appendChild(row);
    updateCount();
    if (focus) row.querySelector('[data-actor-role]')?.focus();
  }

  addBtn.addEventListener('click', () => addRow());

  window.getTestNexusTestActors = function () {
    if (!loginRequired()) return [];
    return rawActors({ validate: true });
  };

  window.getTestNexusPrimaryCredentials = function () {
    if (!loginRequired()) return { username: '', password: '', actorRef: null };
    syncLegacyPrimaryCredentials();
    return primaryCredentials();
  };

  window.getTestNexusWorkflowRequirements = function () {
    if (!loginRequired()) return '';
    return String(workflowInput?.value || '').trim().slice(0, 5000);
  };

  window.getTestNexusRuntimeWorkflowContext = function () {
    return {
      testActors: window.getTestNexusTestActors(),
      workflowRequirements: window.getTestNexusWorkflowRequirements(),
      credentials: window.getTestNexusPrimaryCredentials(),
    };
  };

  window.setTestNexusTestActors = function (actors = []) {
    rows.innerHTML = '';
    for (const actor of Array.isArray(actors) ? actors.slice(0, MAX_ACTORS) : []) addRow(actor || {}, { focus: false });
    updateCount();
  };

  window.setTestNexusWorkflowRequirements = function (value = '') {
    if (workflowInput) workflowInput.value = String(value || '').slice(0, 5000);
  };

  const generateBtn = document.getElementById('generateBtn');
  generateBtn?.addEventListener('click', syncLegacyPrimaryCredentials, true);

  document.addEventListener('change', (event) => {
    if (event.target?.tagName === 'SELECT') setTimeout(syncLegacyPrimaryCredentials, 0);
  });

  // Keep legacy request contracts operational while the UI has one source of truth.
  // New canonical/role generation receives actor metadata + runtime credentials here;
  // older generation code continues reading the hidden #username/#password fields.
  const previousFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const rawUrl = typeof input === 'string' ? input : input?.url;
    let pathname = '';
    try { pathname = new URL(rawUrl, window.location.href).pathname; } catch {}
    const method = String(init?.method || 'GET').toUpperCase();
    const eligible = pathname === '/api/generation/start' || pathname === '/api/chat';
    if (eligible && method === 'POST' && typeof init?.body === 'string') {
      try {
        const payload = JSON.parse(init.body);
        const isGeneration = pathname === '/api/generation/start' || (pathname === '/api/chat' && payload.targetUrl && payload.message !== 'approve reviewed cases');
        const isExecution = pathname === '/api/chat' && (payload.message === 'approve reviewed cases' || Array.isArray(payload.approvedIds));
        if (isGeneration || isExecution) {
          if (!loginRequired()) {
            delete payload.testActors;
            delete payload.workflowRequirements;
            delete payload.actorDirectorySessionId;
            delete payload.credentials;
          } else {
            const runtime = window.getTestNexusRuntimeWorkflowContext();
            payload.testActors = runtime.testActors;
            payload.workflowRequirements = runtime.workflowRequirements;
            if (runtime.credentials?.username && runtime.credentials?.password) {
              payload.credentials = { username: runtime.credentials.username, password: runtime.credentials.password };
            }
          }
          return previousFetch(input, { ...init, body: JSON.stringify(payload) });
        }
      } catch (err) {
        return Promise.reject(err);
      }
    }
    return previousFetch(input, init);
  };

  // Seed one unified Default User from the legacy demo values. These inputs remain
  // hidden compatibility fields, not a second user-facing credential source.
  addRow({ role: 'Default User', username: originalLegacyCredentials.username, password: originalLegacyCredentials.password }, { focus: false });
  hideLegacyCredentialUi();
  syncLegacyPrimaryCredentials();
})();
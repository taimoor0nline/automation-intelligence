(function () {
  if (window.__testNexusActorUi) return;
  window.__testNexusActorUi = true;

  const passwordField = document.getElementById('password')?.closest('.field');
  if (!passwordField) return;

  const style = document.createElement('style');
  style.textContent = `
    .test-actors{margin-top:12px;border:1px solid var(--border);border-radius:10px;background:#f8fafc;overflow:hidden}
    .test-actors summary{cursor:pointer;padding:10px 11px;font-size:11px;font-weight:800;color:#334155;display:flex;align-items:center;justify-content:space-between;gap:8px}
    .test-actors-body{padding:0 11px 11px}.test-actors-note{font-size:10.5px;line-height:1.45;color:#64748b;margin-bottom:8px}
    .test-actor-row{display:grid;grid-template-columns:1fr 1.15fr 1.15fr auto;gap:6px;align-items:end;padding:8px 0;border-top:1px solid #e2e8f0}
    .test-actor-row:first-of-type{border-top:0}.test-actor-row label{display:block;font-size:9.5px;font-weight:800;color:#64748b;margin-bottom:4px}
    .test-actor-row input{width:100%;border:1px solid var(--border);border-radius:7px;padding:7px 8px;background:#fff;font-size:10.5px}
    .test-actor-remove{height:31px;min-width:31px;padding:0!important}.test-actor-actions{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:8px}
    .test-actor-count{font-size:10px;color:#64748b}.test-actor-example{font-size:10px;color:#475569;margin-top:7px}
    @media(max-width:760px){.test-actor-row{grid-template-columns:1fr}.test-actor-remove{width:100%}}
  `;
  document.head.appendChild(style);

  const panel = document.createElement('details');
  panel.id = 'testActorPanel';
  panel.className = 'test-actors';
  panel.innerHTML = `
    <summary><span>Test actors / roles <small style="font-weight:600;color:#64748b">optional</small></span><span id="testActorSummaryCount">0</span></summary>
    <div class="test-actors-body">
      <div class="test-actors-note">Use this when one business workflow involves different authenticated users, for example Requester → Manager → Approver. Role credentials are runtime-only and are not sent to the AI model.</div>
      <div id="testActorRows"></div>
      <div class="test-actor-actions"><span id="testActorCount" class="test-actor-count">No role actors configured.</span><button id="addTestActorBtn" class="btn ghost" type="button">+ Add role</button></div>
      <div class="test-actor-example">Each configured role requires its own test username and password. Ordinary single-user tests continue to use the Username/Password fields above.</div>
    </div>`;
  passwordField.insertAdjacentElement('afterend', panel);

  const rows = panel.querySelector('#testActorRows');
  const addBtn = panel.querySelector('#addTestActorBtn');
  const count = panel.querySelector('#testActorCount');
  const summaryCount = panel.querySelector('#testActorSummaryCount');
  const MAX_ACTORS = 12;

  function escapeAttr(value) {
    return String(value ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function actorSlug(role, index) {
    const slug = String(role || '').trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,60);
    return `actor_${slug || `role_${index + 1}`}`;
  }

  function updateCount() {
    const n = rows.querySelectorAll('.test-actor-row').length;
    count.textContent = n ? `${n} role actor${n === 1 ? '' : 's'} configured.` : 'No role actors configured.';
    summaryCount.textContent = String(n);
    addBtn.disabled = n >= MAX_ACTORS;
  }

  function addRow(values = {}) {
    if (rows.querySelectorAll('.test-actor-row').length >= MAX_ACTORS) return;
    const row = document.createElement('div');
    row.className = 'test-actor-row';
    row.innerHTML = `
      <div><label>Role</label><input data-actor-role placeholder="Requester" value="${escapeAttr(values.role || '')}"></div>
      <div><label>Username</label><input data-actor-username autocomplete="off" placeholder="requester.qa" value="${escapeAttr(values.username || '')}"></div>
      <div><label>Password</label><input data-actor-password type="password" autocomplete="new-password" placeholder="Test password" value="${escapeAttr(values.password || '')}"></div>
      <button type="button" class="btn ghost danger test-actor-remove" title="Remove role" aria-label="Remove role">×</button>`;
    row.querySelector('.test-actor-remove').addEventListener('click', () => { row.remove(); updateCount(); });
    rows.appendChild(row);
    updateCount();
    row.querySelector('[data-actor-role]')?.focus();
  }

  addBtn.addEventListener('click', () => addRow());

  window.getTestNexusTestActors = function () {
    const actors = [];
    const usedRefs = new Set();
    for (const [index, row] of [...rows.querySelectorAll('.test-actor-row')].entries()) {
      const role = row.querySelector('[data-actor-role]')?.value.trim() || '';
      const username = row.querySelector('[data-actor-username]')?.value || '';
      const password = row.querySelector('[data-actor-password]')?.value || '';
      if (!role && !username && !password) continue;
      if (!role || !username || !password) throw new Error(`Role actor ${index + 1} is incomplete. Role, username and password are all required.`);
      let actorRef = actorSlug(role, index);
      const base = actorRef;
      let suffix = 2;
      while (usedRefs.has(actorRef)) actorRef = `${base}_${suffix++}`;
      usedRefs.add(actorRef);
      actors.push({ actorRef, role, displayName: role, username, password });
    }
    return actors;
  };

  window.setTestNexusTestActors = function (actors = []) {
    rows.innerHTML = '';
    for (const actor of Array.isArray(actors) ? actors.slice(0, MAX_ACTORS) : []) addRow(actor || {});
    updateCount();
  };

  const previousFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input?.url;
    if (url === '/api/generation/start' && String(init?.method || 'GET').toUpperCase() === 'POST' && typeof init?.body === 'string') {
      try {
        const payload = JSON.parse(init.body);
        payload.testActors = window.getTestNexusTestActors();
        return previousFetch(input, { ...init, body: JSON.stringify(payload) });
      } catch (err) {
        return Promise.reject(err);
      }
    }
    return previousFetch(input, init);
  };

  updateCount();
})();

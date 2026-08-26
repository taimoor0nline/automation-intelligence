(function () {
  const TOKEN_KEY = 'aiTestPilotToken';
  let currentUser = null;
  let projectId = '';
  let repositoryId = '';
  const nativeFetch = window.fetch.bind(window);

  function token() { return sessionStorage.getItem(TOKEN_KEY) || ''; }
  function setToken(value) { if (value) sessionStorage.setItem(TOKEN_KEY, value); else sessionStorage.removeItem(TOKEN_KEY); }
  function authHeaders(headers = {}) { return token() ? { ...headers, Authorization: `Bearer ${token()}` } : headers; }

  window.fetch = async function(input, init = {}) {
    const url = typeof input === 'string' ? input : input?.url;
    let nextInit = { ...init, headers: authHeaders(init.headers || {}) };

    if (url === '/api/chat' && nextInit.method === 'POST' && typeof nextInit.body === 'string') {
      try {
        const payload = JSON.parse(nextInit.body);
        const initialGeneration = payload.message !== 'approve reviewed cases';
        if (initialGeneration && payload.sessionId && projectId) {
          const contextResponse = await nativeFetch(`/api/sessions/${encodeURIComponent(payload.sessionId)}/context`, {
            method: 'POST',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ projectId, repositoryId: repositoryId || null })
          });
          if (!contextResponse.ok) {
            const error = await contextResponse.json().catch(() => ({}));
            throw new Error(error.reply || 'Could not attach project/source repository to this run.');
          }
        }
      } catch (err) {
        if (err instanceof SyntaxError) {} else throw err;
      }
    }
    return nativeFetch(input, nextInit);
  };

  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .platform-card{margin-bottom:14px;padding:12px;border:1px solid #dbe3ff;border-radius:10px;background:#f8fbff}
      .platform-row{display:grid;grid-template-columns:1fr 1fr;gap:8px}.platform-card select,.platform-card input{width:100%;border:1px solid var(--border);border-radius:8px;padding:8px;background:#fff}
      .platform-label{font-size:10.5px;font-weight:800;color:#475569;margin:6px 0 4px}.platform-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:9px}.platform-actions button{font-size:10.5px;padding:7px 9px}
      .platform-user{font-size:11px;color:#334155;font-weight:700}.platform-role{display:inline-block;margin-left:5px;padding:2px 6px;border-radius:999px;background:#e0e7ff;color:#3730a3;font-size:9px}
      .platform-modal{position:fixed;inset:0;background:rgba(15,23,42,.48);display:none;align-items:center;justify-content:center;z-index:120;padding:18px}.platform-modal.show{display:flex}.platform-modal-card{width:min(720px,100%);max-height:88vh;overflow:auto;background:#fff;border-radius:14px;padding:18px;border:1px solid var(--border)}
      .platform-table{width:100%;border-collapse:collapse;margin-top:10px}.platform-table td,.platform-table th{padding:8px;border-bottom:1px solid #eef1f6;text-align:left;font-size:11px}.platform-error{color:#b91c1c;font-size:10.5px;margin-top:7px;white-space:pre-wrap}
    `;
    document.head.appendChild(style);
  }

  function buildPanel() {
    const aside = document.querySelector('aside.panel');
    if (!aside) return;
    const firstHead = aside.querySelector('.section-head');
    const card = document.createElement('div');
    card.className = 'platform-card';
    card.innerHTML = `
      <div id="platformSignedOut">
        <div class="platform-label">Platform sign in</div>
        <div class="platform-row"><input id="platformEmail" placeholder="Email"><input id="platformPassword" type="password" placeholder="Password"></div>
        <div class="platform-actions"><button id="platformLogin" class="btn secondary" type="button">Sign in</button><button id="platformBootstrap" class="btn ghost" type="button">Bootstrap first manager</button></div>
        <div class="platform-error" id="platformAuthError"></div>
      </div>
      <div id="platformSignedIn" style="display:none">
        <div class="platform-user"><span id="platformUserName"></span><span id="platformUserRole" class="platform-role"></span></div>
        <div class="platform-row">
          <div><div class="platform-label">Project</div><select id="platformProject"><option value="">Select project</option></select></div>
          <div><div class="platform-label">Source repository</div><select id="platformRepo"><option value="">Black-box only</option></select></div>
        </div>
        <div class="platform-actions"><button id="platformRefresh" class="btn ghost" type="button">Refresh</button><button id="platformUsers" class="btn ghost" type="button" style="display:none">Users</button><button id="platformLogout" class="btn ghost" type="button">Sign out</button></div>
        <div class="sub" id="platformContextHint">Select a project. A repository enables source-aware developer fix guidance.</div>
      </div>`;
    aside.insertBefore(card, firstHead);
  }

  function buildUsersModal() {
    const modal = document.createElement('div');
    modal.id = 'platformUsersModal';
    modal.className = 'platform-modal';
    modal.innerHTML = `<div class="platform-modal-card"><div style="display:flex;justify-content:space-between;align-items:center"><h3 style="margin:0">User management</h3><button id="platformUsersClose" class="btn ghost">Close</button></div>
      <div class="platform-row" style="margin-top:12px"><input id="newUserName" placeholder="Display name"><input id="newUserEmail" placeholder="Email"></div>
      <div class="platform-row" style="margin-top:8px"><input id="newUserPassword" type="password" placeholder="Temporary password"><select id="newUserRole"><option>DEV</option><option>QA</option><option>MANAGER</option></select></div>
      <button id="newUserCreate" class="btn secondary" style="margin-top:9px">Create user</button><div id="userAdminError" class="platform-error"></div><div id="userList"></div></div>`;
    document.body.appendChild(modal);
    document.getElementById('platformUsersClose').onclick = () => modal.classList.remove('show');
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('show'); });
    document.getElementById('newUserCreate').onclick = createUser;
  }

  async function api(url, init = {}) {
    const response = await window.fetch(url, init);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.reply || `Request failed (${response.status})`);
    return data;
  }

  async function login() {
    try {
      document.getElementById('platformAuthError').textContent = '';
      const data = await api('/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ email:document.getElementById('platformEmail').value, password:document.getElementById('platformPassword').value }) });
      setToken(data.token); currentUser = data.user; await renderSignedIn();
    } catch (err) { document.getElementById('platformAuthError').textContent = err.message; }
  }

  async function bootstrap() {
    try {
      const email = document.getElementById('platformEmail').value.trim();
      const password = document.getElementById('platformPassword').value;
      if (!email || !password) throw new Error('Enter the first manager email and password first.');
      await api('/api/auth/bootstrap', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ email, password, displayName: email.split('@')[0] || 'Manager' }) });
      await login();
    } catch (err) { document.getElementById('platformAuthError').textContent = err.message; }
  }

  async function restore() {
    if (!token()) return;
    try {
      const data = await api('/api/auth/me');
      currentUser = { id:data.user.sub, email:data.user.email, displayName:data.user.name, role:data.user.role };
      await renderSignedIn();
    } catch { setToken(''); }
  }

  function applyRoleUi() {
    const role = String(currentUser?.role || '').toUpperCase();
    const canTest = role === 'QA' || role === 'MANAGER';
    const generate = document.getElementById('generateBtn');
    const run = document.getElementById('runBtn');
    if (generate) generate.disabled = !canTest;
    if (!canTest && run) run.disabled = true;
    document.getElementById('platformUsers').style.display = role === 'MANAGER' ? '' : 'none';
    if (!canTest) document.getElementById('platformContextHint').textContent = 'Developer role: review assigned defects and source-aware fix guidance. Test generation/execution is QA/Manager controlled.';
  }

  async function renderSignedIn() {
    document.getElementById('platformSignedOut').style.display = 'none';
    document.getElementById('platformSignedIn').style.display = '';
    document.getElementById('platformUserName').textContent = currentUser.displayName || currentUser.email;
    document.getElementById('platformUserRole').textContent = currentUser.role;
    applyRoleUi();
    await loadProjects();
  }

  async function loadProjects() {
    const select = document.getElementById('platformProject');
    const data = await api('/api/projects');
    select.innerHTML = '<option value="">Select project</option>' + (data.projects || []).map((p) => `<option value="${p.id}">${String(p.name).replace(/</g,'&lt;')}</option>`).join('');
    if (projectId && [...select.options].some(o => o.value === projectId)) select.value = projectId;
    else projectId = select.value;
    await loadRepositories();
  }

  async function loadRepositories() {
    const select = document.getElementById('platformRepo');
    select.innerHTML = '<option value="">Black-box only</option>';
    if (!projectId) { repositoryId=''; return; }
    const data = await api(`/api/projects/${encodeURIComponent(projectId)}/repositories`);
    select.innerHTML += (data.repositories || []).map((r) => `<option value="${r.id}">${String(r.repo_full_name).replace(/</g,'&lt;')} · ${String(r.default_branch).replace(/</g,'&lt;')}</option>`).join('');
    if (repositoryId && [...select.options].some(o => o.value === repositoryId)) select.value = repositoryId;
    else repositoryId = select.value;
    document.getElementById('platformContextHint').textContent = repositoryId ? 'Source-aware mode enabled for new runs.' : 'Black-box mode. Select a repository to enable exact source candidate guidance.';
  }

  async function showUsers() {
    const modal = document.getElementById('platformUsersModal'); modal.classList.add('show');
    try {
      const data = await api('/api/users');
      document.getElementById('userList').innerHTML = `<table class="platform-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead><tbody>${(data.users||[]).map(u=>`<tr><td>${u.displayName||u.display_name}</td><td>${u.email}</td><td>${u.role}</td></tr>`).join('')}</tbody></table>`;
    } catch (err) { document.getElementById('userAdminError').textContent = err.message; }
  }

  async function createUser() {
    try {
      document.getElementById('userAdminError').textContent='';
      await api('/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName:document.getElementById('newUserName').value,email:document.getElementById('newUserEmail').value,password:document.getElementById('newUserPassword').value,role:document.getElementById('newUserRole').value})});
      await showUsers();
    } catch(err){ document.getElementById('userAdminError').textContent=err.message; }
  }

  injectStyles(); buildPanel(); buildUsersModal();
  document.getElementById('platformLogin').onclick = login;
  document.getElementById('platformBootstrap').onclick = bootstrap;
  document.getElementById('platformLogout').onclick = () => { setToken(''); currentUser=null; projectId='';repositoryId=''; location.reload(); };
  document.getElementById('platformRefresh').onclick = loadProjects;
  document.getElementById('platformUsers').onclick = showUsers;
  document.getElementById('platformProject').onchange = async (e) => { projectId=e.target.value; repositoryId=''; await loadRepositories(); };
  document.getElementById('platformRepo').onchange = (e) => { repositoryId=e.target.value; document.getElementById('platformContextHint').textContent = repositoryId ? 'Source-aware mode enabled for new runs.' : 'Black-box mode.'; };
  restore();
})();

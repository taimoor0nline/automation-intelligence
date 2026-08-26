(function () {
  const TOKEN_KEY = 'aiTestPilotToken';
  let currentUser = null;
  let projectId = '';
  let repositoryId = '';
  const nativeFetch = window.fetch.bind(window);

  function token() { return sessionStorage.getItem(TOKEN_KEY) || ''; }
  function setToken(value) { if (value) sessionStorage.setItem(TOKEN_KEY, value); else sessionStorage.removeItem(TOKEN_KEY); }
  function authHeaders(headers = {}) { return token() ? { ...headers, Authorization: `Bearer ${token()}` } : headers; }
  function esc(value) { return String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;'); }

  window.fetch = async function(input, init = {}) {
    const url = typeof input === 'string' ? input : input?.url;
    const nextInit = { ...init, headers: authHeaders(init.headers || {}) };
    if (url === '/api/chat' && nextInit.method === 'POST' && typeof nextInit.body === 'string') {
      try {
        const payload = JSON.parse(nextInit.body);
        if (payload.message !== 'approve reviewed cases' && payload.sessionId && projectId) {
          const contextResponse = await nativeFetch(`/api/sessions/${encodeURIComponent(payload.sessionId)}/context`, {
            method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ projectId, repositoryId: repositoryId || null })
          });
          if (!contextResponse.ok) {
            const error = await contextResponse.json().catch(() => ({}));
            throw new Error(error.reply || 'Could not attach project/source repository to this run.');
          }
        }
      } catch (err) { if (!(err instanceof SyntaxError)) throw err; }
    }
    return nativeFetch(input, nextInit);
  };

  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .platform-card{margin-bottom:14px;padding:12px;border:1px solid #dbe3ff;border-radius:10px;background:#f8fbff}.platform-row{display:grid;grid-template-columns:1fr 1fr;gap:8px}.platform-card select,.platform-card input,.platform-modal input,.platform-modal select{width:100%;border:1px solid var(--border);border-radius:8px;padding:8px;background:#fff}.platform-label{font-size:10.5px;font-weight:800;color:#475569;margin:6px 0 4px}.platform-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:9px}.platform-actions button{font-size:10.5px;padding:7px 9px}.platform-user{font-size:11px;color:#334155;font-weight:700}.platform-role{display:inline-block;margin-left:5px;padding:2px 6px;border-radius:999px;background:#e0e7ff;color:#3730a3;font-size:9px}.platform-modal{position:fixed;inset:0;background:rgba(15,23,42,.48);display:none;align-items:center;justify-content:center;z-index:120;padding:18px}.platform-modal.show{display:flex}.platform-modal-card{width:min(760px,100%);max-height:88vh;overflow:auto;background:#fff;border-radius:14px;padding:18px;border:1px solid var(--border)}.platform-table{width:100%;border-collapse:collapse;margin-top:10px}.platform-table td,.platform-table th{padding:8px;border-bottom:1px solid #eef1f6;text-align:left;font-size:11px}.platform-error{color:#b91c1c;font-size:10.5px;margin-top:7px;white-space:pre-wrap}.platform-divider{height:1px;background:#eef1f6;margin:14px 0}.platform-small{font-size:10.5px;color:#64748b;line-height:1.4}`;
    document.head.appendChild(style);
  }

  function buildPanel() {
    const aside = document.querySelector('aside.panel'); if (!aside) return;
    const card = document.createElement('div'); card.className='platform-card';
    card.innerHTML = `<div id="platformSignedOut"><div class="platform-label">Platform sign in</div><div class="platform-row"><input id="platformEmail" placeholder="Email"><input id="platformPassword" type="password" placeholder="Password"></div><div class="platform-actions"><button id="platformLogin" class="btn secondary" type="button">Sign in</button><button id="platformBootstrap" class="btn ghost" type="button">Bootstrap first manager</button></div><div class="platform-error" id="platformAuthError"></div></div>
      <div id="platformSignedIn" style="display:none"><div class="platform-user"><span id="platformUserName"></span><span id="platformUserRole" class="platform-role"></span></div><div class="platform-row"><div><div class="platform-label">Project</div><select id="platformProject"><option value="">Select project</option></select></div><div><div class="platform-label">Source repository</div><select id="platformRepo"><option value="">Black-box only</option></select></div></div><div class="platform-actions"><button id="platformRefresh" class="btn ghost" type="button">Refresh</button><button id="platformAdmin" class="btn ghost" type="button" style="display:none">Platform setup</button><button id="platformUsers" class="btn ghost" type="button" style="display:none">Users</button><button id="platformLogout" class="btn ghost" type="button">Sign out</button></div><div class="sub" id="platformContextHint">Select a project. A repository enables source-aware developer fix guidance.</div></div>`;
    aside.insertBefore(card, aside.querySelector('.section-head'));
  }

  function modalBase(id, title, body) {
    const modal=document.createElement('div'); modal.id=id; modal.className='platform-modal';
    modal.innerHTML=`<div class="platform-modal-card"><div style="display:flex;justify-content:space-between;align-items:center"><h3 style="margin:0">${title}</h3><button class="btn ghost" data-close>Close</button></div>${body}</div>`;
    document.body.appendChild(modal); modal.querySelector('[data-close]').onclick=()=>modal.classList.remove('show'); modal.addEventListener('click',e=>{if(e.target===modal)modal.classList.remove('show')}); return modal;
  }

  function buildModals() {
    const users=modalBase('platformUsersModal','User management',`<div class="platform-row" style="margin-top:12px"><input id="newUserName" placeholder="Display name"><input id="newUserEmail" placeholder="Email"></div><div class="platform-row" style="margin-top:8px"><input id="newUserPassword" type="password" placeholder="Temporary password"><select id="newUserRole"><option>DEV</option><option>QA</option><option>MANAGER</option></select></div><button id="newUserCreate" class="btn secondary" style="margin-top:9px">Create user</button><div id="userAdminError" class="platform-error"></div><div id="userList"></div>`);
    document.getElementById('newUserCreate').onclick=createUser;
    const admin=modalBase('platformAdminModal','Platform setup',`<div class="platform-label" style="margin-top:12px">Create project</div><div class="platform-row"><input id="newProjectName" placeholder="Project name"><input id="newProjectDescription" placeholder="Description"></div><button id="newProjectCreate" class="btn secondary" style="margin-top:8px">Create project</button><div class="platform-divider"></div><div class="platform-label">Add source repository to selected project</div><div class="platform-row"><input id="newRepoName" placeholder="owner/repository"><input id="newRepoBranch" value="main" placeholder="Default branch"></div><div class="platform-small" style="margin-top:6px">Private repositories require a server-side GITHUB_SOURCE_TOKEN. The token is never sent to the browser.</div><button id="newRepoCreate" class="btn secondary" style="margin-top:8px">Add repository</button><div id="platformSetupError" class="platform-error"></div>`);
    document.getElementById('newProjectCreate').onclick=createProject; document.getElementById('newRepoCreate').onclick=createRepository;
  }

  async function api(url,init={}) { const r=await window.fetch(url,init); const d=await r.json().catch(()=>({})); if(!r.ok)throw new Error(d.reply||`Request failed (${r.status})`); return d; }
  async function login(){try{document.getElementById('platformAuthError').textContent='';const d=await api('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:document.getElementById('platformEmail').value,password:document.getElementById('platformPassword').value})});setToken(d.token);currentUser=d.user;await renderSignedIn()}catch(e){document.getElementById('platformAuthError').textContent=e.message}}
  async function bootstrap(){try{const email=document.getElementById('platformEmail').value.trim(),password=document.getElementById('platformPassword').value;if(!email||!password)throw new Error('Enter the first manager email and password first.');await api('/api/auth/bootstrap',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,displayName:email.split('@')[0]||'Manager'})});await login()}catch(e){document.getElementById('platformAuthError').textContent=e.message}}
  async function restore(){if(!token())return;try{const d=await api('/api/auth/me');currentUser={id:d.user.sub,email:d.user.email,displayName:d.user.name,role:d.user.role};await renderSignedIn()}catch{setToken('')}}
  function applyRoleUi(){const role=String(currentUser?.role||'').toUpperCase(),canTest=role==='QA'||role==='MANAGER';if(document.getElementById('generateBtn'))document.getElementById('generateBtn').disabled=!canTest;if(!canTest&&document.getElementById('runBtn'))document.getElementById('runBtn').disabled=true;document.getElementById('platformUsers').style.display=role==='MANAGER'?'':'none';document.getElementById('platformAdmin').style.display=role==='MANAGER'?'':'none';if(!canTest)document.getElementById('platformContextHint').textContent='Developer role: review assigned defects and source-aware fix guidance. Test generation/execution is QA/Manager controlled.'}
  async function renderSignedIn(){document.getElementById('platformSignedOut').style.display='none';document.getElementById('platformSignedIn').style.display='';document.getElementById('platformUserName').textContent=currentUser.displayName||currentUser.email;document.getElementById('platformUserRole').textContent=currentUser.role;applyRoleUi();await loadProjects()}
  async function loadProjects(){const s=document.getElementById('platformProject'),d=await api('/api/projects');s.innerHTML='<option value="">Select project</option>'+(d.projects||[]).map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');if(projectId&&[...s.options].some(o=>o.value===projectId))s.value=projectId;else projectId=s.value;await loadRepositories()}
  async function loadRepositories(){const s=document.getElementById('platformRepo');s.innerHTML='<option value="">Black-box only</option>';if(!projectId){repositoryId='';return}const d=await api(`/api/projects/${encodeURIComponent(projectId)}/repositories`);s.innerHTML+=(d.repositories||[]).map(r=>`<option value="${r.id}">${esc(r.repo_full_name)} · ${esc(r.default_branch)}</option>`).join('');if(repositoryId&&[...s.options].some(o=>o.value===repositoryId))s.value=repositoryId;else repositoryId=s.value;document.getElementById('platformContextHint').textContent=repositoryId?'Source-aware mode enabled for new runs.':'Black-box mode. Select a repository to enable exact source candidate guidance.'}
  async function showUsers(){document.getElementById('platformUsersModal').classList.add('show');try{const d=await api('/api/users');document.getElementById('userList').innerHTML=`<table class="platform-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead><tbody>${(d.users||[]).map(u=>`<tr><td>${esc(u.displayName||u.display_name)}</td><td>${esc(u.email)}</td><td>${esc(u.role)}</td></tr>`).join('')}</tbody></table>`}catch(e){document.getElementById('userAdminError').textContent=e.message}}
  async function createUser(){try{document.getElementById('userAdminError').textContent='';await api('/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName:document.getElementById('newUserName').value,email:document.getElementById('newUserEmail').value,password:document.getElementById('newUserPassword').value,role:document.getElementById('newUserRole').value})});await showUsers()}catch(e){document.getElementById('userAdminError').textContent=e.message}}
  async function createProject(){try{const name=document.getElementById('newProjectName').value.trim();if(!name)throw new Error('Project name is required.');const d=await api('/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,description:document.getElementById('newProjectDescription').value})});projectId=d.project.id;repositoryId='';await loadProjects();document.getElementById('platformProject').value=projectId;await loadRepositories();document.getElementById('platformSetupError').textContent='Project created.'}catch(e){document.getElementById('platformSetupError').textContent=e.message}}
  async function createRepository(){try{if(!projectId)throw new Error('Select or create a project first.');const repoFullName=document.getElementById('newRepoName').value.trim();const defaultBranch=document.getElementById('newRepoBranch').value.trim()||'main';const d=await api(`/api/projects/${encodeURIComponent(projectId)}/repositories`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({repoFullName,defaultBranch})});repositoryId=d.repository.id;await loadRepositories();document.getElementById('platformRepo').value=repositoryId;document.getElementById('platformContextHint').textContent='Source-aware mode enabled for new runs.';document.getElementById('platformSetupError').textContent='Repository connected to project.'}catch(e){document.getElementById('platformSetupError').textContent=e.message}}

  injectStyles();buildPanel();buildModals();document.getElementById('platformLogin').onclick=login;document.getElementById('platformBootstrap').onclick=bootstrap;document.getElementById('platformLogout').onclick=()=>{setToken('');location.reload()};document.getElementById('platformRefresh').onclick=loadProjects;document.getElementById('platformUsers').onclick=showUsers;document.getElementById('platformAdmin').onclick=()=>document.getElementById('platformAdminModal').classList.add('show');document.getElementById('platformProject').onchange=async e=>{projectId=e.target.value;repositoryId='';await loadRepositories()};document.getElementById('platformRepo').onchange=e=>{repositoryId=e.target.value;document.getElementById('platformContextHint').textContent=repositoryId?'Source-aware mode enabled for new runs.':'Black-box mode.'};restore();
})();

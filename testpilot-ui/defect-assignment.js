(function(){
  let decorating=false;
  const MODE_KEY='aiTestPilotDemoTestMode';
  function token(){return sessionStorage.getItem('aiTestPilotToken')||''}
  function headers(extra={}){return token()?{...extra,Authorization:`Bearer ${token()}`} : extra}
  async function api(url,init={}){const r=await fetch(url,{...init,headers:headers(init.headers||{})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.reply||`Request failed (${r.status})`);return d}
  function role(){return String(document.getElementById('platformUserRole')?.textContent||'').trim().toUpperCase()}
  function projectId(){return document.getElementById('platformProject')?.value||''}
  function esc(v){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;')}
  function insertBeforeIfChild(parent,node,before){
    if(!parent||!node)return;
    if(before&&before.parentNode===parent)parent.insertBefore(node,before);
    else parent.appendChild(node);
  }

  function addModeStyles(){
    if(document.getElementById('testModeStyles'))return;
    const style=document.createElement('style');
    style.id='testModeStyles';
    style.textContent=`
      .test-mode-switch{display:flex;align-items:center;gap:6px;margin-left:auto;margin-right:8px}
      .test-mode-switch button,.test-mode-switch a,.test-mode-switch span{border:1px solid var(--border);border-radius:8px;padding:7px 9px;background:#fff;color:#475569;font-size:11px;font-weight:800;text-decoration:none;cursor:pointer}
      .test-mode-switch .active{background:#eef2ff;border-color:#c7d2fe;color:#3730a3}
      .test-mode-modal{position:fixed;inset:0;z-index:120;background:rgba(15,23,42,.56);display:flex;align-items:center;justify-content:center;padding:18px}
      .test-mode-card{width:min(720px,100%);background:#fff;border-radius:18px;border:1px solid var(--border);box-shadow:0 30px 80px rgba(15,23,42,.25);padding:24px}
      .test-mode-card h2{font-size:19px;margin:0}.test-mode-card .intro{color:#64748b;font-size:12px;line-height:1.55;margin-top:7px}
      .test-mode-options{display:grid;grid-template-columns:1fr 1fr;gap:13px;margin-top:18px}
      .test-mode-option{border:1px solid #dbe3ff;border-radius:14px;background:#f8faff;padding:18px;text-align:left;cursor:pointer}
      .test-mode-option:hover{border-color:#8098ff;box-shadow:0 8px 24px rgba(47,91,255,.10)}
      .test-mode-option strong{display:block;font-size:15px;color:#1e3a8a}.test-mode-option span{display:block;font-size:11px;color:#64748b;line-height:1.5;margin-top:6px}
      .web-auth-note{font-size:10.5px;color:#64748b;line-height:1.45;margin-top:5px}
      @media(max-width:760px){.test-mode-options{grid-template-columns:1fr}.test-mode-switch{width:100%;margin:6px 0 0}.test-mode-switch a,.test-mode-switch button,.test-mode-switch span{flex:1;text-align:center}header{height:auto;min-height:68px;flex-wrap:wrap;padding-top:8px;padding-bottom:8px}}
    `;
    document.head.appendChild(style);
  }

  function ensureModeSwitch(){
    const header=document.querySelector('header');
    if(!header||document.getElementById('testModeSwitch'))return;
    const directStatus=[...header.children].find((child)=>child.classList?.contains('status'))||null;
    const box=document.createElement('div');
    box.id='testModeSwitch';
    box.className='test-mode-switch';
    box.innerHTML='<span class="active">Web UI</span><a href="/rest.html">REST API</a><a href="/live" target="_blank" rel="noopener">Live Browser</a>';
    insertBeforeIfChild(header,box,directStatus);
  }

  function setupOptionalWebAuth(){
    const username=document.getElementById('username');
    const password=document.getElementById('password');
    if(!username||!password||document.getElementById('webAuthMode'))return;
    const usernameField=username.closest('.field');
    const passwordField=password.closest('.field');
    const pair=usernameField?.parentElement;
    if(!usernameField||!passwordField||!pair)return;

    const authField=document.createElement('div');
    authField.className='field';
    authField.innerHTML='<label>Application login</label><select id="webAuthMode"><option value="USERNAME_PASSWORD">Username / password</option><option value="NONE">No login required</option></select><div class="web-auth-note">Optional. Use “No login required” for public pages such as Google or any application journey that does not require authentication.</div>';
    insertBeforeIfChild(pair.parentElement,authField,pair);
    const select=authField.querySelector('select');

    const headingSub=pair.parentElement?.querySelector('.section-head .sub');
    if(headingSub)headingSub.textContent='Application login is optional. Credentials stay in runtime memory, are used only when the approved test requires login, and are not sent to the AI model.';

    function apply(){
      const none=select.value==='NONE';
      if(none){
        if(username.value)username.dataset.savedValue=username.value;
        if(password.value)password.dataset.savedValue=password.value;
        username.value='';password.value='';
      }else{
        if(!username.value&&username.dataset.savedValue)username.value=username.dataset.savedValue;
        if(!password.value&&password.dataset.savedValue)password.value=password.dataset.savedValue;
      }
      usernameField.style.display=none?'none':'';
      passwordField.style.display=none?'none':'';
      if(pair.classList.contains('two'))pair.style.gridTemplateColumns=none?'1fr':'';
    }
    select.addEventListener('change',apply);
    apply();
  }

  function showDemoModeChooser(){
    if(document.getElementById('testModeChooser'))return;
    const modal=document.createElement('div');
    modal.id='testModeChooser';
    modal.className='test-mode-modal';
    modal.innerHTML=`<div class="test-mode-card"><h2>What would you like to test?</h2><div class="intro">Choose a testing workspace for this demo. You can switch between Web UI and REST API at any time from the header.</div><div class="test-mode-options"><button type="button" class="test-mode-option" data-mode="WEB"><strong>Web UI testing</strong><span>Target URL → business story → AI test cases → human review → deterministic Cypress execution → live browser → PASS/FAIL.</span></button><button type="button" class="test-mode-option" data-mode="REST"><strong>REST API testing</strong><span>Swagger/OpenAPI or manual endpoints → request templates/auth → AI API cases → human review → deterministic cy.request() → PASS/FAIL.</span></button></div></div>`;
    modal.querySelector('[data-mode="WEB"]').onclick=()=>{sessionStorage.setItem(MODE_KEY,'WEB');modal.remove()};
    modal.querySelector('[data-mode="REST"]').onclick=()=>{sessionStorage.setItem(MODE_KEY,'REST');window.location.href='/rest.html'};
    document.body.appendChild(modal);
  }

  async function setupTestModeExperience(){
    addModeStyles();
    ensureModeSwitch();
    setupOptionalWebAuth();
    try{
      const health=await fetch('/health').then(r=>r.json());
      if(!health.database?.configured&&!sessionStorage.getItem(MODE_KEY))showDemoModeChooser();
    }catch{}
  }

  function ensureRestEntry(){
    const actions=document.querySelector('#platformSignedIn .platform-actions');
    if(!actions)return;
    let button=document.getElementById('platformRestApi');
    if(!button){
      button=document.createElement('button');
      button.id='platformRestApi';
      button.type='button';
      button.className='btn ghost';
      button.textContent='REST API';
      button.onclick=()=>{window.location.href='/rest.html'};
      const defects=document.getElementById('platformDefects');
      const before=defects?.parentNode===actions?defects:actions.firstElementChild;
      insertBeforeIfChild(actions,button,before);
    }
    button.style.display=['QA','MANAGER'].includes(role())?'':'none';
  }

  async function decorate(){
    ensureRestEntry();
    if(decorating||!['QA','MANAGER'].includes(role())||!projectId())return;
    const list=document.getElementById('platformDefectList');
    if(!list||!list.querySelector('.defect-card'))return;
    decorating=true;
    try{
      const [devData,defectData]=await Promise.all([api('/api/developers'),api(`/api/projects/${encodeURIComponent(projectId())}/defects`)]);
      const developers=devData.developers||[];
      const defects=new Map((defectData.defects||[]).map(d=>[String(d.id),d]));
      list.querySelectorAll('.defect-card').forEach(card=>{
        if(card.querySelector('[data-assignment-ui]'))return;
        const resolve=card.querySelector('[data-resolve]');
        if(!resolve)return;
        const defect=defects.get(String(resolve.dataset.resolve));
        if(!defect)return;
        const box=document.createElement('div');
        box.dataset.assignmentUi='1';
        box.className='platform-actions';
        const options=['<option value="">Unassigned</option>',...developers.map(d=>`<option value="${esc(d.id)}"${String(defect.assigned_to||'')===String(d.id)?' selected':''}>${esc(d.displayName||d.email)}</option>`)].join('');
        box.innerHTML=`<select data-dev-select style="max-width:240px">${options}</select><button class="btn ghost" type="button" data-assign-dev>Assign developer</button><span class="platform-small" data-assign-status></span>`;
        card.appendChild(box);
        box.querySelector('[data-assign-dev]').onclick=async()=>{
          const status=box.querySelector('[data-assign-status]');
          const userId=box.querySelector('[data-dev-select]').value||null;
          status.textContent='Saving…';
          try{
            await api(`/api/defects/${encodeURIComponent(defect.id)}/assign`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId})});
            status.textContent=userId?'Assigned.':'Unassigned.';
          }catch(err){status.textContent=err.message}
        };
      });
    }catch(err){console.warn('[defect-assignment]',err.message)}finally{decorating=false}
  }

  const observer=new MutationObserver(()=>decorate());
  function start(){
    setupTestModeExperience();
    ensureRestEntry();
    observer.observe(document.body,{childList:true,subtree:true,characterData:true});
    document.getElementById('platformDefects')?.addEventListener('click',()=>setTimeout(decorate,100));
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
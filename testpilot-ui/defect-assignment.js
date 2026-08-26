(function(){
  let decorating=false;
  function token(){return sessionStorage.getItem('aiTestPilotToken')||''}
  function headers(extra={}){return token()?{...extra,Authorization:`Bearer ${token()}`} : extra}
  async function api(url,init={}){const r=await fetch(url,{...init,headers:headers(init.headers||{})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.reply||`Request failed (${r.status})`);return d}
  function role(){return String(document.getElementById('platformUserRole')?.textContent||'').trim().toUpperCase()}
  function projectId(){return document.getElementById('platformProject')?.value||''}
  function esc(v){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;')}

  async function decorate(){
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
    const modal=document.getElementById('platformDefectsModal');
    if(modal)observer.observe(modal,{childList:true,subtree:true});
    document.getElementById('platformDefects')?.addEventListener('click',()=>setTimeout(decorate,100));
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();

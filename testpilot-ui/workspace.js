(function(){
'use strict';
const $=id=>document.getElementById(id), esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state={user:null,projects:[],projectId:'',context:null,tasks:[],deletedTasks:[],evidence:[],taskId:null,view:'overview'};
const token=()=>sessionStorage.getItem('aiTestPilotToken')||'';

const iconPaths={
 scan:'<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M8 10V9a1 1 0 0 1 1-1h1M14 8h1a1 1 0 0 1 1 1v1M16 14v1a1 1 0 0 1-1 1h-1M10 16H9a1 1 0 0 1-1-1v-1"/>',
 folder:'<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3z"/><path d="M3 10h18"/>',
 play:'<path d="m8 5 11 7-11 7z"/>',
 eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
 edit:'<path d="m16 4 4 4M4 20l4-.7L20 7a2 2 0 0 0-3-3L5 16z"/>',
 restore:'<path d="M3 11a9 9 0 1 1 2 6"/><path d="M3 4v7h7"/>',
 remove:'<path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7M10 11v5m4-5v5"/>',
 video:'<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3z"/>',
 image:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 16-6-6L5 21"/>',
 download:'<path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/>',
 pause:'<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
 userPlus:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
 assign:'<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M12 11v5M9.5 13.5h5"/>',
 report:'<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
 accept:'<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.8L16.5 9.5"/>',
 reject:'<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
 ai:'<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>'
};
function actionIcon(name,attributes,label){
 return '<button type="button" class="tn-icon-action" '+attributes+' aria-label="'+esc(label)+'" title="'+esc(label)+'"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'+(iconPaths[name]||iconPaths.eye)+'</svg></button>';
}


function actionLink(name,href,label){
 return '<a class="tn-icon-action" href="'+esc(href)+'" aria-label="'+esc(label)+'" title="'+esc(label)+'"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'+(iconPaths[name]||iconPaths.eye)+'</svg></a>';
}
// "View details" eye icon for the projects list, same style as the edit and run icons next to it.
function viewDetailsLink(project){
 return actionLink('eye',projectRoute(project.id),'View details: '+project.name);
}
// One row of the projects list. Clicking the row opens the project (same as View details).
function projectRow(p){
 const passed=Number(p.passed_total||0),failed=Number(p.failed_total||0),total=passed+failed;
 const rate=total?Math.round(100*passed/total):null;
 const rateHtml=rate===null?'<span class="tn-muted">No runs</span>':'<span class="tn-rate '+(rate>=90?'is-good':rate>=70?'is-warn':'is-bad')+'">'+rate+'%</span>';
 const manager=p.manager_name?'<span class="tn-row-person"><span class="tn-avatar tn-avatar-0" aria-hidden="true">'+esc(initialsOf(p.manager_name))+'</span>'+esc(p.manager_name)+'</span>':'<span class="tn-muted">—</span>';
 const envs=Number(p.environment_count||0);
 return '<tr class="tn-row-link" data-href="'+esc(projectRoute(p.id))+'"><td>'+display(p.reference_no)+'</td><td><strong>'+esc(p.name)+'</strong><div class="tn-muted">'+esc(p.description||'')+'</div></td>'
  +'<td>'+manager+'</td><td data-sort="'+envs+'">'+(envs?envs+' active':'<span class="tn-muted">None</span>')+'</td>'
  +'<td data-sort="'+esc(p.last_run_at||'')+'">'+(p.last_run_at?date(p.last_run_at):'<span class="tn-muted">Never</span>')+'</td>'
  +'<td data-sort="'+(rate===null?-1:rate)+'">'+rateHtml+'</td>'
  +createdCell(p.created_by_name,p.created_at)+updatedCell(p.updated_by_name,p.updated_at,p.created_by_name,p.created_at)
  +'<td><span class="tn-icon-actions">'+viewDetailsLink(p)+actionIcon('edit','data-edit-project="'+esc(p.id)+'"','Edit project '+p.name)+actionIcon('play','data-start-project="'+esc(p.id)+'"','Start testing project '+p.name)+'</span></td></tr>';
}
function projectRoute(projectId,section='details'){
 return '/workspace.html?projectId='+encodeURIComponent(projectId)+'#'+section;
}

function notice(message,type='danger'){const el=$('notice');el.className='alert alert-'+type;el.textContent=message;el.scrollIntoView({block:'nearest'});}
function clearNotice(){$('notice').className='alert alert-warning d-none';$('notice').textContent='';}
async function api(url,options={}){
 const headers={...options.headers};
 if(token())headers.Authorization='Bearer '+token();
 if(options.body && !headers['Content-Type'])headers['Content-Type']='application/json';
 const r=await fetch(url,{...options,headers});const d=await r.json().catch(()=>({}));
 if(!r.ok)throw Error(d.reply||'Request failed ('+r.status+')');
 return d;
}
async function loadTaskLinks(id){const box=$('drawerTestLinks');box.textContent='Loading linked cases…';try{const d=await api('/api/work-items/'+encodeURIComponent(id)+'/test-links');if(state.taskId!==id)return;const canEdit=['PROJECT_MANAGER','QA'].includes(state.taskRole);box.innerHTML=d.links.length?d.links.map(x=>'<div class="tn-sub tn-row"><span><strong>'+esc(x.external_case_id)+'</strong><span class="tn-muted d-block">Session '+esc(x.session_id)+'</span></span><span class="tn-icon-actions">'+actionIcon('remove','data-unlink-test="'+esc(x.id)+'"','Unlink case '+x.external_case_id)+'</span></div>').join(''):'<p class="tn-muted">No reusable test cases linked. Use the form below to add one.</p>'; }catch(err){box.textContent='Unable to load linked cases: '+err.message;}}
function formPayload(form){return Object.fromEntries(new FormData(form).entries());}
function date(v){return v?new Date(v).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}):'—';}
function dateTime(v){return v?new Date(v).toLocaleString('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true}):'—';}
function display(v){return v?esc(v):'<span class="tn-muted">Not set</span>';}
// Priority badge — same colours everywhere: Critical red, High orange, Medium blue, Low green.
// Audit tab: readable event name and a short summary of what changed (from the event's stored metadata).
function auditLabel(type){const t=String(type||'').toLowerCase().replaceAll('_',' ');return t.charAt(0).toUpperCase()+t.slice(1);}
function auditDetails(e){
 const m=e.metadata||{},role=r=>String(r||'').replaceAll('_',' ').toLowerCase();
 switch(e.event_type){
  case 'MEMBER_ADDED':return (m.memberName||'User')+' added as '+role(m.projectRole);
  case 'MEMBER_ROLE_CHANGED':return (m.memberName||'User')+': '+(m.previousRole?role(m.previousRole)+' → ':'')+role(m.projectRole);
  case 'MEMBER_REMOVED':return (m.memberName||'User')+' removed'+(m.previousRole?' (was '+role(m.previousRole)+')':'');
  case 'TEAM_ATTACHED':return 'Team '+(m.teamName||'')+' attached';
  case 'TEAM_CREATED':return 'Team '+(m.teamName||'')+' created';
  case 'TEAM_RENAMED':return 'Team '+(m.oldName||'')+' renamed to '+(m.teamName||'');
  case 'TEAM_DELETED':return 'Team '+(m.teamName||'')+' deleted';
  case 'MEMBER_TEAM_CHANGED':return (m.memberName||'Member')+(m.teamName?' moved to team '+m.teamName:' removed from team');
  case 'TEAM_DETACHED':return 'Team '+(m.teamName||'')+' detached';
  case 'TEAM_MEMBER_ADDED':return (m.memberName||'User')+' added to team '+(m.teamName||'');
  case 'TEAM_MEMBER_REMOVED':return (m.memberName||'User')+' removed from team '+(m.teamName||'');
  case 'TEST_CASES_SAVED':return (m.caseCount??'')+' test case(s) saved';
  case 'TEST_CASE_REVIEWED':return (m.caseId||'Case')+(m.status?' · '+role(m.status):'');
  case 'TEST_RUN_COMPLETED':return 'Run #'+(m.runNumber??'')+' · '+(m.passed??0)+' passed, '+(m.failed??0)+' failed';
  case 'ENVIRONMENT_CREATED':return m.name||'';
  case 'ENVIRONMENT_UPDATED':case 'ENVIRONMENT_DISABLED':return m.oldName&&m.newName&&m.oldName!==m.newName?m.oldName+' → '+m.newName:(m.newName||m.oldName||'');
  case 'STORY_CREATED':return m.referenceNo||'';
  case 'LEARNING_SCOPE_CHANGED':return m.scope==='GLOBAL'?'Learning made global':'Learning made local';
  case 'DOCUMENT_UPLOADED':case 'DOCUMENT_DELETED':return (m.filename||'File')+(m.category?' · '+(DOC_CATEGORIES[m.category]||m.category):'');
  case 'STORY_DELETED':return (m.referenceNo?m.referenceNo+' · ':'')+(m.title||'');
  default:return '';
 }
}
// Confirmation popup for destructive actions (shared component in confirm-dialog.js).
function confirmDanger(options){return window.TestNexusConfirm(options);}
const nameFrom=(el,prefix)=>String(el.getAttribute('aria-label')||'').replace(prefix,'').trim();
async function deleteDocument(id){
 const doc=state.context?.documents.find(x=>String(x.id)===String(id));if(!doc)return;
 const ok=await confirmDanger({title:'Delete attachment?',message:'Do you want to delete "'+doc.filename+'"?',note:'Category: '+(DOC_CATEGORIES[String(doc.category||'OTHER').toUpperCase()]||doc.category)+'. The file is removed from this project. This cannot be undone.',confirmLabel:'Delete file'});
 if(!ok)return;
 await api('/api/projects/'+encodeURIComponent(requireProject())+'/documents/'+encodeURIComponent(id),{method:'DELETE'});
 await loadWorkspace();notice('"'+doc.filename+'" deleted.','success');
}
document.addEventListener('click',e=>{const b=e.target.closest('[data-delete-doc]');if(b)deleteDocument(b.dataset.deleteDoc).catch(err=>notice(err.message));});
async function deleteStory(id){
 const story=state.context?.stories.find(x=>String(x.id)===String(id));if(!story)return;
 const name=(story.reference_no?story.reference_no+' · ':'')+story.title;
 const ok=await confirmDanger({title:'Delete this story?',message:'Do you want to delete "'+name+'"?',note:'Its test cases and run history are kept, but they will no longer be linked to this story. This cannot be undone.',confirmLabel:'Delete story'});
 if(!ok)return;
 await api('/api/projects/'+encodeURIComponent(requireProject())+'/stories/'+encodeURIComponent(id),{method:'DELETE'});
 storyPicker.stats=null;
 await loadWorkspace();show('stories','none');notice('Story "'+name+'" deleted.','success');
}
document.addEventListener('click',e=>{const b=e.target.closest('[data-delete-story]');if(b)deleteStory(b.dataset.deleteStory).catch(err=>notice(err.message));});
// Document category label (same list as the upload picker and the server).
const DOC_CATEGORIES={REQUIREMENTS:'Requirements',USER_STORIES:'User stories',UI_DESIGN:'UI design',API_SPEC:'API specification',TEST_PLAN:'Test plan',TEST_DATA:'Test data',REPORT:'Reports & evidence',OTHER:'Other'};
function categoryTag(c){const k=String(c||'OTHER').toUpperCase();return '<span class="tn-doc-cat cat-'+esc(k.toLowerCase())+'">'+esc(DOC_CATEGORIES[k]||k.replaceAll('_',' '))+'</span>';}
// "+ Create" for tasks and projects opens the create form in a popup (same as stories and environments).
function openCreatePopup(href){
 const url=new URL(href,location.origin);
 if(url.pathname==='/task-create.html'&&state.projectId)url.searchParams.set('projectId',state.projectId);
 url.searchParams.set('embed','1');
 $('createFrame').src=url.pathname+url.search;
 $('createDialog').dataset.openedAt=Date.now();$('createDialog').style.height='';$('createDialog').showModal();
}
document.addEventListener('click',e=>{
 const a=e.target.closest('a[href^="/task-create.html"],a[href^="/project-create.html"]');
 if(!a||e.ctrlKey||e.metaKey||e.shiftKey)return;
 e.preventDefault();openCreatePopup(a.getAttribute('href'));
});
// The popup fits the form when it opens, then keeps its size: longer content scrolls inside it.
window.addEventListener('message',e=>{if(e.origin===location.origin&&e.data?.type==='tn-popup-size'){const d=$('createDialog');if(Date.now()-Number(d.dataset.openedAt||0)<2500)d.style.height=Math.min(e.data.height+4,innerHeight-32)+'px';}});
window.addEventListener('message',async e=>{
 if(e.origin!==location.origin||e.data?.type!=='tn-popup-done')return;
 $('createDialog').close();$('createFrame').src='about:blank';
 if(!e.data.changed)return;
 try{
  if(e.data.kind==='project'&&e.data.projectId){window.location.href=projectRoute(e.data.projectId,'details');return;}
  await loadWorkspace();notice('Task created.','success');
 }catch(err){notice(err.message);}
});
// Home: summary across all accessible projects + one card per project (data from /api/projects).
function greeting(){
 const h=new Date().getHours(),first=String(state.user?.name||state.user?.display_name||'').split(/\s+/)[0];
 return (h<12?'Good morning':h<17?'Good afternoon':'Good evening')+(first?', '+first:'');
}
function projectHealth(p){
 const passed=Number(p.passed_total||0),failed=Number(p.failed_total||0),total=passed+failed,rate=total?Math.round(passed/total*100):null;
 if(!Number(p.environment_count||0))return {rate,cls:'setup',label:'Setup needed',hint:'Add an environment to start testing'};
 if(rate===null)return {rate,cls:'new',label:'Not tested yet',hint:'No test runs recorded'};
 if(rate>=90)return {rate,cls:'ok',label:'Healthy',hint:failed?failed+' failed test(s)':'All recorded tests passed'};
 if(rate>=70)return {rate,cls:'warn',label:'Watch',hint:failed+' failed test(s)'};
 return {rate,cls:'bad',label:'Needs attention',hint:failed+' failed test(s)'};
}
function renderHome(){
 if(state.view==='overview'&&$('pageTitle'))$('pageTitle').textContent=greeting();
 const list=state.projects||[];
 const passed=list.reduce((n,p)=>n+Number(p.passed_total||0),0),failed=list.reduce((n,p)=>n+Number(p.failed_total||0),0),total=passed+failed,rate=total?Math.round(passed/total*100):null;
 const lastRun=list.filter(p=>p.last_run_at).sort((a,b)=>new Date(b.last_run_at)-new Date(a.last_run_at))[0];
 const attention=list.filter(p=>['bad','warn','setup'].includes(projectHealth(p).cls)).length;
 const svg=p=>'<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false">'+p+'</svg>';
 const kpi=(icon,tone,label,value,extra='')=>'<div class="tn-kpi"><span class="tn-kpi-label"><span class="tn-kpi-icon tn-kpi-'+tone+'" aria-hidden="true">'+icon+'</span>'+label+'</span><b>'+value+'</b>'+extra+'</div>';
 $('homeKpis').innerHTML=
  kpi(svg('<path d="M3 7h6l2 2h10v10H3z"/>'),'blue','Projects',list.length,attention?'<div class="tn-kpi-sub">'+attention+' need attention</div>':'<div class="tn-kpi-sub">All on track</div>')+
  kpi(svg('<path d="M20 6 9 17l-5-5"/>'),rate===null?'slate':rate>=90?'green':rate>=70?'amber':'orange','Overall pass rate',rate===null?'—':rate+'%',rate===null?'':'<div class="tn-mini-bar"><span style="width:'+rate+'%"></span></div>')+
  kpi(svg('<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>'),'green','Tests passed',passed)+
  kpi(svg('<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>'),failed?'orange':'slate','Tests failed',failed)+
  kpi(svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),'violet','Last run',lastRun?esc(date(lastRun.last_run_at)):'—',lastRun?'<div class="tn-kpi-sub">'+esc(lastRun.name)+'</div>':'');
 $('homeProjectsCount').textContent=list.length;
 // Search filters the cards by name, reference or manager; without a search the 9 most recently active show.
 const q=($('homeSearch')?.value||'').trim().toLowerCase();
 const matches=[...list].filter(p=>!q||[p.name,p.reference_no,p.manager_name,p.description].join(' ').toLowerCase().includes(q));
 const ordered=matches.sort((a,b)=>new Date(b.last_run_at||b.updated_at||b.created_at)-new Date(a.last_run_at||a.updated_at||a.created_at)).slice(0,q?60:9);
 $('homeProjects').innerHTML=ordered.map(p=>{
  const h=projectHealth(p),envs=Number(p.environment_count||0);
  return '<article class="tn-home-card">'
   +'<div class="tn-home-card-top"><div class="tn-home-title"><span class="tn-home-ref">'+esc(p.reference_no||'Project')+'</span><h3>'+esc(p.name)+'</h3></div><span class="tn-health '+h.cls+'" title="'+esc(h.hint)+'">'+h.label+'</span></div>'
   +(p.description?'<p class="tn-home-desc">'+esc(p.description)+'</p>':'<p class="tn-home-desc tn-muted">No description yet.</p>')
   +'<div class="tn-home-rate"><div class="tn-home-rate-row"><span>Pass rate</span><b>'+(h.rate===null?'—':h.rate+'%')+'</b></div><div class="tn-mini-bar'+(h.rate===null?' empty':'')+'"><span style="width:'+(h.rate||0)+'%"></span></div><div class="tn-home-hint">'+esc(h.hint)+'</div></div>'
   +'<div class="tn-home-meta">'
    +(p.manager_name?'<span class="tn-row-person tn-person-sm"><span class="tn-avatar tn-avatar-0" aria-hidden="true">'+esc(initialsOf(p.manager_name))+'</span>'+esc(p.manager_name)+'</span>':'<span class="tn-muted">No manager</span>')
    +'<span>'+(p.last_run_at?'Last run '+esc(date(p.last_run_at)):'Never run')+'</span>'
    +'<span>'+envs+' environment'+(envs===1?'':'s')+'</span>'
   +'</div>'
   +'<div class="tn-home-actions"><a class="btn btn-outline-primary tn-btn" href="'+esc(projectRoute(p.id))+'">Open project</a><button type="button" class="btn btn-primary tn-btn" data-start-project="'+esc(p.id)+'">▶ Start testing</button></div>'
  +'</article>';
 }).join('')||'<div class="tn-card tn-empty tn-home-empty">'+(q?'No projects match “'+esc(q)+'”.':'No projects yet. Create your first project from Projects.')+'</div>';
}
document.addEventListener('input',e=>{if(e.target.id==='homeSearch')renderHome();});
// User management (managers): all sign-in accounts. Opened from the profile menu.
const PLATFORM_ROLES={MANAGER:'Manager',QA:'Tester / QA',DEV:'Developer'};
async function loadUsers(){
 const d=await api('/api/users');state.users=d.users||[];renderUsers();
}
// Active · All · Inactive. Accounts are deactivated, never deleted, so their name stays on runs, tasks and the Audit.
function renderUsers(){
 const all=state.users||[],f=state.userFilter||'active',inactive=all.filter(u=>!u.isActive),me=String(state.user?.sub||state.user?.id||'');
 $('userCountActive').textContent=all.length-inactive.length;$('userCountAll').textContent=all.length;$('userCountInactive').textContent=inactive.length;
 for(const b of document.querySelectorAll('[data-user-filter]'))b.setAttribute('aria-checked',String(b.dataset.userFilter===f));
 const list=f==='all'?all:f==='inactive'?inactive:all.filter(u=>u.isActive);
 $('usersBody').innerHTML=list.map(u=>'<tr><td><span class="tn-row-person tn-person-sm"><span class="tn-avatar tn-avatar-0" aria-hidden="true">'+esc(initialsOf(u.displayName||u.email))+'</span><span><strong>'+esc(u.displayName)+'</strong><span class="tn-member-email">'+esc(u.email)+'</span></span></span></td><td><span class="tn-role-chip role-'+esc(u.role==='DEV'?'DEVELOPER':u.role==='MANAGER'?'PROJECT_MANAGER':u.role)+'">'+esc(PLATFORM_ROLES[u.role]||u.role)+'</span></td><td>'+(u.isActive?'<span class="tn-result pass">Active</span>':'<span class="tn-result fail">Inactive</span>')+'</td>'
  +createdCell(u.createdByName,u.createdAt)+updatedCell(u.updatedByName,u.updatedAt,u.createdByName,u.createdAt)
  +'<td><span class="tn-icon-actions">'+(String(u.id)===me?'<span class="tn-muted small">You</span>':u.isActive?actionIcon('pause','data-user-status="deactivate" data-user-id="'+esc(u.id)+'"','Deactivate '+(u.displayName||u.email)):actionIcon('restore','data-user-status="activate" data-user-id="'+esc(u.id)+'"','Activate '+(u.displayName||u.email)))+'</span></td></tr>').join('')
  ||'<tr><td colspan="6" class="tn-empty">'+(f==='inactive'?'No inactive users.':'No users.')+'</td></tr>';
}
document.addEventListener('click',async e=>{
 const f=e.target.closest('[data-user-filter]');if(f){state.userFilter=f.dataset.userFilter;renderUsers();return;}
 const b=e.target.closest('[data-user-status]');if(!b)return;
 const u=(state.users||[]).find(x=>String(x.id)===String(b.dataset.userId));if(!u)return;
 const activate=b.dataset.userStatus==='activate',name=u.displayName||u.email;
 if(!await confirmDanger({title:(activate?'Activate ':'Deactivate ')+name+'?',message:activate?name+' can sign in again and can be added to teams and projects.':name+' can no longer sign in and is signed out at once. Their name stays on runs, tasks and the Audit. They are not offered when adding people to teams or projects.',confirmLabel:activate?'Activate':'Deactivate',tone:'warning'}))return;
 try{await api('/api/users/'+encodeURIComponent(u.id)+'/status',{method:'PATCH',body:JSON.stringify({active:activate})});notice((activate?'Activated ':'Deactivated ')+name+'.','success');await loadUsers();}catch(err){notice(err.message);}
});
// Source code tab: the project's GitHub repositories, laid out like Environments —
// + Create, a table (search, paging), 👁 View · ✏ Edit · ⛶ Scan · 🗑 Delete, and one popup for create / edit / view.
let repoList=[];
const repoIcon='<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9"/></svg>';
const repoAccess=r=>'<span class="tn-repo-token'+(r.has_token?' on':'')+'">'+(r.has_token?'🔒 Token saved':'Public · no token')+'</span>';
async function loadRepos(){
 const [d]=await Promise.all([api('/api/projects/'+encodeURIComponent(state.projectId)+'/repositories'),loadCodeStatus(),fetchScans()]);
 repoList=d.repositories||[];
 const role=state.context?.projectRole,canEdit=['PROJECT_MANAGER','QA'].includes(role),isPm=role==='PROJECT_MANAGER';
 $('repoCount').textContent=repoList.length;
 $('repoCreate').hidden=!canEdit;
 $('detailRepos').innerHTML=repoList.map(r=>{
  const name=r.repo_full_name;
  const actions=actionIcon('eye','data-repo-open="view" data-repo-id="'+esc(r.id)+'"','View repository '+name)
   +(canEdit?actionIcon('edit','data-repo-open="edit" data-repo-id="'+esc(r.id)+'"','Edit repository '+name):'')
   // ⛶ Scan the repository's default branch (the whole repository). Other branches, pull requests or commits are chosen per story (Scan by).
   +(canEdit?actionIcon('scan','data-repo-scan="'+esc(r.id)+'"'+(ciEnabled?'':' data-blocked="Code scanning is not enabled on this server."'),'Scan '+name+' (default branch '+(r.default_branch||'main')+')'+(ciEnabled?'':' · code scanning is not enabled on this server')):'')
   +(isPm?actionIcon('remove','data-repo-remove="'+esc(r.id)+'" data-repo-name="'+esc(name)+'"','Delete repository '+name):'');
  return '<tr><td><div class="tn-repo">'+repoIcon+'<a href="'+esc(r.repository_url||'#')+'" target="_blank" rel="noopener"><strong>'+esc(name)+'</strong></a></div><div><span class="tn-provider '+(r.provider==='gitlab'?'gl':'gh')+'">'+providerName(r)+'</span>'+(r.provider==='gitlab'&&r.api_base_url&&r.api_base_url!=='https://gitlab.com'?' <span class="tn-muted small">'+esc(r.api_base_url.replace(/^https:\/\//,''))+'</span>':'')+'</div></td>'
   +'<td>'+esc(r.default_branch||'main')+'</td><td>'+repoAccess(r)+'</td>'
   +'<td>'+lastScanCell(r)+'</td>'
   +createdCell(r.created_by_name,r.created_at)+updatedCell(r.updated_by_name,r.updated_at,r.created_by_name,r.created_at)
   +'<td><span class="tn-icon-actions">'+actions+'</span></td></tr>';
 }).join('')||'<tr><td colspan="7" class="tn-empty">No repository added yet.'+(canEdit?' Add the first one.':'')+' Testing works without one.</td></tr>';
}
function repoFormError(m){const el=$('repoFormError');el.textContent=m||'';el.classList.toggle('d-none',!m);}
// One popup: Create (+ Create), Edit (✏) or View (👁). The repository name is fixed once linked.
const providerName=r=>r?.provider==='gitlab'?'GitLab':'GitHub';
// The popup's hints and placeholders follow the chosen provider.
function syncRepoProvider(r){
 const gl=(document.querySelector('input[name="repoProvider"]:checked')?.value||'github')==='gitlab';
 $('repoBaseUrlField').hidden=!gl;
 $('repoFullName').placeholder=gl?'group/project':'owner/repository';
 $('repoNameHint').textContent=r?'The repository cannot be changed. Delete it and link another one instead.':gl?'As on GitLab, e.g. gitlab-examples/nodejs (subgroups allowed: group/subgroup/project)':'As on GitHub, e.g. testsmith-io/practice-software-testing';
 $('repoToken').placeholder=r?.has_token?'Leave empty to keep the saved token':gl?'Read-only GitLab token (read_repository) · only for private projects':'Read-only GitHub token (only for private repositories)';
 $('repoTokenHint').textContent='Public '+(gl?'project':'repository')+': leave empty. The token is checked with '+(gl?'GitLab':'GitHub')+' and saved encrypted; it is never shown again.';
}
document.addEventListener('change',e=>{if(e.target.name==='repoProvider')syncRepoProvider(null);});
function openRepoModal(mode,r){
 const view=mode==='view',edit=mode==='edit';
 $('repoEditForm').reset();repoFormError('');
 $('repoId').value=r?.id||'';
 $('repoModalTitle').textContent=view?'Repository':edit?'Edit repository':'Add repository';
 $('repoModalSub').textContent=r?r.repo_full_name+' · '+providerName(r):'A GitHub or GitLab repository of this project';
 // Provider (GitHub / GitLab) and GitLab address: chosen when adding; fixed afterwards.
 const prov=r?.provider==='gitlab'?'gitlab':'github';
 for(const x of document.querySelectorAll('input[name="repoProvider"]')){x.checked=x.value===prov;x.disabled=!!r;}
 $('repoBaseUrl').value=r?.api_base_url||'';$('repoBaseUrl').readOnly=!!r;
 $('repoFullName').value=r?.repo_full_name||'';$('repoFullName').readOnly=!!r;
 $('repoDefaultBranch').value=r?.default_branch||'';$('repoDefaultBranch').readOnly=view;
 $('repoToken').closest('.tn-field').hidden=view;
 syncRepoProvider(r);
 $('repoRemoveTokenWrap').hidden=!(edit&&r?.has_token);
 $('repoViewInfo').hidden=!view;
 $('repoViewInfo').innerHTML=view?'<div class="tn-kv"><span>Provider</span><span>'+providerName(r)+(r.provider==='gitlab'?' · '+esc(r.api_base_url||'https://gitlab.com'):'')+'</span></div><div class="tn-kv"><span>Access</span><span>'+repoAccess(r)+'</span></div><div class="tn-kv"><span>Last scan</span><span>'+lastScanCell(r)+'</span></div>'
  +'<div class="tn-kv"><span>Created</span><span>'+esc(r.created_by_name||'—')+' · '+dateTime(r.created_at)+'</span></div><div class="tn-kv"><span>Last updated</span><span>'+esc(r.updated_by_name||r.created_by_name||'—')+' · '+dateTime(r.updated_at||r.created_at)+'</span></div>':'';
 $('repoSave').hidden=view;
 bootstrap.Modal.getOrCreateInstance($('repoModal')).show();
}
document.addEventListener('click',async e=>{
 if(e.target.closest('#repoCreate')){openRepoModal('create');return;}
 const open=e.target.closest('[data-repo-open]');
 if(open){const r=repoList.find(x=>String(x.id)===String(open.dataset.repoId));if(r)openRepoModal(open.dataset.repoOpen,r);return;}
 const unlink=e.target.closest('[data-repo-remove]');
 if(unlink){
  const ok=await confirmDanger({title:'Delete this repository?',message:'Do you want to delete "'+unlink.dataset.repoName+'" from this project?',note:'Its saved token is deleted too. Stories keep their code branch name, and past test results are kept. You can link the repository again later.',confirmLabel:'Delete repository'});
  if(!ok)return;
  try{await api('/api/projects/'+encodeURIComponent(requireProject())+'/repositories/'+encodeURIComponent(unlink.dataset.repoRemove),{method:'DELETE'});clearTargetCache();await loadRepos();notice('Repository deleted from this project.','success');}catch(err){notice(err.message);}
  return;
 }
});
// Save: link the repository (or change its default branch), then save / remove the token (GitHub checks a new token first).
document.addEventListener('submit',async e=>{
 if(e.target.id!=='repoEditForm')return;e.preventDefault();repoFormError('');
 const project=requireProject(),btn=$('repoSave');
 let id=$('repoId').value;
 const name=$('repoFullName').value.trim(),branch=$('repoDefaultBranch').value.trim()||'main',token=$('repoToken').value.trim(),drop=$('repoRemoveToken').checked;
 btn.disabled=true;btn.textContent=token?'Checking…':'Saving…';
 try{
  const provider=document.querySelector('input[name="repoProvider"]:checked')?.value||'github';
  if(!id){const d=await api('/api/projects/'+encodeURIComponent(project)+'/repositories',{method:'POST',body:JSON.stringify({provider,apiBaseUrl:provider==='gitlab'?($('repoBaseUrl').value.trim()||'https://gitlab.com'):undefined,repoFullName:name,defaultBranch:branch})});id=d.repository.id;$('repoId').value=id;$('repoFullName').readOnly=true;}
  else await api('/api/projects/'+encodeURIComponent(project)+'/repositories/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({defaultBranch:branch})});
  if(token||drop)await api('/api/projects/'+encodeURIComponent(project)+'/repositories/'+encodeURIComponent(id)+'/token',{method:'PUT',body:JSON.stringify({token:token||''})});
  clearTargetCache();await loadRepos();
  bootstrap.Modal.getOrCreateInstance($('repoModal')).hide();
  notice(token?'Repository saved; token checked with GitHub and saved.':'Repository saved.','success');
 }catch(err){
  // A new repository stays linked even when its token is refused: the popup stays open to correct the token.
  if(id)await loadRepos().catch(()=>{});
  repoFormError(err.message);
 }finally{btn.disabled=false;btn.textContent='Save';}
});
// ---- Code scans (Code Intelligence): list, findings popup, and starting a scan ----
let ciEnabled=false,ciAiEnabled=false,scanList=[],scanPoll=null,scanFindings=[],currentScanId=null,scanAttemptList=[];
const SCAN_ACTIVE=['QUEUED','PREPARING','RUNNING','NORMALIZING'];
const SCAN_STATUS={QUEUED:'Queued',PREPARING:'Getting the code',RUNNING:'Scanning',NORMALIZING:'Saving findings',COMPLETED:'Completed',PARTIAL:'Partly completed',FAILED:'Failed',CANCELLED:'Cancelled'};
const SEV_ORDER=['CRITICAL','HIGH','MEDIUM','LOW','INFO'];
const CAT_LABELS={SAST:'SAST',SCA:'SCA',SECRETS:'Secrets',CONTAINER:'Docker',IAC:'Kubernetes / IaC',AI_REVIEW:'AI code review',QUALITY:'Code quality'};
async function loadCodeStatus(){try{const d=await api('/api/projects/'+encodeURIComponent(requireProject())+'/code-intelligence/status');ciEnabled=!!d.enabled;ciAiEnabled=!!d.aiEnabled;}catch{ciEnabled=false;ciAiEnabled=false;}syncStoryScanButton();return ciEnabled;}
async function fetchScans(){try{scanList=(await api('/api/projects/'+encodeURIComponent(requireProject())+'/code-intelligence/scans')).scans||[];}catch{scanList=[];}renderScans();}
function scanStatusBadge(s){const k=SCAN_ACTIVE.includes(s.status)?'run':s.status==='COMPLETED'?'ok':s.status==='PARTIAL'?'warn':'bad';return '<span class="tn-scan-status '+k+'"'+(s.error?' title="'+esc(hideToolNames(s.error))+'"':'')+'>'+(SCAN_ACTIVE.includes(s.status)?'<span class="tn-scan-spin" aria-hidden="true"></span>':'')+esc(SCAN_STATUS[s.status]||s.status)+'</span>';}
function sevChips(sum){const b=sum?.bySeverity;if(!b)return '<span class="tn-muted">—</span>';const parts=SEV_ORDER.filter(k=>b[k]).map(k=>'<span class="tn-sev tn-sev-'+k.toLowerCase()+'" title="'+k+'">'+b[k]+'</span>');return '<div class="tn-sev-row"><b>'+Number(sum.total||0)+'</b>'+parts.join('')+'</div>';}
function scanTargetText(s){const v=s.target||'';return (s.target_type==='PULL_REQUEST'?(s.provider==='gitlab'?'Merge request !':'Pull request #')+v:s.target_type==='COMMIT'?'Commit '+v.slice(0,7):'Branch '+v)+(s.commit_sha?' · '+s.commit_sha.slice(0,7):'');}
function lastScanCell(r){const s=scanList.find(x=>String(x.repository_id)===String(r.id));if(!s)return '<span class="tn-muted">None yet</span>';return '<div><b>#'+esc(s.scan_number)+'</b> '+scanStatusBadge(s)+'</div>'+(s.summary?.total!=null?'<div class="tn-muted small">'+Number(s.summary.total)+' findings · '+dateTime(s.completed_at||s.created_at)+'</div>':'');}
function renderScans(){
 if(!$('scanRows'))return;
 $('scanCount').textContent=scanList.length;
 $('scanRows').innerHTML=scanList.map(s=>'<tr><td><strong>#'+esc(s.scan_number)+'</strong></td><td>'+esc(s.repo_full_name)+'</td><td>'+esc(scanTargetText(s))+'</td>'
  +'<td>'+(s.story_ref?'<span title="'+esc(s.story_title||'')+'">'+esc(s.story_ref)+'</span>':'<span class="tn-muted">—</span>')+'</td>'
  +'<td>'+scanStatusBadge(s)+'</td><td>'+sevChips(s.summary)+'</td>'
  // Times scanned: attempts of this scan (the same thing scanned again), like "Times run" of a test run.
  +'<td data-sort="'+Number(s.times_scanned||1)+'">'+Number(s.times_scanned||1)+'</td>'
  // Created: the first attempt. Last updated: the latest attempt (when it finished / started), by who started it.
  +createdCell(s.first_created_by_name||s.created_by_name,s.first_created_at||s.created_at)
  +updatedCell(s.created_by_name,s.completed_at||s.started_at||s.created_at,s.first_created_by_name||s.created_by_name,s.first_created_at||s.created_at)
  +'<td><span class="tn-icon-actions">'+actionIcon('eye','data-scan-view="'+esc(s.id)+'"','View scan #'+s.scan_number)
   +actionIcon('report','data-scan-report="'+esc(s.id)+'"','Report of scan #'+s.scan_number)
   +(['PROJECT_MANAGER','QA'].includes(state.context?.projectRole)?actionIcon('scan','data-scan-again="'+esc(s.id)+'"','Scan again: scan #'+s.scan_number):'')+'</span></td></tr>').join('')
  ||'<tr><td colspan="10" class="tn-empty">No code scans yet. Use + New scan, ⛶ on a repository (Source code tab), or ⛶ on a Code Intelligence story.</td></tr>';
 // While a scan runs, refresh every few seconds (only while the Source code tab is open).
 clearTimeout(scanPoll);
 if(scanList.some(s=>SCAN_ACTIVE.includes(s.status))&&['source','scans'].includes(state.view))scanPoll=setTimeout(()=>{if(state.view==='source')loadRepos().catch(()=>{});else if(state.view==='scans')loadScansTab().catch(()=>{});},4000);
}
async function startScan(body,label){
 const d=await api('/api/projects/'+encodeURIComponent(requireProject())+'/code-intelligence/scans',{method:'POST',body:JSON.stringify(body)});
 notice('Scan #'+d.scan.scanNumber+(d.scan.attempt>1?' (attempt '+d.scan.attempt+')':'')+' started for '+label+'. Results appear in the Code scans tab.','success');
 return d.scan;
}
// Story popup ⛶: scans the saved story (its Scan by and ticked checks). Needs the story to be saved first.
function syncStoryScanButton(){
 const b=$('storyScanCode');if(!b)return;
 const saved=!!$('storyId')?.value;
 // Always full colour like Edit / Play; when it cannot be used yet, clicking it says why.
 b.disabled=false;
 b.dataset.blocked=!ciEnabled?'Code scanning is not enabled on this server.':!saved?'Save the story first, then scan it.':'';
 b.title=b.dataset.blocked||'Scan this story (its saved Scan by and ticked code checks)';
}
// A scan opens as its own page (like a test run): Projects › project › Code scans › Scan #N, with "Back to scans".
async function openScan(id){state.scanId=id;show('scan');}
async function loadScanPage(){
 if(!state.scanId){show('scans','replace');return;}
 $('scanFindingRows').innerHTML='<tr><td colspan="11" class="tn-empty">Loading scan…</td></tr>';
 const d=await api('/api/projects/'+encodeURIComponent(requireProject())+'/code-intelligence/scans/'+encodeURIComponent(state.scanId));
 const s=d.scan,atts=d.attempts||[];scanFindings=d.findings||[];currentScanId=s.id;scanAttemptList=atts;scanAttemptBase={target_type:s.target_type,target:s.target,provider:s.provider};
 $('scanPageTitle').textContent='Scan #'+s.scan_number;
 $('scanPageMeta').innerHTML=esc(s.repo_full_name)+' · '+esc(scanTargetText(s))+(s.story_ref?' · story '+esc(s.story_ref):'')+' · '+scanStatusBadge(s)+' · Times scanned: '+atts.length
  +' · last by '+esc(s.created_by_name||'')+' · '+esc(dateTime(s.created_at))+(s.summary?.files?' · '+Number(s.summary.files)+' files':'');
 const project=state.context?.project||{};
 $('breadcrumb').innerHTML='<a href="/workspace.html#projects">Projects</a><span aria-hidden="true">›</span><a href="'+esc(projectRoute(state.projectId,'details'))+'">'+esc(project.name||'Project')+'</a><span aria-hidden="true">›</span><a href="'+esc(projectRoute(state.projectId,'scans'))+'">Code scans</a><span aria-hidden="true">›</span><span aria-current="page">Scan #'+esc(s.scan_number)+'</span>';
 // One chip per check of the latest attempt: what was checked and how many found. Tool names are not shown.
 $('scanJobs').innerHTML=(d.jobs||[]).map(j=>'<div class="tn-scan-job '+j.status.toLowerCase()+(j.status==='COMPLETED'&&Number(j.findings_count)>0?' has-findings':'')+'"><b>'+esc(CAT_LABELS[j.category]||j.category)+'</b> · '+esc(j.status==='COMPLETED'?j.findings_count+' found':j.status.toLowerCase())+(j.error?'<div class="tn-muted small">'+esc(hideToolNames(j.error))+'</div>':'')+'</div>').join('')
  +(s.error?'<div class="tn-scan-job failed"><b>Note</b> '+esc(hideToolNames(s.error))+'</div>':'');
 const q=document.querySelector('#view-scan .tn-table-query');if(q)q.value='';
 closeAiDialog();
 renderFindings();
}
// All findings go into the table; its standard search bar (column ▾ + 🔍) and paging filter them, like every other list.
// Scanner names stay internal: any message that mentions them is shown with a neutral word instead.
function hideToolNames(text){return String(text||'').replace(/\b(OpenGrep|Opengrep|opengrep|Trivy|trivy|Gitleaks|gitleaks|Betterleaks)\b/g,'The scanner');}
// Priority (how soon to fix): starts equal to severity; QA / project manager can change it.
// The options carry their text in "label" so the cell's text stays the chosen priority only (the table search reads it).
const PRIORITIES=['CRITICAL','HIGH','MEDIUM','LOW'];
const titleCaseWord=v=>String(v||'').charAt(0)+String(v||'').slice(1).toLowerCase();
function priorityCell(f){
 const canEdit=['PROJECT_MANAGER','QA'].includes(state.context?.projectRole);
 const label='<span class="tn-sev tn-pri-'+f.priority.toLowerCase()+'">'+esc(titleCaseWord(f.priority))+'</span>';
 const changed=f.priority_manual?'<div class="tn-muted small">changed</div>':'';
 if(!canEdit)return label+changed;
 const group=f.ids&&f.ids.length>1?' data-finding-group="'+esc(f.ids.join(','))+'"':'';
 return '<span class="visually-hidden">'+esc(titleCaseWord(f.priority))+'</span><select class="form-select form-select-sm tn-priority-pick tn-pri-'+f.priority.toLowerCase()+'" data-finding-priority="'+esc(f.id)+'"'+group+' aria-label="Priority of '+esc(f.title)+'">'
  +PRIORITIES.map(p=>'<option value="'+p+'" label="'+titleCaseWord(p)+'"'+(p===f.priority?' selected':'')+'></option>').join('')+'</select>'+changed;
}
document.addEventListener('change',async e=>{
 const s=e.target.closest('[data-finding-priority]');if(!s)return;
 // A grouped row changes the priority of every place of that problem.
 const ids=(s.dataset.findingGroup||s.dataset.findingPriority).split(',');
 const members=scanFindings.filter(x=>ids.includes(String(x.id)));if(!members.length)return;
 const before=[...s.options].find(o=>o.defaultSelected)?.value||members[0].priority;s.disabled=true;
 let done=0;
 try{
  for(const f of members){
   await api('/api/projects/'+encodeURIComponent(requireProject())+'/code-intelligence/findings/'+encodeURIComponent(f.id)+'/priority',{method:'PATCH',body:JSON.stringify({priority:s.value})});
   f.priority=s.value;f.priority_manual=true;done++;
  }
  notice('Priority changed to '+titleCaseWord(s.value)+(members.length>1?' in all '+members.length+' places':'')+' (severity stays '+titleCaseWord(members[0].severity)+').','success');
 }catch(err){notice(err.message+(done?' ('+done+' of '+members.length+' places were changed.)':''));if(!done)s.value=before;}
 finally{
  const cell=s.closest('td');
  if(cell){const g=groupFindings(members)[0];cell.innerHTML=priorityCell(g);}
 }
});
// ---- One row per problem: the same problem (same category, title, CVE / CWE, package, severity) found in several
// places is shown once, with "Found in N places" that opens the list of places inside the row. Every place is
// still stored on its own; this only changes the display. Priority set on the row applies to every place.
const PRIORITY_RANK={CRITICAL:4,HIGH:3,MEDIUM:2,LOW:1};
function groupFindings(list){
 const groups=new Map();
 for(const f of list){
  const key=[f.category,f.title,f.cve||'',f.cwe||'',f.package_name||'',f.severity].join('\u0001');
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(f);
 }
 return [...groups.values()].map(members=>{
  const top=members.reduce((a,b)=>(PRIORITY_RANK[b.priority]||0)>(PRIORITY_RANK[a.priority]||0)?b:a);
  const withAi=members.find(m=>m.has_ai);
  const rep=withAi||members[0];
  // Latest result of the problem: Fixed when every place is gone, Found when any place was found before too, else New.
  const st=members.every(m=>m.scan_status==='FIXED')?'FIXED':members.some(m=>m.scan_status==='FOUND')?'FOUND':members.some(m=>m.scan_status==='NEW')?'NEW':'FOUND';
  const history=(members[0].history||[]).map((h,i)=>({...h,result:members.some(m=>m.history?.[i]?.result==='FOUND')?'FOUND':members.some(m=>m.history?.[i]?.result==='NOT_FOUND')?'NOT_FOUND':'NOT_CHECKED'}));
  return {...rep,members,ids:members.map(m=>m.id),priority:top.priority,priority_manual:members.some(m=>m.priority_manual),
   has_ai:!!withAi,newCount:members.filter(m=>m.is_new).length,scan_status:st,history,
   times_found:history.filter(h=>h.result==='FOUND').length||Math.max(...members.map(m=>m.times_found||1)),times_checked:history.filter(h=>h.result!=='NOT_CHECKED').length||1};
 });
}
function placeText(m){return esc(m.file_path||'—')+(m.line?' <span class="tn-muted">: '+Number(m.line)+'</span>':'');}
// Status: the problem's latest result (Found / New / Fixed), like a test case's Passed / Failed.
const SCAN_RESULT={FOUND:['Found','fail'],NEW:['New','new'],FIXED:['Fixed','pass']};
function scanResultTag(st){const x=SCAN_RESULT[st]||SCAN_RESULT.FOUND;return '<span class="tn-result '+x[1]+'">'+x[0]+'</span>';}
// ---- Accept / Reject a problem (one decision for all its places). QA / project manager.
// Not decided: ✓ Accept and ✗ Reject. Accepted: tag + ✗ to undo. Rejected: the row stays (greyed) with its reason + ✓ to undo.
// Accept makes the task, assigned by the system to the team (worked in the Tasks tab, like a failed test case).
function findingDecision(g){
 if(g.members.some(m=>m.status==='CONFIRMED'))return 'ACCEPTED';
 if(g.members.length&&g.members.every(m=>m.status==='FALSE_POSITIVE'))return 'REJECTED';
 return '';
}
function decisionTitle(m){return m&&m.decided_by_name?' title="'+esc('By '+m.decided_by_name+(m.decided_at?' · '+dateTime(m.decided_at):''))+'"':'';}
function findingActionCell(g,i){
 const d=findingDecision(g),canEdit=['PROJECT_MANAGER','QA'].includes(state.context?.projectRole);
 const ids=esc(g.ids.join(',')),name=g.title;
 const m=g.members.find(x=>x.decided_by_name)||g.members[0];
 const tag=d==='ACCEPTED'?'<span class="tn-tag success"'+decisionTitle(m)+'>ACCEPTED</span>':d==='REJECTED'?'<span class="tn-tag danger"'+decisionTitle(m)+'>REJECTED</span>':'';
 const reason=d==='REJECTED'&&m.decision_reason?'<div class="tn-muted small tn-reject-reason">'+esc(m.decision_reason)+'</div>':'';
 const icons=!canEdit?'':(d!=='ACCEPTED'?actionIcon('accept','data-accept-finding="'+ids+'"','Accept: '+name):'')+(d!=='REJECTED'?actionIcon('reject','data-reject-finding="'+ids+'"','Reject: '+name):'');
 const eye=i==null?'':actionIcon('eye','data-open-problem="'+i+'"','Details and scan history of '+name);
 return '<td class="tn-finding-actions"><span class="tn-icon-actions">'+eye+icons+'</span>'+(tag?'<div class="tn-decision-tag">'+tag+'</div>':'')+reason+'</td>';
}
async function sendFindingDecision(ids,decision,reason){
 const d=await api('/api/projects/'+encodeURIComponent(requireProject())+'/code-intelligence/findings/decision',{method:'POST',body:JSON.stringify({findingIds:ids,decision,reason:reason||null,scanId:currentScanId})});
 if(decision==='ACCEPT')notice('Accepted. '+(d.existing?'It already has task '+taskNo(d.task.task_number):'Task '+taskNo(d.task.task_number)+(d.ai?.written?' written by AI':'')+(d.task.assigned_to_name?' and assigned to '+d.task.assigned_to_name:''))+'. See it in Tasks.'+(d.ai&&!d.ai.written?' (Not written by AI: '+d.ai.note+')':''),'success');
 else notice('Rejected.'+(d.task?' Task '+taskNo(d.task.task_number)+' is cancelled.':''),'success');
 // Same row, new state (no reload of the whole popup).
 const me=state.user?.name||state.user?.display_name||null;
 for(const f of scanFindings)if(ids.includes(String(f.id))){f.status=decision==='ACCEPT'?'CONFIRMED':'FALSE_POSITIVE';f.decision_reason=decision==='REJECT'?reason:null;f.decided_by_name=me||f.decided_by_name;f.decided_at=new Date().toISOString();}
 renderFindings();
 try{state.tasks=(await api('/api/projects/'+encodeURIComponent(requireProject())+'/work-items')).workItems||state.tasks;renderTasks();}catch{}
}
function closeRejectDialog(){const d=$('rejectDialog');if(d.open)d.close();}
document.addEventListener('click',async e=>{
 const acc=e.target.closest('[data-accept-finding]');
 if(acc&&!acc.disabled){
  acc.disabled=true;acc.classList.add('is-busy');
  if(ciAiEnabled)notice('Accepting… the AI is writing the task.','info');
  try{await sendFindingDecision(acc.dataset.acceptFinding.split(','),'ACCEPT');}catch(err){notice(err.message);acc.disabled=false;acc.classList.remove('is-busy');}
  return;
 }
 const rej=e.target.closest('[data-reject-finding]');
 if(rej){
  const ids=rej.dataset.rejectFinding.split(','),f=scanFindings.find(x=>ids.includes(String(x.id)));
  $('rejectDialogProblem').textContent=f?f.title:'';$('rejectReason').value='';$('rejectDialog').dataset.ids=ids.join(',');
  $('rejectDialog').showModal();$('rejectReason').focus();
  return;
 }
 if(e.target.closest('[data-reject-cancel]')||e.target===$('rejectDialog')){closeRejectDialog();return;}
 const ok=e.target.closest('[data-reject-confirm]');
 if(ok&&!ok.disabled){
  const reason=$('rejectReason').value.trim();
  if(reason.length<3){notice('Please write the reason.');$('rejectReason').focus();return;}
  ok.disabled=true;
  try{await sendFindingDecision($('rejectDialog').dataset.ids.split(','),'REJECT',reason);closeRejectDialog();}catch(err){notice(err.message);}
  finally{ok.disabled=false;}
 }
});
$('rejectDialog').addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeRejectDialog();}});
// Problems table, laid out like a run's Test cases table:
//   Problem · Type · Severity · Priority · Status · Times found · Created · Last updated · AI · Actions
// Created = the first attempt that found it; Last updated = the latest attempt that checked it (or the accept / reject
// decision, if later). 👁 opens the problem (Details + Scan history), like a test case.
function problemDates(g){
 const h=g.history||[],first=h.find(x=>x.result==='FOUND'),last=[...h].reverse().find(x=>x.result!=='NOT_CHECKED');
 const m=g.members.find(x=>x.decided_at);
 let upd={by:last?.by,at:last?.created_at};
 if(m&&(!upd.at||new Date(m.decided_at)>new Date(upd.at)))upd={by:m.decided_by_name,at:m.decided_at};
 return {created:{by:first?.by,at:first?.created_at},updated:upd};
}
function placesShort(g){return g.members.length>1?'Found in '+g.members.length+' places':(g.file_path||'—')+(g.line?' : '+Number(g.line):'');}
let scanGroups=[];
function renderFindings(){
 const groups=groupFindings(scanFindings);scanGroups=groups;
 $('scanFindingRows').innerHTML=groups.map((g,i)=>{
  const rowCls=[findingDecision(g)==='REJECTED'?'tn-finding-rejected':'',g.scan_status==='FIXED'?'tn-finding-fixed':''].filter(Boolean).join(' ');
  const dt=problemDates(g);
  return '<tr'+(rowCls?' class="'+rowCls+'"':'')+'><td><strong>'+esc(g.title)+'</strong><div class="tn-muted small">'+esc(placesShort(g))+(g.package_name?' · '+esc(g.package_name):'')+'</div></td>'
  +'<td>'+esc(CAT_LABELS[g.category]||g.category)+'</td>'
  +'<td data-sort="'+(5-(PRIORITY_RANK[g.severity]||0))+'"><span class="tn-sev tn-sev-'+g.severity.toLowerCase()+'">'+esc(titleCaseWord(g.severity))+'</span></td>'
  +'<td>'+priorityCell(g)+'</td>'
  +'<td>'+scanResultTag(g.scan_status)+'</td>'
  +'<td data-sort="'+Number(g.times_found||1)+'">'+Number(g.times_found||1)+'</td>'
  +createdCell(dt.created.by,dt.created.at)+updatedCell(dt.updated.by,dt.updated.at,dt.created.by,dt.created.at)
  // "Ask AI" until asked, then the dark blue ✦ (one answer for the whole row).
  +'<td>'+(ciAiEnabled?aiButton(g):'<span class="tn-muted small">—</span>')+'</td>'
  +findingActionCell(g,i)+'</tr>';
 }).join('')
  ||'<tr><td colspan="10" class="tn-empty">No findings in this scan.</td></tr>';
 if($('scanProblemsCount'))$('scanProblemsCount').textContent=groups.length;
 $('scanPlacesNote').textContent=groups.length?groups.length+' problem'+(groups.length===1?'':'s')+' in '+scanFindings.length+' place'+(scanFindings.length===1?'':'s')+'. The same problem in several places is shown once: 👁 shows where, and its scan history.':'';
 const pv=$('problemViewer');if(pv?.open&&pv.dataset.key){const j=scanGroups.findIndex(x=>x.ids.join(',')===pv.dataset.key);if(j>=0)openProblem(j,true);}
}
// ---- Problem view (👁): like a test case's view — Details tab and Scan history tab ----
function showProblemTab(name){for(const b of document.querySelectorAll('[data-problem-tab]')){const on=b.dataset.problemTab===name;b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1;$('problemPanel'+b.dataset.problemTab).hidden=!on;}}
function openProblem(i,keepTab){
 const g=scanGroups[i];if(!g)return;
 const v=$('problemViewer');v.dataset.key=g.ids.join(',');
 const versions=[...new Set(g.members.map(m=>m.installed_version).filter(Boolean))];
 const d=findingDecision(g),m=g.members.find(x=>x.decided_by_name)||g.members[0];
 $('problemViewerTitle').innerHTML='<span class="tn-sev tn-sev-'+esc(g.severity.toLowerCase())+'">'+esc(titleCaseWord(g.severity))+'</span> '+esc(g.title);
 $('problemViewerMeta').textContent=['Code Intelligence',CAT_LABELS[g.category]||g.category,titleCaseWord(g.priority)+' priority','Scan #'+($('scanPageTitle').textContent.replace(/\D/g,''))].filter(Boolean).join(' · ');
 const places=[...g.members].sort((a,b)=>String(a.file_path).localeCompare(String(b.file_path))||(a.line||0)-(b.line||0)).map(x=>'<li>'+placeText(x)+(x.installed_version&&g.package_name?' <span class="tn-muted">· '+esc(x.installed_version)+'</span>':'')+(x.scan_status==='FIXED'?' <span class="tn-hist-not_found">· fixed</span>':'')+'</li>').join('');
 $('problemPanelDetails').innerHTML='<div class="tn-case-status">'
  +'<span>Status</span><div>'+scanResultTag(g.scan_status)+'</div>'
  +'<span>Times found</span><div>'+Number(g.times_found||1)+' of '+Number(g.times_checked||1)+'</div>'
  +'<span>Decision</span><div>'+(d==='ACCEPTED'?'<span class="tn-tag success">ACCEPTED</span>':d==='REJECTED'?'<span class="tn-tag danger">REJECTED</span>':'<span class="tn-muted">Not decided</span>')+(d&&m.decided_by_name?' <span class="tn-muted">'+esc(m.decided_by_name)+(m.decided_at?' · '+esc(dateTime(m.decided_at)):'')+'</span>':'')+(d==='REJECTED'&&m.decision_reason?'<div class="tn-muted small">'+esc(m.decision_reason)+'</div>':'')+'</div>'
  +'</div>'
  +'<div class="tn-task-grid tn-problem-grid">'
  +'<span>Category</span><span>Code Intelligence</span><span>Type</span><span>'+esc(CAT_LABELS[g.category]||g.category)+'</span>'
  +'<span>Severity</span><span>'+esc(titleCaseWord(g.severity))+'</span><span>Priority</span><span>'+priorityTag(g.priority)+'</span>'
  +'<span>Package / fix</span><span>'+(g.package_name?esc(g.package_name+(versions.length?' '+versions.join(', '):''))+(g.fixed_version?' · fix: '+esc(g.fixed_version):''):'—')+'</span>'
  +'<span>CWE / CVE</span><span>'+esc([g.cwe,g.cve].filter(Boolean).join(' · ')||'—')+'</span>'
  +'<span>AI</span><span>'+(ciAiEnabled?aiButton(g):'<span class="tn-muted">AI is not enabled</span>')+'</span>'
  +'</div>'
  +'<h4 class="tn-code-todo-k">Where ('+g.members.length+' place'+(g.members.length===1?'':'s')+')</h4><ul class="tn-problem-places">'+places+'</ul>'
  +(g.message?'<details class="tn-task-steps"><summary>Scanner details</summary><p class="tn-code-scanner-text">'+esc(g.message)+'</p></details>':'');
 const hist=[...(g.history||[])].reverse();
 const word={FOUND:['Found','fail'],NOT_FOUND:['Not found','pass'],NOT_CHECKED:['Not checked','']};
 $('problemHistoryCount').textContent=hist.length;
 const scan=scanAttemptList.length?scanAttemptList:[];
 $('problemHistoryBody').innerHTML=hist.map(h=>{const a=scan.find(x=>x.attempt===h.attempt)||{};const w=word[h.result];
  return '<tr><td><strong>'+esc(attemptLabel(h.attempt))+'</strong></td><td>'+esc(scanTargetText({...scanAttemptBase,commit_sha:h.commit_sha||a.commit_sha}))+'</td><td>'+(w[1]?'<span class="tn-result '+w[1]+'">'+w[0]+'</span>':'<span class="tn-muted">'+w[0]+'</span>')+'</td>'+createdCell(h.by||a.created_by_name,h.created_at)+'</tr>';}).join('')
  ||'<tr><td colspan="4" class="tn-empty">No scan history.</td></tr>';
 if(!keepTab)showProblemTab('Details');
 if(!v.open)v.showModal();
}
let scanAttemptBase={};
document.addEventListener('click',e=>{
 const o=e.target.closest('[data-open-problem]');if(o){openProblem(Number(o.dataset.openProblem));return;}
 const t=e.target.closest('[data-problem-tab]');if(t){showProblemTab(t.dataset.problemTab);return;}
 const v=$('problemViewer');if(v?.open&&(e.target.closest('[data-close-problem]')||e.target===v))v.close();
});
// ---- Download report: the scan's summary and every problem with its latest result (an HTML file, like the AI report) ----
function scanReportHtml(d){
 const sc=d.scan,groups=groupFindings(d.findings||[]),project=state.context?.project||{};
 const title='Scan #'+sc.scan_number,meta=[sc.repo_full_name,scanTargetText(sc),sc.story_ref?'story '+sc.story_ref:'',titleCaseWord(sc.status),'Times scanned: '+(d.attempts||[]).length,'last by '+(sc.created_by_name||'')+' · '+dateTime(sc.created_at)].filter(Boolean).join(' · ');
 const count=k=>groups.filter(g=>g.scan_status===k).length,sev=k=>groups.filter(g=>g.severity===k).length;
 const rows=groups.map(g=>{const d=findingDecision(g);return '<tr><td>'+esc(titleCaseWord(g.severity))+'</td><td>'+esc(CAT_LABELS[g.category]||g.category)+'</td><td><b>'+esc(g.title)+'</b><div class="m">'+esc(placesShort(g))+'</div></td><td>'+esc(SCAN_RESULT[g.scan_status]?.[0]||'Found')+'</td><td>'+Number(g.times_found||1)+' of '+Number(g.times_checked||1)+'</td><td>'+(g.package_name?esc(g.package_name)+(g.fixed_version?'<div class="m">fix: '+esc(g.fixed_version)+'</div>':''):'—')+'</td><td>'+esc([g.cwe,g.cve].filter(Boolean).join(' · ')||'—')+'</td><td>'+(d?esc(titleCaseWord(d)):'—')+'</td></tr>';}).join('');
 return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(title)+' report</title><style>body{font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a;margin:24px;padding-top:28px}h1{font-size:20px;margin:0 0 4px}.m{color:#64748b;font-size:12px}table{border-collapse:collapse;width:100%;margin-top:14px;font-size:13px}th,td{border-bottom:1px solid #e2e8f0;padding:7px 8px;text-align:left;vertical-align:top}th{background:#f8fafc;font-size:12px;color:#475569}.sum{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}.sum div{border:1px solid #e2e8f0;border-radius:8px;padding:8px 12px}</style></head><body>'
  +'<h1>'+esc(title)+' · '+esc(project.name||'')+'</h1><div class="m">'+esc(meta)+'</div><div class="m">Report created '+esc(dateTime(new Date().toISOString()))+'</div>'
  +'<div class="sum"><div><b>'+groups.length+'</b> problems</div><div><b>'+count('FOUND')+'</b> found</div><div><b>'+count('NEW')+'</b> new</div><div><b>'+count('FIXED')+'</b> fixed</div><div>Critical '+sev('CRITICAL')+' · High '+sev('HIGH')+' · Medium '+sev('MEDIUM')+' · Low '+sev('LOW')+'</div></div>'
  +'<table><thead><tr><th>Severity</th><th>Type</th><th>Problem</th><th>Status</th><th>Times found</th><th>Package / fix</th><th>CWE / CVE</th><th>Decision</th></tr></thead><tbody>'+rows+'</tbody></table></body></html>';
}
// Code scans list → 📄: the report opens in a new tab with Download at the top right (same as the run reports).
// If the browser blocks new tabs, the file is downloaded instead.
function showScanReport(d,tab){
 const html=scanReportHtml(d),name='Scan-'+d.scan.scan_number+'-report-'+String(state.context?.project?.reference_no||'project').replace(/[^\w-]+/g,'_')+'.html';
 if(tab&&!tab.closed){
  const data='data:text/html;charset=utf-8;base64,'+btoa(unescape(encodeURIComponent(html)));
  const bar='<div style="position:fixed;top:18px;right:18px;z-index:99"><a href="'+data+'" download="'+esc(name)+'" style="display:inline-block;padding:8px 14px;border-radius:9px;background:#0f1f5c;color:#fff;font:600 13px system-ui,sans-serif;text-decoration:none;box-shadow:0 4px 14px rgba(15,23,42,.25)">Download</a></div>';
  const page=html.replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="script-src \'none\'">').replace(/<body([^>]*)>/,'<body$1>'+bar);
  tab.location.href=URL.createObjectURL(new Blob([page],{type:'text/html'}));return;
 }
 const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([html],{type:'text/html'}));a.download=name;
 document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},1000);
}
document.addEventListener('click',async e=>{
 const rep=e.target.closest('[data-scan-report]');
 if(rep&&!rep.disabled){rep.disabled=true;const tab=reportTab();try{showScanReport(await api('/api/projects/'+encodeURIComponent(requireProject())+'/code-intelligence/scans/'+encodeURIComponent(rep.dataset.scanReport)),tab);}catch(err){if(tab&&!tab.closed)tab.close();notice(err.message);}finally{rep.disabled=false;}return;}
 // Code scans list → scan icon: the same scan again (its next attempt), like ▶ re-run on a test run.
 const again=e.target.closest('[data-scan-again]');
 if(again&&!again.disabled){again.disabled=true;try{const row=scanList.find(x=>String(x.id)===again.dataset.scanAgain);await startScan({scanId:again.dataset.scanAgain},'scan #'+(row?.scan_number||''));await loadScansTab();}catch(err){notice(err.message);}finally{again.disabled=false;}}
});
// ---- AI on demand: explain one finding (meaning · real risk? · suggested priority · fix), shown as "AI · unverified" ----
// The same AI sparkle icon used on the AI buttons (Runs & reports, findings).
const AI_ICON='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'+iconPaths.ai+'</svg>';
const AI_RISK={LIKELY_REAL:['Likely real','real'],POSSIBLE:['Possible','possible'],LIKELY_FALSE_POSITIVE:['Likely false alarm','false']};
function aiCodeBlock(snippet,start,focusLine){
 if(!snippet)return '<div class="tn-muted small">No code lines for this finding (e.g. a package finding).</div>';
 return '<pre class="tn-ai-code">'+String(snippet).split('\n').map((l,i)=>{const n=(start||1)+i;return '<span class="'+(n===focusLine?'hl':'')+'">'+String(n).padStart(4)+' | '+esc(l)+'</span>';}).join('')+'</pre>';
}
// AI column: "Ask AI" text button until the AI has answered for this finding, then the dark blue ✦ icon.
function aiButton(f){
 if(f.has_ai)return '<span class="tn-icon-actions tn-ai-cell">'+actionIcon('ai','data-finding-ai="'+esc(f.id)+'"','Show the AI explanation of '+f.title)+'</span>';
 const t='Explain with AI: '+f.title;
 return '<span class="tn-ai-cell"><button type="button" class="tn-ai-ask" data-finding-ai="'+esc(f.id)+'" title="'+esc(t)+'" aria-label="'+esc(t)+'">'+AI_ICON+'<span>Ask AI</span></button></span>';
}
// Header of an AI answer. In the new tab there is no close button (the user closes the tab).
function aiHead(f,extra,inTab){
 return '<div class="tn-ai-head"><b class="tn-ai-title" id="aiDialogTitle">'+AI_ICON+' AI explanation</b>'+(extra||'')
  +(inTab?'':'<button type="button" class="btn-close ms-auto" data-ai-close aria-label="Close AI explanation"></button>')+'</div>';
}
function aiAnswerHtml(f,r,inTab){
 const risk=AI_RISK[r.realRisk]||AI_RISK.POSSIBLE;
 return aiHead(f,'<span class="tn-ai-badge">AI · unverified</span><span class="tn-muted small">'+esc(f.title)+' · '+esc(f.file_path||'')+(f.line?' : '+Number(f.line):'')+'</span>',inTab)
  +'<div class="tn-ai-grid"><div>'
  +'<div class="tn-ai-k">What it means</div><div>'+esc(r.meaning)+'</div>'
  +'<div class="tn-ai-k">Real risk?</div><div><span class="tn-ai-risk '+risk[1]+'">'+risk[0]+'</span> '+esc(r.riskReason||'')+'</div>'
  +'<div class="tn-ai-k">Suggested priority</div><div><span class="tn-sev tn-pri-'+String(r.suggestedPriority).toLowerCase()+'">'+esc(titleCaseWord(r.suggestedPriority))+'</span> <span class="tn-muted small">(current: '+esc(titleCaseWord(f.priority))+'; change it in the Priority column if you agree)</span></div>'
  +'<div class="tn-ai-k">How to fix</div><div>'+esc(r.fix||'—')+'</div>'
  +'</div><div>'
  +'<div class="tn-ai-k" style="margin-top:0">Code around the finding (secrets masked)</div>'+aiCodeBlock(r.snippet,r.snippetStart,f.line)
  +(r.fixCode?'<div class="tn-ai-k">Suggested code</div><pre class="tn-ai-code fix">'+esc(r.fixCode)+'</pre>':'')
  +'<div class="tn-muted small mt-2">'+(r.cached?'Saved answer':'New answer')+(r.createdBy?' · asked by '+esc(r.createdBy):'')+(r.createdAt?' · '+esc(dateTime(r.createdAt)):'')+' · <button type="button" class="tn-link-btn" data-ai-refresh="'+esc(f.id)+'">Ask again</button></div>'
  +'</div></div>';
}
// ---- The AI answer opens in its own browser tab (like the AI report in Runs & reports), with a Download button.
// The tab is opened at once on the click (so the browser allows it) and filled when the answer arrives.
// If the browser blocks new tabs, the answer shows in the popup instead.
const AI_TAB_CSS='*{box-sizing:border-box}body{margin:0;background:#f5f8ff;color:#0f172a;font:14px/1.55 Inter,"Segoe UI",system-ui,sans-serif}'
 +'main{max-width:1180px;margin:0 auto;padding:26px 22px 80px}.brand{font-weight:700;color:#0f1f5c;font-size:13px;letter-spacing:.02em;margin-bottom:14px}'
 +'.tn-ai-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding-bottom:12px;margin-bottom:6px;border-bottom:1px solid #c7d2fe}'
 +'.tn-ai-title{display:inline-flex;align-items:center;gap:6px;color:#0f1f5c;font-size:18px}.tn-ai-title svg{width:18px;height:18px}'
 +'.tn-ai-badge{font-size:10.5px;font-weight:700;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:99px;padding:1px 8px}'
 +'.tn-muted{color:#64748b}.small{font-size:12.5px}.tn-ai-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);gap:22px}'
 +'@media(max-width:820px){.tn-ai-grid{grid-template-columns:1fr}}'
 +'.tn-ai-k{font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#64748b;margin:12px 0 3px}'
 +'.tn-ai-risk,.tn-sev{display:inline-block;font-size:11.5px;font-weight:700;border-radius:99px;padding:1px 9px;margin-right:4px;border:1px solid transparent}'
 +'.tn-ai-risk.real{background:#fef2f2;color:#b91c1c}.tn-ai-risk.possible{background:#fffbeb;color:#b45309}.tn-ai-risk.false{background:#f0fdf4;color:#15803d}'
 +'.tn-pri-critical{background:#fef2f2;color:#b91c1c;border-color:#fecaca}.tn-pri-high{background:#fff7ed;color:#c2410c;border-color:#fed7aa}'
 +'.tn-pri-medium{background:#eef2ff;color:#1d4ed8;border-color:#c7d2fe}.tn-pri-low{background:#f0fdf4;color:#15803d;border-color:#bbf7d0}'
 +'.tn-ai-code{font:12.5px/1.55 ui-monospace,Consolas,monospace;background:#0f172a;color:#e2e8f0;border-radius:9px;padding:9px 0;margin:0;white-space:pre;overflow-x:auto}'
 +'.tn-ai-code span{display:block;padding:0 12px}.tn-ai-code span.hl{background:#7f1d1d}.tn-ai-code.fix{padding:9px 12px;background:#14532d}'
 +'.mt-2{margin-top:10px}.tn-link-btn{border:0;background:none;padding:0;color:#1d4ed8;font:inherit;text-decoration:underline;cursor:pointer}'
 +'.alert{border:1px solid #fecaca;background:#fef2f2;color:#b91c1c;border-radius:10px;padding:12px 14px;margin-top:12px}'
 +'.topbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}.topbar .brand{margin:0}'
 +'.dl{padding:8px 14px;border-radius:9px;background:#0f1f5c;color:#fff;font:600 13px system-ui,sans-serif;text-decoration:none;box-shadow:0 4px 14px rgba(15,23,42,.25)}';
function writeAiTab(tab,f,inner,done){
 const project=state.context?.project||{};
 const page=(extraHead,bar)=>'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc('AI explanation · '+f.title)+'</title><style>'+AI_TAB_CSS+'</style>'+extraHead+'</head><body><main><div class="topbar"><div class="brand">TestNexus · '+esc(project.name||'')+'</div>'+bar+'</div>'+inner+'</main></body></html>';
 let bar='';
 if(done){
  // The downloaded copy is a plain page: no "Ask again" (it only works inside TestNexus).
  const copy=page('<style>[data-ai-refresh]{display:none}</style>','');
  const name='AI-explanation-'+String(f.title||'finding').replace(/[^\w]+/g,'-').slice(0,60)+'-'+String(project.reference_no||'project').replace(/[^\w-]+/g,'_')+'.html';
  bar='<a class="dl" href="data:text/html;charset=utf-8;base64,'+btoa(unescape(encodeURIComponent(copy)))+'" download="'+esc(name)+'">Download</a>';
 }
 tab.document.open();tab.document.write(page('',bar));tab.document.close();
 // "Ask again" in the tab asks the AI again and refreshes the same tab.
 tab.document.addEventListener('click',e=>{const r=e.target.closest('[data-ai-refresh]');if(r){e.preventDefault();explainFinding(r.dataset.aiRefresh,true,tab);}});
}
function renderAiPanel(f,r){$('scanAiPanel').innerHTML=aiAnswerHtml(f,r,false);openAiDialog();}
function openAiDialog(){const d=$('aiDialog');if(!d.open)d.showModal();}
function closeAiDialog(){const d=$('aiDialog');if(d.open)d.close();$('scanAiPanel').innerHTML='';}
// Esc closes only the AI popup, not the findings popup under it.
$('aiDialog').addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeAiDialog();}});
$('aiDialog').addEventListener('click',e=>{if(e.target===$('aiDialog'))closeAiDialog();});
// "Back to scans" on the scan page. Opened from a task ("Scan results ↗"): goes back to that task in Tasks.
let scanReturnTask=null;
$('scanPageBack').addEventListener('click',async()=>{
 closeAiDialog();
 const id=scanReturnTask;scanReturnTask=null;
 if(!id){show('scans');return;}
 show('tasks');try{await openTask(id);}catch(err){notice(err.message);}
});
async function explainFinding(id,refresh,tab){
 const f=scanFindings.find(x=>String(x.id)===String(id));if(!f)return;
 if(!tab||tab.closed)tab=window.open('','_blank');
 const inTab=()=>tab&&!tab.closed;
 const btns=[...document.querySelectorAll('[data-finding-ai="'+id+'"]')];btns.forEach(b=>{b.disabled=true;b.setAttribute('aria-busy','true');b.title='Asking AI…';});
 const asking=aiHead(f,'<span class="tn-muted small">Asking the AI about '+esc(f.title)+'…</span>',!!tab);
 if(inTab())writeAiTab(tab,f,asking,false);else{$('scanAiPanel').innerHTML=asking;openAiDialog();}
 try{
  const d=await api('/api/projects/'+encodeURIComponent(requireProject())+'/code-intelligence/findings/'+encodeURIComponent(id)+'/explain'+(refresh?'?refresh=1':''),{method:'POST',body:'{}'});
  f.has_ai=true;
  if(inTab())writeAiTab(tab,f,aiAnswerHtml(f,d.review,true),true);else if(!tab)renderAiPanel(f,d.review);
 }catch(err){
  const html=aiHead(f,'',!!tab)+'<div class="alert alert-danger mb-0">'+esc(err.message)+'</div>';
  if(inTab())writeAiTab(tab,f,html,false);else if(!tab){$('scanAiPanel').innerHTML=html;openAiDialog();}
 }
 finally{btns.forEach(b=>{const cell=b.closest('.tn-ai-cell');if(cell)cell.outerHTML=aiButton(f);else{b.disabled=false;b.removeAttribute('aria-busy');}});}
}
document.addEventListener('click',e=>{
 const b=e.target.closest('[data-finding-ai]');if(b){explainFinding(b.dataset.findingAi,false);return;}
 const r=e.target.closest('[data-ai-refresh]');if(r){explainFinding(r.dataset.aiRefresh,true);return;}
 if(e.target.closest('[data-ai-close]'))closeAiDialog();
});
document.addEventListener('click',async e=>{
 const view=e.target.closest('[data-scan-view]');
 if(view){try{await openScan(view.dataset.scanView);}catch(err){notice(err.message);}return;}
 const repoScan=e.target.closest('[data-repo-scan]');
 if(repoScan&&!repoScan.disabled){
  if(repoScan.dataset.blocked){notice(repoScan.dataset.blocked);return;}
  const r=repoList.find(x=>String(x.id)===String(repoScan.dataset.repoScan));if(!r)return;
  repoScan.disabled=true;
  try{await startScan({repositoryId:r.id},r.repo_full_name+' ('+(r.default_branch||'main')+')');await loadRepos();}catch(err){notice(err.message);repoScan.disabled=false;}
  return;
 }
 // Code-problem task (Tasks tab): scan again what its scan scanned, to check the fix. Same as a code story's scan icon.
 const scanTask=e.target.closest('[data-scan-task]');
 if(scanTask&&!scanTask.disabled){
  scanTask.disabled=true;
  const t=(state.tasks||[]).find(x=>String(x.id)===scanTask.dataset.scanTask);
  try{await startScan({taskId:scanTask.dataset.scanTask},'task '+(t?taskNo(t.task_number):''));show('scans');}
  catch(err){notice(err.message);}
  finally{scanTask.disabled=false;}
  return;
 }
 const scanStory=e.target.closest('[data-scan-story]');
 if(scanStory&&!scanStory.disabled){
  scanStory.disabled=true;
  const story=(state.context?.stories||[]).find(s=>String(s.id)===scanStory.dataset.scanStory);
  try{await startScan({storyId:scanStory.dataset.scanStory},'story '+(story?.reference_no||story?.title||''));show('scans');}
  catch(err){notice(err.message);}
  finally{scanStory.disabled=false;}
  return;
 }
 if(e.target.closest('#storyScanCode')&&!$('storyScanCode').disabled){
  const b=$('storyScanCode');
  if(b.dataset.blocked){$('storyBranchHint').textContent=b.dataset.blocked;return;}
  b.disabled=true;
  try{const s=await startScan({storyId:$('storyId').value},'this story');$('storyBranchHint').textContent='Scan #'+s.scanNumber+' started. See the Code scans tab.';}
  catch(err){$('storyBranchHint').textContent=err.message;}
  finally{syncStoryScanButton();}
 }
});
// ---- Code scans tab: the scan list and "+ New scan" (repository, branch / pull request / commit, checks) ----
async function loadScansTab(){
 const role=state.context?.projectRole,canEdit=['PROJECT_MANAGER','QA'].includes(role);
 const [d]=await Promise.all([api('/api/projects/'+encodeURIComponent(requireProject())+'/repositories'),loadCodeStatus(),fetchScans()]);
 repoList=d.repositories||[];
 const b=$('scanCreate');b.hidden=!canEdit;b.disabled=false;
 b.dataset.blocked=!ciEnabled?'Code scanning is not enabled on this server.':!repoList.length?'Add a repository in the Source code tab first.':'';
 b.title=b.dataset.blocked||'Start a scan';
}
function newScanError(m){const el=$('newScanError');el.textContent=m||'';el.classList.toggle('d-none',!m);}
async function loadNewScanTargets(){
 const repoId=$('newScanRepo').value,type=$('newScanType').value,input=$('newScanTarget'),hint=$('newScanHint');
 const repo=repoList.find(r=>String(r.id)===String(repoId));if(!repo)return;
 hint.textContent='Loading…';input.disabled=true;
 try{
  const d=await api('/api/projects/'+encodeURIComponent(requireProject())+'/repository-targets?type='+type+'&repoId='+encodeURIComponent(repoId));
  if(type!==$('newScanType').value||repoId!==$('newScanRepo').value)return; // changed while loading
  input.disabled=false;
  window.TNPick.attach(input,d.items,{value:type==='BRANCH'?(repo.default_branch||d.defaultBranch):'',showAllOnOpen:true});
  if(type!=='BRANCH'){input.value='';input.dataset.value='';}
  const openList=input.closest('.tn-pick')?.querySelector('.tn-pick-list');if(openList)openList.hidden=true;
  const pr=prWords(repo.provider);setPrOption($('newScanType'),repo.provider);
  input.placeholder=type==='PULL_REQUEST'?'Search '+pr.one:type==='COMMIT'?'Search commit':'Search branch';
  hint.textContent=type==='BRANCH'?'Default branch '+(repo.default_branch||'main')+' = the whole repository as it is now.':type==='PULL_REQUEST'?pr.Many+', open first.':'Recent commits of the default branch.';
 }catch(err){hint.textContent=err.message;}
}
document.addEventListener('click',e=>{
 if(!e.target.closest('#scanCreate'))return;
 if($('scanCreate').dataset.blocked){notice($('scanCreate').dataset.blocked);return;}
 $('newScanForm').reset();newScanError('');
 $('newScanRepo').innerHTML=repoList.map(r=>'<option value="'+esc(r.id)+'">'+esc(r.repo_full_name)+'</option>').join('');
 $('newScanType').value='BRANCH';
 bootstrap.Modal.getOrCreateInstance($('newScanModal')).show();
 loadNewScanTargets();
});
document.addEventListener('change',e=>{if(e.target.id==='newScanRepo'||e.target.id==='newScanType')loadNewScanTargets();});
document.addEventListener('submit',async e=>{
 if(e.target.id!=='newScanForm')return;e.preventDefault();newScanError('');
 const type=$('newScanType').value,target=window.TNPick.value($('newScanTarget'));
 const checks=[...document.querySelectorAll('input[name="newScanCheck"]:checked')].map(c=>c.value);
 const prRepo=repoList.find(r=>String(r.id)===String($('newScanRepo').value));
 if(target===null||(!target&&type!=='BRANCH')){newScanError('Choose a '+(type==='PULL_REQUEST'?prWords(prRepo?.provider).one:type==='COMMIT'?'commit':'branch')+' from the list.');return;}
 if(!checks.length){newScanError('Tick at least one check.');return;}
 const repo=repoList.find(r=>String(r.id)===String($('newScanRepo').value));
 const btn=$('newScanStart');btn.disabled=true;btn.title='Starting…';
 try{
  await startScan({repositoryId:repo.id,targetType:type,target:target||repo.default_branch||'main',checks},repo.repo_full_name);
  bootstrap.Modal.getOrCreateInstance($('newScanModal')).hide();
  await loadScansTab();
 }catch(err){newScanError(err.message);}finally{btn.disabled=false;btn.title='Start scan';}
});
// AI learning tab: Local (this project's learnings) or Global (shared by all projects).
function renderLearning(list){
 // The Local / Global switch sits right after the search box and the column filter.
 const toggle=$('learningScopeToggle'),toolbar=document.querySelector('.tn-table-filters[data-table-key="repairMemoryList"]'),row=toolbar?.querySelector('.tn-table-filters-main')||toolbar;
 if(toggle&&row&&toggle.parentElement!==row)row.append(toggle);
 const global=state.learningView==='global',canEdit=['PROJECT_MANAGER','QA'].includes(state.context?.projectRole);
 $('repairMemoryList').innerHTML=list.map(r=>{
  const own=String(r.project_id)===String(state.projectId),isGlobal=r.scope==='GLOBAL';
  const scope='<span class="tn-scope '+(isGlobal?'global':'project')+'">'+(isGlobal?'Global':'Local')+'</span>'+(global&&!own&&r.project_name?'<div class="tn-muted">from '+esc(r.project_name)+'</div>':'');
  const action=own&&canEdit?'<button type="button" class="btn btn-outline-primary tn-btn tn-btn-sm" data-learning-scope="'+esc(r.id)+'" data-to="'+(isGlobal?'PROJECT':'GLOBAL')+'">'+(isGlobal?'Make local':'Make global')+'</button>':'<span class="tn-muted">—</span>';
  return '<tr><td><strong>'+esc(r.recommendation?.title||'Recommended improvement')+'</strong><div class="tn-muted">'+esc(r.recommendation?.summary||'Review this improvement before use.')+'</div></td><td>'+esc(r.page_path||'—')+'</td><td>'+scope+'</td><td data-sort="'+esc(r.verified_at||'')+'">'+esc(dateTime(r.verified_at))+'</td><td>'+esc(r.success_count??0)+'</td>'+createdCell(r.created_by_name,r.created_at)+updatedCell(r.updated_by_name,r.updated_at,r.created_by_name,r.created_at)+'<td>'+action+'</td></tr>';
 }).join('')||'<tr><td colspan="8" class="tn-empty">'+(global?'No global learnings yet. A learning becomes global when someone marks it "Make global".':'No local learnings for this project yet. They appear after a repaired test passes its re-run.')+'</td></tr>';
}
document.addEventListener('click',async e=>{
 const v=e.target.closest('[data-learning-view]');
 if(v){state.learningView=v.dataset.learningView;for(const b of document.querySelectorAll('[data-learning-view]'))b.setAttribute('aria-checked',String(b===v));loadInventory().catch(err=>notice(err.message));return;}
 const b=e.target.closest('[data-learning-scope]');if(!b)return;
 try{await api('/api/projects/'+encodeURIComponent(requireProject())+'/repair-memory/'+encodeURIComponent(b.dataset.learningScope)+'/scope',{method:'PATCH',body:JSON.stringify({scope:b.dataset.to})});notice(b.dataset.to==='GLOBAL'?'Learning is now global: all projects can see it.':'Learning is now local: only this project can see it.','success');await loadInventory();}
 catch(err){notice(err.message);}
});
function priorityTag(p){
 const x=String(p||'').trim().toUpperCase();
 if(!x)return '<span class="tn-muted">—</span>';
 const level={CRITICAL:'critical',HIGH:'high',MEDIUM:'medium',LOW:'low'}[x]||'medium';
 return '<span class="tn-priority '+level+'" data-sort-value="'+({critical:4,high:3,medium:2,low:1}[level])+'">'+esc(x.charAt(0)+x.slice(1).toLowerCase())+'</span>';
}
// "Created" and "Last updated" cells: person + date, the same on every table.
// Who last changed a row is only known when it was saved; if a row was never changed after it was
// created (same timestamps), its creator is also its last editor. Otherwise "Not recorded".
function createdCell(name,at){return '<td data-sort="'+esc(at||'')+'">'+personCell(name,at)+'</td>';}
function updatedCell(name,at,creatorName,createdAt){
 const unchanged=at&&createdAt&&Math.abs(new Date(at)-new Date(createdAt))<2000;
 return '<td data-sort="'+esc(at||createdAt||'')+'">'+personCell(name||(unchanged?creatorName:''),at||createdAt)+'</td>';
}
// Small person line: avatar circle + name (used for Created by / Last updated).
// How a test case was made: AI (generated, AI one-case, or AI then edited) or Manual (written by a person).
// Failed tests as tasks: labels used in the Tasks tab, the task popup and the Teams page.
const WORK_TYPE_LABELS={DEFECT_FIX:'Defect fix',TEST_REVIEW:'Test review',INVESTIGATION:'Investigation',RETEST:'Retest',SECURITY_REMEDIATION:'Security fix',MANUAL_TEST:'Manual test',GENERAL:'General'};
const workTypeLabel=v=>WORK_TYPE_LABELS[String(v||'').toUpperCase()]||String(v||'—');
const catLabel=x=>/^(ui|api)$/i.test(String(x||''))?String(x).toUpperCase():x?String(x).charAt(0).toUpperCase()+String(x).slice(1).toLowerCase():'—';
const ROLE_NAMES={DEVELOPER:'Developer',QA:'QA',PROJECT_MANAGER:'Project Manager',VIEWER:'Viewer'};
const TASK_STATUS_LABELS={PENDING:'Pending',IN_PROGRESS:'In progress',ON_HOLD:'On hold',READY_FOR_RETEST:'Ready for retest',COMPLETED:'Completed',CANCELLED:'Cancelled'};
const taskNo=n=>n?'T-'+String(n).padStart(4,'0'):'—';
const hoursText=m=>{m=Number(m||0);if(!m)return '—';const h=Math.floor(m/60),r=m%60;return (h?h+' h':'')+(h&&r?' ':'')+(r?r+' min':'');};
// The open task made from this failed test case (if any).
function failureTaskFor(sessionId,caseId){return (state.tasks||[]).find(t=>t.origin==='FAILED_TEST'&&!t.deleted_at&&t.session_id===sessionId&&t.external_case_id===caseId&&!['COMPLETED','CANCELLED'].includes(t.status))||null;}
function taskChip(t){return t?'<button type="button" class="tn-task-chip" data-task="'+esc(t.id)+'" title="Open the task for this failure · '+esc((t.team_name||'No team')+' · '+(t.assigned_to_name||'Not assigned'))+'">Task · '+esc(TASK_STATUS_LABELS[t.status]||t.status)+'</button>':'';}
function sourceTag(src){const v=String(src||'');if(!v)return '<span class="tn-muted">—</span>';return /^ai/i.test(v)?'<span class="tn-src tn-src-ai" title="'+esc(v)+'">🤖 AI</span>':'<span class="tn-src tn-src-manual" title="'+esc(v)+'">✍ Manual</span>';}
function personCell(name,when){
 return '<span class="tn-who">'+(name?esc(name):'<span class="tn-muted">Not recorded</span>')+'</span><div class="tn-when">'+esc(dateTime(when))+'</div>';
}
function statusTag(s){const x=String(s||'PENDING');const c=x==='COMPLETED'?'success':x==='ON_HOLD'?'warn':x==='PENDING'?'':'danger';return '<span class="tn-tag '+c+'">'+esc(x.replaceAll('_',' '))+'</span>';}
const detailViews=new Set(['details','stories','inventory','audit','learning','executions','tasks','team','attachments','environments','source','scans','scan','run']);
const regularViews=new Set(['overview','projects','reports','users','teams']);
function show(view,historyMode='push'){
 if(!regularViews.has(view)&&!detailViews.has(view))view='projects';
 if(detailViews.has(view)&&(!state.projectId||!state.context))view='projects';
 state.view=view;
 const inDetails=detailViews.has(view);
 document.querySelectorAll('.tn-view').forEach(el=>el.classList.toggle('active',el.id==='view-'+(view==='executions'?'reports':view)));
 $('projectDetailTabs').classList.toggle('d-none',!inDetails);
 document.querySelectorAll('[data-view]').forEach(el=>{
  const tab=!!el.closest('#projectDetailTabs');
  const active=el.dataset.view===view||(view==='run'&&el.dataset.view==='executions')||(view==='scan'&&el.dataset.view==='scans')||(!tab&&inDetails&&el.dataset.view==='projects'&&!!el.closest('.tn-top'));
  el.classList.toggle('active',active);
  if(tab){el.setAttribute('aria-selected',String(active));el.tabIndex=active?0:-1;}
  else if(active)el.setAttribute('aria-current','page');
  else el.removeAttribute('aria-current');
 });
 const labels={teams:'Teams',run:'Run details',scan:'Scan details',environments:'Project environments',source:'Project source code',scans:'Project code scans',overview:'Home',projects:'Projects',users:'Administration',details:'Project context & scope',stories:'Project stories',tasks:'Project tasks',reports:'Test reports & evidence',executions:'Project runs & reports',inventory:'Project test cases',audit:'Project audit',learning:'Project AI learning',team:'Project team',attachments:'Project attachments'};
 const project=state.context?.project;
 if(inDetails&&project){
  // Project pages: the project's name is the title, with its key facts underneath.
  const manager=(state.context.members||[]).find(m=>m.project_role==='PROJECT_MANAGER');
  const facts=[project.reference_no?'Reference '+project.reference_no:'',(project.start_date||project.end_date)?'Dates '+date(project.start_date)+' – '+date(project.end_date):''].filter(Boolean);
  $('pageTitle').textContent=project.name||'Project';
  // Manager shown as a profile circle + name (role is on the Team card), followed by the project's key facts.
  const managerHtml=manager?'<span class="tn-head-person"><span class="tn-avatar tn-avatar-0" aria-hidden="true">'+esc(initialsOf(manager.display_name||manager.email))+'</span><span><strong>'+esc(manager.display_name||manager.email)+'</strong></span></span>':'';
  $('pageSubtitle').innerHTML=managerHtml+(facts.length?'<span class="tn-head-facts">'+esc(facts.join('  ·  '))+'</span>':'')||'Project workspace';
  // Breadcrumb uses exactly the active tab's name, so they always match.
 const tabName=document.querySelector('#projectDetailTabs [data-view="'+(view==='executions'?'executions':view)+'"]')?.textContent.trim();
 const section=tabName||String(labels[view]||'').replace(/^Project /,'');
  $('breadcrumb').innerHTML='<a href="/workspace.html#projects">Projects</a><span aria-hidden="true">›</span><a href="'+esc(projectRoute(state.projectId,'details'))+'">'+esc(project.name||project.reference_no||'Project')+'</a><span aria-hidden="true">›</span><span aria-current="page">'+esc(section.charAt(0).toUpperCase()+section.slice(1))+'</span>';
 }else{
  $('pageTitle').textContent=labels[view]||'TestNexus';
  if(view==='overview')$('pageTitle').textContent=greeting();
 $('pageSubtitle').textContent=view==='teams'?'Teams for the whole company, assigned to projects':view==='users'?'Sign-in accounts for TestNexus':view==='overview'?'Here is how your projects are doing.':view==='projects'?'Open a project to see its details, environments and test results, or start testing directly':'Execution results and reports';
  $('breadcrumb').textContent='Project workspace';
 }
 clearNotice();
 if((view==='inventory'||view==='audit'||view==='learning')&&state.projectId)loadInventory().catch(e=>notice(e.message));
 if(view==='users')loadUsers().catch(e=>notice(e.message));
 if(view==='source'&&state.projectId)loadRepos().catch(()=>{});
 if(view==='scans'&&state.projectId)loadScansTab().catch(()=>{});
 if(view==='team'&&state.projectId)loadTeams().catch(e=>notice(e.message));
 if(view==='teams')loadCompanyTeams().catch(e=>notice(e.message));
 if(view==='environments'&&state.projectId)loadEnvironments().catch(e=>notice(e.message));
 if(view==='run'&&state.projectId)loadRunPage().catch(e=>notice(e.message));
 if(view==='scan'&&state.projectId)loadScanPage().catch(e=>notice(e.message));
 const startCardShown=view==='details'&&$('projectStartCard')&&!$('projectStartCard').hidden;
 // Start Testing lives only on Context & scope (its card there); the header button is a fallback for when that card is hidden.
 for(const el of document.querySelectorAll('.tn-page-actions [data-start-project]'))el.hidden=view!=='details'||startCardShown;
 const path=inDetails?(view==='run'&&state.runId?'/workspace.html?projectId='+encodeURIComponent(state.projectId)+'&runId='+encodeURIComponent(state.runId)+'#run':view==='scan'&&state.scanId?'/workspace.html?projectId='+encodeURIComponent(state.projectId)+'&scanId='+encodeURIComponent(state.scanId)+'#scan':projectRoute(state.projectId,view)):'/workspace.html#'+view;
 if(historyMode!=='none'&&window.location.pathname+window.location.search+window.location.hash!==path){
  if(historyMode==='replace')window.history.replaceState(null,'',path);
  else window.history.pushState(null,'',path);
 }
}
async function openProject(id,section='details',historyMode='push'){
 const selected=state.projects.find(p=>String(p.id)===String(id));
 if(!selected)throw Error('This project is not available to your account.');
 if(String(state.projectId)!==String(id)||String(state.context?.project?.id)!==String(id)){
  closeTask();
  state.projectId=String(id);
  $('projectPicker').value=state.projectId;
  await loadWorkspace();
 }
 localStorage.setItem('testnexus:currentProject',state.projectId);
 show(section,historyMode);
}
async function routeFromUrl(){
 const requested=new URLSearchParams(window.location.search).get('projectId');
 state.runId=new URLSearchParams(window.location.search).get('runId')||state.runId||'';
 state.scanId=new URLSearchParams(window.location.search).get('scanId')||state.scanId||'';
 const fragment=window.location.hash.replace('#','');
 const view=fragment||(requested?'details':'projects');
 if(detailViews.has(view)||requested&&(!fragment||fragment==='details')){
  if(!requested||!state.projects.some(p=>String(p.id)===String(requested))){
   show('projects','replace');
   notice('Open a project using its View action to access project details.','warning');
   return;
  }
  try{await openProject(requested,detailViews.has(view)?view:'details',fragment?'none':'replace');}
  catch(error){show('projects','replace');notice('Unable to open this project: '+error.message); }
 }else{
  show(regularViews.has(view)?view:'projects',fragment?'none':'replace');
 }
}
function requireProject(){if(!state.projectId)throw Error('Select or create a project first.');return state.projectId;}
async function loadProjects(){
 const d=await api('/api/projects');state.projects=d.projects||[];
 const picker=$('projectPicker'),prior=new URLSearchParams(window.location.search).get('projectId')||state.projectId||localStorage.getItem('testnexus:currentProject')||'';
 if(!state.projects.some(p=>p.id===prior))state.projectId=state.projects[0]?.id||'';else state.projectId=prior;
 picker.innerHTML='<option value="">Select project</option>'+state.projects.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>').join('');
 picker.value=state.projectId;
 localStorage.setItem('testnexus:currentProject',state.projectId);
 $('projectsBody').innerHTML=state.projects.map(projectRow).join('')||'<tr><td colspan="9" class="tn-empty">No projects yet. Create your first project.</td></tr>';
 renderHome();
 let loaded=false,lastError=null;
 const ordered=[state.projectId,...state.projects.map(p=>p.id)].filter((v,i,a)=>v&&a.indexOf(v)===i);
 for(const candidate of ordered){state.projectId=candidate;try{await loadWorkspace();loaded=true;break;}catch(e){lastError=e;}}
 if(!loaded&&lastError)throw lastError;
 picker.value=state.projectId;
 localStorage.setItem('testnexus:currentProject',state.projectId);
}
async function loadWorkspace(){
 const pid=state.projectId; $('workspaceLoading').classList.remove('d-none');document.querySelector('.tn-container').setAttribute('aria-busy','true');state.context=null;state.tasks=[];state.evidence=[];
 if(!pid){['statStories','statRuns','statTasks','statDocs'].forEach(id=>$(id).textContent='0');$('workspaceLoading').classList.add('d-none');document.querySelector('.tn-container').removeAttribute('aria-busy');return;}
 try{const results=await Promise.allSettled([api('/api/projects/'+encodeURIComponent(pid)+'/workspace'),api('/api/projects/'+encodeURIComponent(pid)+'/work-items'),api('/api/projects/'+encodeURIComponent(pid)+'/evidence')]);
 if(results[0].status!=='fulfilled')throw results[0].reason;
 state.context=results[0].value;
 state.tasks=results[1].status==='fulfilled'?results[1].value.workItems||[]:[];
 state.evidence=results[2].status==='fulfilled'?results[2].value.results||[]:[];
 renderAll();
 try{await loadWorkflow();}catch(err){console.warn('Project workflow settings unavailable:',err.message);}
 if(results[1].status!=='fulfilled'||results[2].status!=='fulfilled')notice('Some project data could not be loaded. Check your access and database configuration.','warning');
 }finally{$('workspaceLoading').classList.add('d-none');document.querySelector('.tn-container').removeAttribute('aria-busy');}
}
function applyRoleUI(){
 const globalManager=String(state.user?.role||'').toUpperCase()==='MANAGER';
 const projectManager=state.context?.projectRole==='PROJECT_MANAGER';
 const canReview=projectManager||state.context?.projectRole==='QA';
 window.testnexusWorkspaceRole={platformManager:globalManager,projectManager,canReview};
 const toggles=[['newProjectForm',globalManager],['memberForm',projectManager],['userForm',globalManager],['environmentForm',projectManager],['newTaskForm',canReview],['storyForm',canReview]];
 if($('navUsers'))$('navUsers').hidden=!globalManager; // Users: managers only
 if($('navTeams'))$('navTeams').hidden=!globalManager; // Teams: managers only
 for(const [id,allowed] of [['openAssignMember',projectManager],['openManageTeams',projectManager],['teamCreateForm',globalManager]])if($(id))$(id).hidden=!allowed;
 for(const [id,allowed] of toggles){const form=$(id);if(!form)continue;form.querySelectorAll('input,select,textarea,button').forEach(el=>{el.disabled=!allowed;});if(['newProjectForm','memberForm','userForm'].includes(id))form.hidden=!allowed;}
 $('editProfile').disabled=!projectManager;
 if($('addScope'))$('addScope').hidden=!projectManager;
 for(const [zoneId,inputId] of [['detailDrop','detailFiles']]){
  $(zoneId).setAttribute('aria-disabled',String(!canReview));
  $(zoneId).tabIndex=canReview?0:-1;
  $(inputId).disabled=!canReview;
 }
 if($('projectStartCard'))$('projectStartCard').hidden=!canReview;
 $('projectRunAll').disabled=!canReview;
 if(!canReview)$('batchRetest').disabled=true;
 window.TNTableControls?.refresh();
}
function renderAll(){renderOverview();renderStoryList();renderTasks();renderReports();renderTeam();applyRoleUI();}
function renderOverview(){
 const c=state.context,p=c.project;
 $('statStories').textContent=c.stories.length;$('statRuns').textContent=c.runs.length;
 $('statTasks').textContent=state.tasks.filter(t=>!t.deleted_at&&!['COMPLETED','CANCELLED'].includes(t.status)).length;
 $('statDocs').textContent=c.documents.length;$('profileName').textContent=p.name;$('profileReference').textContent='Reference No. '+(p.reference_no||'—');
 $('profileScope').innerHTML='<strong>Objectives</strong><div>'+display(p.objectives)+'</div><strong class="d-block mt-2">In scope</strong><div>'+display(p.scope_in)+'</div>';
 $('profileAcceptance').innerHTML='<strong>Excluded</strong><div>'+display(p.scope_out)+'</div><strong class="d-block mt-2">Acceptance</strong><div>'+display(p.acceptance_criteria)+'</div>';
 $('profileRules').innerHTML=display(p.business_rules);
 const noScope=![p.objectives,p.scope_in,p.scope_out,p.acceptance_criteria,p.business_rules].some(v=>String(v||'').trim());
 $('profileScopeGrid').classList.toggle('d-none',noScope);$('profileScopeEmpty').classList.toggle('d-none',!noScope);
 $('profileMeta').innerHTML='<div class="tn-kv"><span>Target URL</span><span>'+display(p.target_url)+'</span></div><div class="tn-kv"><span>Technology</span><span>'+display(p.technology_stack)+'</span></div>'+(p.start_date||p.end_date?'<div class="tn-kv"><span>Dates</span><span>'+date(p.start_date)+' – '+date(p.end_date)+'</span></div>':'')+'<div class="tn-kv"><span>Reference</span><span>'+display(p.reference_no)+'</span></div>';
 const latest=c.runs[0]||null;const pending=state.tasks.filter(t=>!t.deleted_at&&t.status==='READY_FOR_RETEST').length;const successes=c.runs.reduce((n,r)=>n+Number(r.passed||0),0),failures=c.runs.reduce((n,r)=>n+Number(r.failed||0),0);const rate=successes+failures?Math.round(100*successes/(successes+failures))+'%':'—';$('overviewHealth').innerHTML='<div class="tn-health-chip"><strong>'+rate+'</strong>Recorded pass rate</div><div class="tn-health-chip"><strong>'+pending+'</strong>Ready for retest</div><div class="tn-health-chip"><strong>'+(latest?'#'+esc(latest.run_number):'—')+'</strong>Latest run</div><div class="tn-health-chip"><strong>'+c.environments.length+'</strong>Environments</div>';
 if($('statRate'))$('statRate').textContent=rate;
 if($('statRetest'))$('statRetest').textContent=pending;
 $('environmentList').innerHTML=c.environments.map(e=>'<div class="tn-kv"><span>'+esc(e.name)+(e.is_default?' ★':'')+'</span><span>'+esc(e.base_url)+'</span></div>').join('')||'<div class="tn-muted">No environment configured yet.</div>';
 renderDetailEnvironments(c);renderStartCard(c);renderRecentRuns(c);
 if($('docCount'))$('docCount').textContent=c.documents.length;$('detailDocumentsList').innerHTML=c.documents.map(d=>'<tr><td><strong>'+esc(d.filename)+'</strong></td><td>'+categoryTag(d.category)+'</td><td>'+Math.ceil(d.file_size/1024)+' KB</td>'+createdCell(d.uploaded_by_name,d.created_at)+'<td><span class="tn-icon-actions">'+actionIcon('eye','data-preview-doc="'+esc(d.id)+'"','Preview '+d.filename)+actionIcon('download','data-doc="'+esc(d.id)+'"','Download '+d.filename)+(state.context?.projectRole==='PROJECT_MANAGER'?actionIcon('remove','data-delete-doc="'+esc(d.id)+'"','Delete '+d.filename):'')+'</span></td></tr>').join('')||'<tr><td colspan="5" class="tn-empty">No project attachments yet. Use + Upload documents.</td></tr>';
}
function renderStoryList(){
 const c=state.context;
 $('storyList').innerHTML=c.stories.map(x=>'<tr><td><strong>'+esc(x.title)+'</strong><div class="tn-muted">'+esc(x.reference_no||'')+'</div>'+storyTypeTags(x)+'</td><td data-sort="'+Number(x.story_points||0)+'">'+(x.story_points?'<span class="tn-points" title="Story points">'+Number(x.story_points)+' pts</span>':'<span class="tn-muted">—</span>')+'</td><td>'+priorityTag(x.priority||'MEDIUM')+'</td>'+createdCell(x.created_by_name,x.created_at)+updatedCell(x.updated_by_name,x.updated_at,x.created_by_name,x.created_at)+'<td><span class="tn-icon-actions">'+actionIcon('edit','data-story="'+esc(x.id)+'"','Edit story '+x.title)+(isCodeStory(x)?actionIcon('scan','data-scan-story="'+esc(x.id)+'"','Scan code for story '+x.title):actionIcon('play','data-start-story="'+esc(x.id)+'"','Start testing story '+x.title))+(state.context?.projectRole==='PROJECT_MANAGER'?actionIcon('remove','data-delete-story="'+esc(x.id)+'"','Delete story '+x.title):'')+'</span></td></tr>').join('')||'<tr><td colspan="6" class="tn-empty">No stories yet. Use + Create to add one.</td></tr>';
 $('storyEnvironment').innerHTML='<option value="">Select environment</option>'+c.environments.filter(e=>e.is_active!==false).map(e=>'<option value="'+esc(e.id)+'">'+esc(e.name)+(e.is_default?' (default)':'')+'</option>').join('');
}

// ---- Story type (Functional / Code Intelligence) and Code branch (branches of the linked repository) ----
const STORY_TYPE_LABELS={FUNCTIONAL:'Functional',CODE_SAST:'SAST',CODE_SECRETS:'Secrets',CODE_SCA:'SCA',CODE_AI_REVIEW:'AI code review',CODE_QUALITY:'Code quality'};
const branchCache={};
// Story type: Functional OR Code Intelligence (radio); under Code Intelligence its checks are tick boxes.
function storyTypeChecks(){return [...document.querySelectorAll('#storyTypePick input[name="storyTypes"]')];}
// Story type: Functional (website tests) OR Code Intelligence (code scan only) — radio.
function storyKind(){return document.querySelector('#storyTypePick input[name="storyKind"]:checked')?.value||'FUNCTIONAL';}
// target: {type:'PULL_REQUEST'|'BRANCH'|'COMMIT', value} — what the story's code scan runs on.
function setStoryTypes(types,target){
 const list=Array.isArray(types)&&types.length?types:['FUNCTIONAL'];
 const code=list.some(t=>String(t).startsWith('CODE_'));
 for(const r of document.querySelectorAll('#storyTypePick input[name="storyKind"]'))r.checked=r.value===(code?'CODE':'FUNCTIONAL');
 for(const c of storyTypeChecks())c.checked=code&&list.includes(c.value);
 $('storyTargetType').value=target?.type||'PULL_REQUEST';
 $('storyRepo').dataset.wanted=target?.repo||'';$('storyRepo').value=''; // a new story starts on the newest repository
 $('storyCodeBranch').dataset.wanted=target?.value||'';
 $('storyCodeBranch').dataset.wantedType=$('storyTargetType').value;
 syncStoryType();
}
function syncStoryType(){
 const code=storyKind()==='CODE',checks=storyTypeChecks(),on=checks.filter(c=>c.checked);
 for(const c of checks)c.disabled=!code; // code checks only count for a Code Intelligence story
 $('storyTypeSummary').textContent=!code?'Functional':on.length===checks.length?'Code Intelligence (all)':on.length?'Code Intelligence: '+on.map(c=>STORY_TYPE_LABELS[c.value]).join(', '):'Code Intelligence: tick at least one check';
 $('storyBranchField').hidden=!code;
 // The story's ⛶ Scan: on when code scanning is enabled and the story is saved (re-applied after the form's permission switch).
 syncStoryScanButton();
 if(code)loadStoryTargets();
}
// Scan by → the list of pull requests, branches or recent commits of the linked repository (search box).
const TARGET_HINTS={PULL_REQUEST:'Pull requests (open first)',BRANCH:'Branches',COMMIT:'Recent commits of the default branch'};
// "Pull request" on GitHub, "Merge request" on GitLab — same choice, the provider's own word.
function prWords(provider){return provider==='gitlab'?{one:'merge request',many:'merge requests',One:'Merge request',Many:'Merge requests',mark:'!'}:{one:'pull request',many:'pull requests',One:'Pull request',Many:'Pull requests',mark:'#'};}
function setPrOption(select,provider){const o=select?.querySelector('option[value="PULL_REQUEST"]');if(o)o.textContent=prWords(provider).One;}
// Story → Repository: a project can link GitHub and GitLab repositories, so the story says which one it scans.
// The list shows the linked (enabled) repositories, newest first; the story's saved one is chosen when editing.
let storyRepoList=null;
async function loadStoryRepos(){
 const sel=$('storyRepo');
 if(!storyRepoList)storyRepoList=((await api('/api/projects/'+encodeURIComponent(requireProject())+'/repositories')).repositories||[]).filter(r=>r.source_enabled!==false);
 const keep=sel.dataset.wanted||sel.value;
 sel.innerHTML=storyRepoList.map(r=>'<option value="'+esc(r.id)+'">'+esc(r.repo_full_name)+' · '+(r.provider==='gitlab'?'GitLab':'GitHub')+'</option>').join('');
 if(keep&&storyRepoList.some(r=>String(r.id)===String(keep)))sel.value=keep;
 sel.dataset.wanted='';sel.hidden=!storyRepoList.length;
}
async function loadStoryTargets(){
 const p=requireProject(),type=$('storyTargetType').value,input=$('storyCodeBranch'),hint=$('storyBranchHint');
 hint.textContent='Loading…';
 try{
  await loadStoryRepos();
  const repoId=$('storyRepo').value;
  // Remember a list only when a repository is linked, so linking one later shows its list at once.
  const key=p+'|'+repoId+'|'+type,d=branchCache[key]||await api('/api/projects/'+encodeURIComponent(p)+'/repository-targets?type='+type+(repoId?'&repoId='+encodeURIComponent(repoId):''));
  if(d.repository)branchCache[key]=d;
  if(type!==$('storyTargetType').value||repoId!==$('storyRepo').value)return; // changed while loading
  if(!d.repository){input.disabled=true;input.value='';$('storyTargetType').disabled=true;hint.textContent='Link a repository in the Source code tab to choose what to scan.';return;}
  input.disabled=false;$('storyTargetType').disabled=false;
  const wanted=input.dataset.wantedType===type?input.dataset.wanted:'';
  window.TNPick.attach(input,d.items,{value:wanted||(type==='BRANCH'?d.defaultBranch:''),showAllOnOpen:true});
  // A list left open from the previous type is closed, so the next click shows the new list.
  const openList=input.closest('.tn-pick')?.querySelector('.tn-pick-list');if(openList)openList.hidden=true;
  if(!wanted&&type!=='BRANCH'){input.value='';input.dataset.value='';}
  // GitLab calls pull requests "merge requests" (numbers start with !).
  const pr=prWords(d.provider);setPrOption($('storyTargetType'),d.provider);
  input.placeholder=type==='PULL_REQUEST'?'Search '+pr.one:type==='COMMIT'?'Search commit':'Search branch';
  hint.textContent=d.items.length?(type==='PULL_REQUEST'?pr.Many+' (open first)':TARGET_HINTS[type])+' of '+d.repository+(type==='BRANCH'?' · default: '+d.defaultBranch:''):'No '+(type==='PULL_REQUEST'?pr.many:type==='COMMIT'?'commits':'branches')+' found in '+d.repository+'.';
 }catch(err){delete branchCache[p+'|'+($('storyRepo').value||'')+'|'+type];input.disabled=true;hint.textContent=err.message;}
}
function clearTargetCache(){for(const k of Object.keys(branchCache))delete branchCache[k];storyRepoList=null;}
// A Code Intelligence story has code checks (CODE_*) instead of Functional; its ▶ starts a code scan, not test case generation.
function isCodeStory(x){return Array.isArray(x.story_types)&&x.story_types.some(t=>String(t).startsWith('CODE_'));}
function storyTypeTags(x){
 const types=Array.isArray(x.story_types)&&x.story_types.length?x.story_types:['FUNCTIONAL'];
 // Functional as its own tag; the Code Intelligence checks together in one tag (branch on hover).
 const code=types.filter(t=>t.startsWith('CODE_')).map(t=>STORY_TYPE_LABELS[t]||t);
 return '<div class="tn-story-types">'+(types.includes('FUNCTIONAL')?'<span class="tn-tag">Functional</span>':'')
  +(code.length?'<span class="tn-tag tn-tag-code" title="Code Intelligence · scan by '+esc(targetText(x))+'">Code: '+esc(code.join(' · '))+'</span>':'')+'</div>';
}
// "pull request #45", "branch main", "commit a1b2c3d" (empty = project default branch).
function targetText(x){const t=x.code_target_type||'BRANCH',v=x.code_target||x.code_branch||'';if(!v)return 'project default branch';return t==='PULL_REQUEST'?'pull request #'+v:t==='COMMIT'?'commit '+v.slice(0,7):'branch '+v;}
function clearStory(){
 $('storyForm').reset();$('storyId').value='';$('storyFormTitle').textContent='Write business story';
 setStoryTypes(['FUNCTIONAL'],{type:'PULL_REQUEST',value:''});
 const chosen=state.context?.environments.find(e=>e.is_active!==false&&e.is_default)||state.context?.environments.find(e=>e.is_active!==false);
 if(chosen)$('storyEnvironment').value=chosen.id;
}
function selectStory(id){
 const story=state.context?.stories.find(x=>String(x.id)===String(id));if(!story)return;
 const form=$('storyForm');$('storyId').value=story.id;
 for(const [key,val] of Object.entries({title:story.title,referenceNo:story.reference_no,story:story.story,acceptanceCriteria:story.acceptance_criteria,pagePaths:story.page_paths,priority:story.priority,environmentId:story.environment_id,storyPoints:story.story_points,pageScope:story.page_scope||'ALL_DISCOVERED_PAGES'})){
 if(form.elements.namedItem(key))form.elements.namedItem(key).value=val||'';
 }
 setStoryTypes(story.story_types,{type:story.code_target_type||'BRANCH',value:story.code_target||story.code_branch||'',repo:story.code_repository_id||''});
 $('storyFormTitle').textContent='Edit story · '+(story.reference_no||'');
 show('stories');
 openStoryModal();
}
// Story form lives in a popup: opened by "+ Create" (new story) or the edit icon (existing story).
function openStoryModal(){storyFormError('');loadCodeStatus();bootstrap.Modal.getOrCreateInstance($('storyModal')).show();}
function storyFormError(message){const el=$('storyFormError');if(!el)return;el.textContent=message;el.classList.toggle('d-none',!message);}
async function saveStory(){
 const p=requireProject(),values=formPayload($('storyForm')),id=$('storyId').value;
 values.storyTypes=storyKind()==='CODE'?storyTypeChecks().filter(c=>c.checked).map(c=>c.value):['FUNCTIONAL'];
 if(!values.storyTypes.length)throw Error('Tick at least one Code Intelligence check.');
 values.codeTargetType=$('storyTargetType').value;values.codeTarget='';
 values.codeRepositoryId=values.storyTypes.some(t=>t.startsWith('CODE_'))?($('storyRepo').value||null):null;
 if(values.storyTypes.some(t=>t.startsWith('CODE_'))&&!$('storyCodeBranch').disabled){
  const b=window.TNPick.value($('storyCodeBranch'));
  if(b===null)throw Error('Choose a '+($('storyTargetType').value==='PULL_REQUEST'?'pull request':$('storyTargetType').value==='COMMIT'?'commit':'branch')+' from the list, or clear it to use the default branch.');
  values.codeTarget=b||'';
 }
 const path='/api/projects/'+encodeURIComponent(p)+'/stories'+(id?'/'+encodeURIComponent(id):'');
 const d=await api(path,{method:id?'PATCH':'POST',body:JSON.stringify(values)});
 await loadWorkspace();notice('Story saved to this project.','success');
 return d.story;
}
async function launchStory(){
 requireProject();const form=$('storyForm');if(!form.reportValidity())return;
 const current=$('storyId').value;const saved=await saveStory();
 const env=state.context.environments.find(e=>e.is_active!==false&&e.id===form.elements.namedItem('environmentId').value)||state.context.environments.find(e=>e.is_active!==false&&e.is_default)||state.context.environments.find(e=>e.is_active!==false);
 const project=state.context.project;
 const storyContext=[saved.story,saved.acceptance_criteria?'Acceptance criteria:\n'+saved.acceptance_criteria:'',project.scope_in?'Project scope:\n'+project.scope_in:'',project.scope_out?'Out of scope (do not test):\n'+project.scope_out:'',project.business_rules?'Business rules:\n'+project.business_rules:''].filter(Boolean).join('\n\n');
 const handoff={projectId:state.projectId,storyId:saved.id,story:storyContext,pagePaths:saved.page_paths||'',targetUrl:env?.base_url||project.target_url||'',environmentName:env?.name||'Test'};
 if(!handoff.targetUrl)throw Error('Configure a project environment or target URL before testing.');
 sessionStorage.setItem('testnexus:runnerHandoff',JSON.stringify(handoff));sessionStorage.setItem('testnexus:runnerOrigin','project');
 window.location.href='/runner';
}
async function launchTaskTest(){const project=requireProject(),taskId=state.taskId;if(!taskId)throw Error('Select a task first.');const detail=await api('/api/work-items/'+encodeURIComponent(taskId)+'/details');const task=detail.task;if(!['QA','PROJECT_MANAGER'].includes(detail.projectRole))throw Error('QA or project manager role required.');const env=state.context.environments.find(e=>e.is_active!==false&&e.is_default)||state.context.environments.find(e=>e.is_active!==false);const profile=state.context.project;const targetUrl=env?.base_url||profile.target_url;if(!targetUrl)throw Error('Set a project target URL or environment before testing.');const story=['Test task: '+task.title,task.description||'',task.external_case_id?'Linked test case: '+task.external_case_id:'',profile.business_rules?'Project business rules: '+profile.business_rules:'',profile.scope_in?'In scope: '+profile.scope_in:''].filter(Boolean).join('\n\n');sessionStorage.setItem('testnexus:runnerHandoff',JSON.stringify({projectId:project,taskId,story,targetUrl,environmentName:env?.name||'Test'}));sessionStorage.setItem('testnexus:runnerOrigin','project');window.location.href='/runner';}
function updateTaskSelection(){
 const count=document.querySelectorAll('.task-select:checked').length;
 $('taskSelectionCount').textContent=count+' selected';
 $('batchRetest').disabled=count===0;
 const all=document.querySelectorAll('.task-select');
 $('allTasks').checked=all.length>0&&count===all.length;
 $('allTasks').indeterminate=count>0&&count<all.length;
}
function renderTasks(){
 let tasks=state.tasks.filter(x=>!x.deleted_at),status=$('taskStatusFilter')?.value||'';
 const q=$('taskSearch').value.trim().toLowerCase();
 if(status==='DELETED'){
 const deleted=(state.deletedTasks||[]).filter(x=>!q||String(x.title||'').toLowerCase().includes(q));
 $('tasksBody').innerHTML=deleted.map(x=>'<tr><td></td><td><strong>'+esc(x.title)+'</strong></td><td>—</td><td>—</td><td>—</td><td>'+display(x.deleted_by_name)+'</td><td>'+statusTag('CANCELLED')+'</td><td>—</td><td>'+dateTime(x.deleted_at)+'</td><td><span class="tn-icon-actions">'+actionIcon('restore','data-restore="'+esc(x.id)+'"','Restore task '+x.title)+'</span></td></tr>').join('')||'<tr><td colspan="10" class="tn-empty">No deleted tasks match your search.</td></tr>';
 $('taskVisibleCount').textContent=deleted.length;updateTaskSelection();return;
 }
 if(status)tasks=tasks.filter(t=>t.status===status);
 if(q)tasks=tasks.filter(t=>[taskNo(t.task_number),t.title,t.work_type,workTypeLabel(t.work_type),t.external_case_id,t.assigned_to_name,t.team_name,t.case_category,taskNo(t.parent_task_number),t.story_ref,t.story_title].some(v=>String(v||'').toLowerCase().includes(q)));
 {
  const all=new Map(state.tasks.map(t=>[t.id,t]));
  const depth=t=>{let n=0,p=t.parent_work_item_id,seen=new Set([t.id]);while(p&&all.has(p)&&!seen.has(p)&&n<8){seen.add(p);n++;p=all.get(p).parent_work_item_id;}return n;};
  const order=[];const byParent=new Map();for(const t of tasks){const key=t.parent_work_item_id||'';if(!byParent.has(key))byParent.set(key,[]);byParent.get(key).push(t);}
  const visited=new Set();const walk=t=>{if(visited.has(t.id))return;visited.add(t.id);order.push({...t,_depth:depth(t)});for(const child of byParent.get(t.id)||[])walk(child);};
  for(const t of tasks)if(!t.parent_work_item_id||!tasks.some(x=>x.id===t.parent_work_item_id))walk(t);
  for(const t of tasks)walk(t);tasks=order;
 }
 $('tasksBody').innerHTML=tasks.map(x=>'<tr><td><input type="checkbox" class="task-select" value="'+esc(x.id)+'" aria-label="Select '+esc(x.title)+'"></td><td><div class="tn-task-name" style="--task-depth:'+Math.min(x._depth||0,8)+'">'+(x._depth?' <span class="tn-tree-mark" aria-hidden="true">↳</span>':'')+'<div><span class="tn-task-no">'+taskNo(x.task_number)+'</span>'+(x.story_points?' <span class="tn-points" title="Story points">'+Number(x.story_points)+' pts</span>':'')+' <button class="tn-link tn-task-title" data-task="'+esc(x.id)+'">'+esc(x.title)+'</button><div class="tn-muted">'+esc(workTypeLabel(x.work_type))+(x.origin==='FAILED_TEST'?' · from a failed test':x.origin==='CODE_FINDING'?' · from a code scan':'')+'</div></div></div></td><td>'+(x.parent_task_number?'<button class="tn-link" data-task="'+esc(x.parent_work_item_id)+'" title="'+esc(x.parent_title||'')+'">'+taskNo(x.parent_task_number)+'</button>':'—')+'</td><td>'+(x.story_ref?'<button class="tn-link" data-story="'+esc(x.story_id)+'" title="'+esc(x.story_title||'')+'">'+esc(x.story_ref)+'</button>'+(x.story_story_points?'<div class="tn-muted">'+Number(x.story_story_points)+' pts</div>':''):'—')+'</td><td>'+display(x.team_name)+'</td><td>'+(x.assigned_to_name?'<strong>'+esc(x.assigned_to_name)+'</strong>'+(x.assigned_role?'<div class="tn-muted">'+esc(ROLE_NAMES[x.assigned_role]||x.assigned_role)+(x.assigned_by_system?' · by system':'')+'</div>':''):'<span class="tn-muted">Not assigned</span>')+'</td><td>'+statusTag(x.status)+'</td><td data-sort="'+Number(x.progress_percent||0)+'"><div class="tn-progress" title="'+Number(x.progress_percent||0)+'% · time spent '+esc(hoursText(x.time_spent_minutes))+'"><span style="width:'+Number(x.progress_percent||0)+'%"></span></div><div class="tn-muted">'+Number(x.progress_percent||0)+'%'+(x.time_spent_minutes?' · '+esc(hoursText(x.time_spent_minutes)):'')+'</div></td>'+updatedCell(x.updated_by_name,x.updated_at,x.created_by_name,x.created_at)+'<td><span class="tn-icon-actions">'+actionIcon('eye','data-task="'+esc(x.id)+'"','Open task '+x.title)+actionIcon('edit','data-edit-task="'+esc(x.id)+'"','Edit task '+x.title)+(x.origin==='CODE_FINDING'?(['PROJECT_MANAGER','QA'].includes(state.context?.projectRole)?actionIcon('scan','data-scan-task="'+esc(x.id)+'"','Scan again for task '+x.title):''):actionIcon('play','data-start-task="'+esc(x.id)+'"','Start testing task '+x.title))+(state.context?.projectRole==='PROJECT_MANAGER'?actionIcon('remove','data-delete-task="'+esc(x.id)+'"','Delete task '+x.title):'')+'</span></td></tr>').join('')||'<tr><td colspan="10" class="tn-empty">No tasks match your filters. Clear the search or change the filters.</td></tr>';
 $('taskVisibleCount').textContent=tasks.length;updateTaskSelection();
}
const canRerun=()=>['QA','PROJECT_MANAGER'].includes(state.context?.projectRole);
function renderReports(){
 // One row per run; re-runs are attempts inside it (see runGroups on the server).
 const runs=state.context.runGroups||[],passed=runs.reduce((n,r)=>n+Number(r.passed||0),0),failed=runs.reduce((n,r)=>n+Number(r.failed||0),0);
 const total=passed+failed,rate=total?Math.round(passed/total*100):0,last=runs[0];
 const kpi=(icon,tone,label,value,extra='')=>'<div class="tn-kpi"><span class="tn-kpi-label"><span class="tn-kpi-icon tn-kpi-'+tone+'" aria-hidden="true">'+icon+'</span>'+label+'</span><b>'+value+'</b>'+extra+'</div>';
 const svg=p=>'<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false">'+p+'</svg>';
 $('runKpis').innerHTML=
  kpi(svg('<path d="M20 6 9 17l-5-5"/>'),rate>=90?'green':rate>=70?'amber':'orange','Pass rate',total?rate+'%':'—',total?'<div class="tn-mini-bar" role="img" aria-label="'+rate+' percent passed"><span style="width:'+rate+'%"></span></div>':'')+
  kpi(svg('<path d="m8 5 11 7-11 7z"/>'),'violet','Test runs',runs.length)+
  kpi(svg('<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>'),'green','Tests passed',passed)+
  kpi(svg('<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>'),failed?'orange':'slate','Tests failed',failed)+
  kpi(svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),'blue','Last run',last?esc(date(last.last_at||last.completed_at)):'—',last?'<div class="tn-kpi-sub">'+esc(last.last_by_name||last.executed_by_name||'Unknown')+'</div>':'');
 $('runsCountRuns').textContent=runs.length;
 $('runsBody').innerHTML=runs.map(r=>{const p=Number(r.passed||0),f=Number(r.failed||0),t=p+f,pct=t?Math.round(p/t*100):0;return '<tr><td data-sort="'+esc(r.completed_at||'')+'"><strong>Run #'+esc(r.run_number)+'</strong></td><td data-sort="'+pct+'"><div class="tn-run-result"><span class="tn-result '+(f?'fail':'pass')+'">'+(f?'Failed':'Passed')+'</span><span class="tn-run-bar" role="img" aria-label="'+p+' passed, '+f+' failed"><span style="width:'+pct+'%"></span></span><span class="tn-run-counts">'+p+' / '+t+'</span></div></td><td>'+display(r.environment)+'</td><td data-sort="'+(1+Number(r.rerun_count||0))+'">'+(1+Number(r.rerun_count||0))+'</td>'+createdCell(r.executed_by_name,r.completed_at)+updatedCell(r.last_by_name||r.executed_by_name,r.last_at||r.completed_at,r.executed_by_name,r.completed_at)+'<td><span class="tn-icon-actions">'+actionIcon('eye','data-open-run="'+esc(r.id)+'"','View run '+r.run_number+' test cases')+actionIcon('report','data-run-report="'+esc(r.latest_attempt_id||r.id)+'" data-report-label="Run #'+esc(r.run_number)+(Number(r.rerun_count)?' · Attempt '+(1+Number(r.rerun_count)):'')+'"','Report of run '+r.run_number+(Number(r.rerun_count)?' (latest attempt)':''))+(r.has_ai_report?actionIcon('ai','data-run-ai="'+esc(r.latest_attempt_id||r.id)+'" data-report-label="Run #'+esc(r.run_number)+(Number(r.rerun_count)?' · Attempt '+(1+Number(r.rerun_count)):'')+'"','AI report of run '+r.run_number+(Number(r.rerun_count)?' (latest attempt)':'')):actionIcon('ai','aria-disabled="true" data-no-ai','No AI report was generated for this run'))+(canRerun()?actionIcon('play','data-rerun-run="'+esc(r.id)+'" data-run-label="Run #'+esc(r.run_number)+'"','Re-run run '+r.run_number):'')+'</span></td></tr>';}).join('')||'<tr><td colspan="7" class="tn-empty">No test runs yet. Start testing from Context &amp; scope.</td></tr>';
}
// Run details (eye on Runs & reports): every test case of that run with its result and evidence.
function openRunDialog(sessionId,runNumber){
 const run=(state.context?.runs||[]).find(r=>String(r.session_id)===String(sessionId)&&String(r.run_number)===String(runNumber))||{};
 const rows=(state.evidence||[]).filter(x=>String(x.session_id)===String(sessionId)&&(!runNumber||String(x.run_number)===String(runNumber)));
 const passed=rows.filter(x=>x.passed).length,failed=rows.length-passed,pct=rows.length?Math.round(passed/rows.length*100):0;
 $('runDialogTitle').textContent='Run #'+(run.run_number||runNumber||'');
 $('runDialogMeta').textContent=[run.environment,dateTime(run.completed_at),run.executed_by_name?'by '+run.executed_by_name:''].filter(Boolean).join(' · ');
 $('runDialogSummary').innerHTML=rows.length?'<span class="tn-result pass">'+passed+' passed</span><span class="tn-result fail">'+failed+' failed</span><span class="tn-run-bar" role="img" aria-label="'+pct+' percent passed"><span style="width:'+pct+'%"></span></span><strong>'+pct+'%</strong>':'';
 $('runDialogBody').innerHTML=rows.map(x=>'<tr><td><span class="tn-case-id">'+esc(x.external_case_id||'—')+'</span></td><td>'+esc(String(x.title||'').replace(/^Test execution\s+\S+\s+-\s+/i,''))+'</td><td><span class="tn-result '+(x.passed?'pass':'fail')+'">'+(x.passed?'Passed':'Failed')+'</span></td><td>'+evidenceButtons(x.evidence_json)+'</td></tr>').join('')||'<tr><td colspan="4" class="tn-empty">No test case results are saved for this run.</td></tr>';
 $('runDialogNote').textContent='';
 $('runDialogReport').dataset.session=sessionId;
 $('runDialog').showModal();
}
document.addEventListener('click',async e=>{
 if(e.target.closest('[data-close-run]')||e.target===$('runDialog')){$('runDialog').close();return;}
 const btn=e.target.closest('#runDialogReport');if(!btn)return;
 // The full HTML report exists only when "Generate AI Analysis Report" was used on the testing page.
 try{await download('/api/reports/'+encodeURIComponent(btn.dataset.session));}
 catch{$('runDialogNote').textContent='No full report was generated for this run. Use "Generate AI Analysis Report" on the testing page after a run to create one.';}
});
function evidenceButtons(meta){
 if(!meta||typeof meta!=='object')return '<span class="tn-muted">No evidence stored</span>';
 const e=meta.evidence||meta;
 return ['screenshotUrl','videoUrl'].filter(k=>typeof e[k]==='string'&&(e[k].startsWith('/api/artifacts/')||(/^\/api\/projects\/[^/]+\/run-evidence\//.test(e[k])))).map(k=>'<span class="tn-icon-actions">'+actionIcon(k==='videoUrl'?'video':'image','data-evidence="'+esc(e[k])+'"',k==='videoUrl'?'View video evidence':'View screenshot evidence')+'</span>').join('')||'<span class="tn-muted">No retained media URL</span>';
}
async function loadWorkflow(){
 const d=await api('/api/projects/'+encodeURIComponent(requireProject())+'/workflow');
 const f=$('workflowForm'),w=d.workflow||{};
 f.elements.namedItem('autoCreateFailedTasks').checked=!!w.auto_create_failed_tasks;
 f.elements.namedItem('autoCloseVerifiedRetests').checked=!!w.auto_close_verified_retests;
 $('workflowDeveloper').value=w.default_developer||'';
 const locked=d.projectRole!=='PROJECT_MANAGER';
 f.querySelectorAll('input,select,button').forEach(x=>x.disabled=locked);
}
async function loadInventory(){const project=requireProject();const [inventory,audit,repairMemory]=await Promise.all([api('/api/projects/'+encodeURIComponent(project)+'/test-inventory'),api('/api/projects/'+encodeURIComponent(project)+'/audit'),api('/api/projects/'+encodeURIComponent(project)+'/repair-memory?scope='+(state.learningView||'project'))]);$('inventoryCases').innerHTML=inventory.cases.map(x=>'<tr><td>'+(x.story_reference?'<span class="tn-chip-ref">'+esc(x.story_reference)+'</span>':'<span class="tn-chip-none">Unlinked</span>')+'</td><td><span class="tn-case-title">'+esc(x.title)+'</span><div><span class="tn-case-id">'+esc(x.external_case_id)+'</span></div></td><td data-sort="'+(/^ai/i.test(x.source||'')?'AI':'Manual')+'">'+sourceTag(x.source)+'</td><td>'+esc((x=>/^(ui|api)$/i.test(String(x||''))?String(x).toUpperCase():x?String(x).charAt(0).toUpperCase()+String(x).slice(1).toLowerCase():'—')(x.test_category))+'</td><td>'+esc((x=>x?String(x).charAt(0).toUpperCase()+String(x).slice(1).toLowerCase():'—')(x.type))+'</td><td data-sort="'+esc({CRITICAL:4,HIGH:3,MEDIUM:2,LOW:1}[String(x.priority||'').toUpperCase()]||0)+'">'+priorityTag(x.priority)+'</td><td data-sort="'+esc(x.created_at||'')+'">'+personCell(x.created_by_name,x.created_at)+'</td><td data-sort="'+esc(x.updated_at||x.created_at||'')+'">'+personCell(x.updated_by_name,x.updated_at||x.created_at)+'</td><td><span class="tn-session-id" title="'+esc(x.session_id)+'">'+esc(x.session_id)+'</span></td></tr>').join('')||'<tr><td colspan="9" class="tn-empty">No cases yet.</td></tr>';if($('inventoryStories'))$('inventoryStories').innerHTML=inventory.stories.map(x=>'<tr><td>'+esc(x.reference_no||'')+' · '+esc(x.title)+'</td><td>'+x.generation_count+'</td><td>'+x.case_count+'</td><td>'+x.execution_count+'</td></tr>').join('')||'<tr><td colspan="4">No stories yet.</td></tr>';renderLearning(repairMemory.repairs||[]);$('inventoryAudit').innerHTML=audit.events.map(x=>'<tr><td><span class="tn-event">'+esc(auditLabel(x.event_type))+'</span></td><td>'+esc(auditDetails(x))+'</td><td>'+(x.actor_name?'<span class="tn-who">'+esc(x.actor_name)+'</span>':'<span class="tn-muted" title="No user was recorded for this event">System</span>')+'</td><td data-sort="'+esc(x.created_at||'')+'">'+dateTime(x.created_at)+'</td></tr>').join('')||'<tr><td colspan="4" class="tn-empty">No recorded audit events yet.</td></tr>';}
// Project teams (option B): teams belong to the project; each member has one team, chosen in the members table.
async function loadTeams(){
 const project=requireProject();
 const [teams,assignees,mt]=await Promise.all([api('/api/projects/'+encodeURIComponent(project)+'/project-teams'),api('/api/projects/'+encodeURIComponent(project)+'/team-assignees'),api('/api/projects/'+encodeURIComponent(project)+'/member-teams').catch(()=>({memberships:[]}))]);
 state.memberTeams={};for(const m of mt.memberships||[])(state.memberTeams[m.user_id]=state.memberTeams[m.user_id]||[]).push(m);
 $('teamManageLink').hidden=!state.user||String(state.user.role||'').toUpperCase()!=='MANAGER';
 state.projectTeams=teams.teams||[];
 state.teamOfUser={};for(const m of teams.memberships||[])state.teamOfUser[m.user_id]=m.team_id;
 state.hasTeams=state.projectTeams.some(t=>t.member_count>0); // the assignment rule applies once teams have members
 renderTeam();renderTeamList();
 if($('newTaskAssignee'))$('newTaskAssignee').innerHTML='<option value="">Unassigned</option>'+(assignees.users||[]).map(u=>'<option value="'+esc(u.id)+'">'+esc(u.display_name)+'</option>').join('');
}
// Teams of this project, as saved in the DB (every project has QA team, Development team, Project management, Observers).
function teamChoices(){
 return (state.projectTeams||[]).map(t=>({id:t.id,name:t.name}));
}
// Returns a saved team id; creates the ready-made team first if needed.
async function ensureTeamId(value){
 if(!value||!String(value).startsWith('new:'))return value||null;
 const d=await api('/api/projects/'+encodeURIComponent(requireProject())+'/project-teams',{method:'POST',body:JSON.stringify({name:String(value).slice(4)})});
 return d.team?.id||null;
}
// Teams popup: pick a team from the dropdown, then see / add / remove its members; or create a new team.
function renderTeamList(){
 const picker=$('teamPicker');if(!picker)return;
 const teams=state.projectTeams||[],choices=teamChoices();
 if(state.selectedTeamId&&!choices.some(t=>t.id===state.selectedTeamId))state.selectedTeamId='';
 picker.innerHTML='<option value="">Select a team</option>'+choices.map(t=>'<option value="'+esc(t.id)+'"'+(t.id===state.selectedTeamId?' selected':'')+'>'+esc(t.name)+'</option>').join('');
 const team=choices.find(t=>t.id===state.selectedTeamId),detail=$('teamDetail');
 detail.hidden=!team;
 if(!team)return;
 const members=state.context?.members||[],inTeam=members.filter(m=>state.teamOfUser?.[m.user_id]===team.id);
 $('teamMemberCount').textContent=inTeam.length;
 $('teamMemberList').innerHTML=inTeam.map(m=>'<div class="tn-team-member"><span class="tn-row-person tn-person-sm"><span class="tn-avatar tn-avatar-0" aria-hidden="true">'+esc(initialsOf(m.display_name||m.email))+'</span><strong>'+esc(m.display_name)+'</strong></span><select class="form-select form-select-sm tn-move-team" data-member-role="'+esc(m.user_id)+'" aria-label="Project role of '+esc(m.display_name)+'">'+Object.entries(ROLE_LABELS).map(([k,l])=>'<option value="'+k+'"'+(k===m.project_role?' selected':'')+'>'+esc(l)+'</option>').join('')+'</select>'+'<select class="form-select form-select-sm tn-move-team" data-team-move-member="'+esc(m.user_id)+'" aria-label="Move '+esc(m.display_name)+' to another team"><option value="">Move to…</option>'+teams.filter(t=>t.id!==team.id).map(t=>'<option value="'+esc(t.id)+'">'+esc(t.name)+'</option>').join('')+'</select>'+'</div>').join('')||'<div class="tn-empty">No members in this team yet. Use + Add member, or move someone here from another team.</div>';
}
document.addEventListener('change',async e=>{
 const mv=e.target.closest('[data-team-move-member]');if(!mv||!mv.value)return;
 try{await api('/api/projects/'+encodeURIComponent(state.projectId)+'/members/'+encodeURIComponent(mv.dataset.teamMoveMember)+'/team',{method:'PUT',body:JSON.stringify({teamId:mv.value})});notice('Moved to '+mv.selectedOptions[0].text+'.','success');await loadTeams();}
 catch(err){notice(err.message);}
});
document.addEventListener('change',e=>{
 if(e.target.id!=='teamPicker')return;
 $('teamAddForm').hidden=true;
 state.selectedTeamId=e.target.value;renderTeamList();
});
document.addEventListener('click',async e=>{
 const project=state.projectId;
 if(e.target.closest('#teamNewBtn')){$('teamAddForm').hidden=false;$('teamAddForm').elements.name.focus();return;}
 if(e.target.closest('#teamAddCancel')){$('teamAddForm').hidden=true;$('teamAddForm').reset();renderTeamList();return;}
});
// Members table: role and team are labels; teams are changed in the Teams popup.
function teamCell(m){
 const list=state.memberTeams?.[m.user_id]||[];
 if(!list.length)return '<span class="tn-muted">No team</span>';
 return list.map(t=>'<span class="tn-team-chip'+(t.assigned?'':' muted')+'" title="'+(t.assigned?'Team assigned to this project':'Company team (not assigned to this project)')+'">'+esc(t.name)+'</span>').join(' ');
}
function roleCell(m){
 return '<span class="tn-role-chip role-'+esc(m.project_role||'')+'">'+esc(ROLE_LABELS[m.project_role]||m.project_role||'Member')+'</span>';
}
document.addEventListener('change',async e=>{
 const team=e.target.closest('[data-member-team]'),role=e.target.closest('[data-member-role]');if(!team&&!role)return;
 const project=requireProject();
 try{
  if(team){await api('/api/projects/'+encodeURIComponent(project)+'/members/'+encodeURIComponent(team.dataset.memberTeam)+'/team',{method:'PUT',body:JSON.stringify({teamId:await ensureTeamId(team.value)})});notice('Team updated.','success');await loadTeams();}
  else{await api('/api/projects/'+encodeURIComponent(project)+'/members/'+encodeURIComponent(role.dataset.memberRole),{method:'PATCH',body:JSON.stringify({projectRole:role.value})});notice('Role updated.','success');await loadWorkspace();await loadTeams();}
 }catch(err){notice(err.message);await loadTeams().catch(()=>{});}
});
document.addEventListener('submit',async e=>{
 if(e.target.id!=='teamAddForm')return;e.preventDefault();
 try{const d=await api('/api/projects/'+encodeURIComponent(requireProject())+'/project-teams',{method:'POST',body:JSON.stringify({name:e.target.elements.name.value.trim()})});e.target.reset();e.target.hidden=true;state.selectedTeamId=d.team?.id||'';notice('Team created. Now add members to it.','success');await loadTeams();}
 catch(err){notice(err.message);}
});
// Team column: the project teams a member belongs to (from team_members).
function teamChips(userId){
 const names=state.teamsByUser?.[userId]||[];
 if(!names.length)return '<span class="tn-muted">'+(state.hasTeams?'No team (cannot be assigned tasks)':'—')+'</span>';
 return names.map(n=>'<span class="tn-team-chip">'+esc(String(n).replace(/^[A-Z0-9-]+ \/ /,''))+'</span>').join(' ');
}
function renderTeam(){
 $('teamBody').innerHTML=state.context.members.map(m=>'<tr><td><span class="tn-row-person tn-person-sm"><span class="tn-avatar tn-avatar-0" aria-hidden="true">'+esc(initialsOf(m.display_name||m.email))+'</span><span><strong>'+esc(m.display_name)+'</strong><span class="tn-member-email">'+esc(m.email)+'</span></span></span></td><td>'+roleCell(m)+'</td><td>'+teamCell(m)+'</td>'+createdCell(m.added_by_name,m.created_at)+'<td><span class="tn-icon-actions">'+(state.view==='teams'&&state.context?.projectRole==='PROJECT_MANAGER'?actionIcon('remove','data-remove-project-member="'+esc(m.user_id)+'"','Remove project member '+m.display_name):'')+'</span></td></tr>').join('')||'<tr><td colspan="5" class="tn-empty">No members.</td></tr>';
 const list=state.users||state.context.members;
 state.accountRoles={};for(const x of list)state.accountRoles[x.id||x.user_id]=accountProjectRole(x);
 $('memberUser').innerHTML='<option value="">Select user</option>'+list.map(x=>'<option value="'+esc(x.id||x.user_id)+'">'+esc(x.displayName||x.display_name||x.email)+'</option>').join('');
 if($('memberProject'))$('memberProject').innerHTML=(state.projects||[]).map(p=>'<option value="'+esc(p.id)+'"'+(p.id===state.projectId?' selected':'')+'>'+esc(p.name)+'</option>').join('');
 showMemberRole();fillMemberTeams($('memberProject')?.value||state.projectId);
 if($('newTaskAssignee'))$('newTaskAssignee').innerHTML='<option value="">Unassigned</option>'+state.context.members.map(m=>'<option value="'+esc(m.user_id)+'">'+esc(m.display_name)+'</option>').join('');
 $('workflowDeveloper').innerHTML='<option value="">Manual assignment</option>'+state.context.members.filter(m=>m.project_role==='DEVELOPER').map(m=>'<option value="'+esc(m.user_id)+'">'+esc(m.display_name)+'</option>').join('');
 renderDetailTeam();
}
// Project details page: read-only environments and team, plus the "Start testing this project" box.
function renderDetailEnvironments(c){
 const box=$('detailEnvironments');if(!box)return;
 if($('detailEnvManage'))$('detailEnvManage').href=projectRoute(state.projectId,'environments');
 box.innerHTML=c.environments.map(e=>'<div class="tn-env-row'+(e.is_active===false?' is-disabled':'')+'"><div><div class="tn-env-name">'+esc(e.name)+(e.is_default?'<span class="tn-chip tn-chip-blue">Default</span>':'')+(e.is_active===false?'<span class="tn-chip">Disabled</span>':'')+'</div><div class="tn-env-meta">'+esc(e.stage_type||'')+' · '+esc(e.base_url)+'</div></div><span class="tn-env-login'+(e.login_required?' is-on':'')+'">'+(e.login_required?'Login ✓'+(e.test_user_count>1?' · '+e.test_user_count+' users':''):'No login')+'</span></div>').join('')||'<div class="tn-muted">No environment configured yet.</div>';
}
const ROLE_LABELS={PROJECT_MANAGER:'Project manager',QA:'QA',DEVELOPER:'Developer',VIEWER:'Viewer'};
function initialsOf(name){return String(name||'?').split(/[\s@._-]+/).filter(Boolean).slice(0,2).map(x=>x[0].toUpperCase()).join('')||'?';}
function renderDetailTeam(){
 const box=$('detailTeam');if(!box)return;
 const members=state.context?.members||[];
 const person=(m,i)=>'<div class="tn-person"><span class="tn-avatar tn-avatar-'+(i%4)+'" aria-hidden="true">'+esc(initialsOf(m.display_name||m.email))+'</span><div><div class="tn-person-name">'+esc(m.display_name||m.email)+'</div><div class="tn-person-role">'+esc(ROLE_LABELS[m.project_role]||m.project_role||'Member')+'</div></div></div>';
 const LIMIT=5,showAll=box.dataset.showAll==='true'||members.length<=LIMIT;
 box.innerHTML=(showAll?members:members.slice(0,LIMIT)).map(person).join('')||'<div class="tn-muted">No members.</div>';
 if(members.length>LIMIT){
  const more=document.createElement('button');more.type='button';more.className='tn-show-more';
  more.textContent=showAll?'Show less':'Show all '+members.length+' members';
  more.onclick=()=>{box.dataset.showAll=String(!showAll);renderDetailTeam();};
  box.append(more);
 }
}
// Last 5 runs on the project details page (newest first).
function renderRecentRuns(c){
 const box=$('detailRecentRuns');if(!box)return;
 const runs=(c.runs||[]).slice(0,5);
 box.innerHTML=runs.map(r=>{
  const passed=Number(r.passed||0),failed=Number(r.failed||0),total=passed+failed,rate=total?Math.round(100*passed/total):0;
  return '<div class="tn-run-row"><div><div class="tn-run-title">Run #'+esc(r.run_number)+(r.environment?' · '+esc(r.environment):'')+'</div><div class="tn-muted">'+esc(dateTime(r.completed_at))+(r.executed_by_name?' · '+esc(r.executed_by_name):'')+'</div></div>'
   +'<div class="tn-run-result"><span class="tn-run-bar" aria-hidden="true"><span style="width:'+rate+'%"></span></span><span class="tn-run-counts"><b class="tn-pass">'+passed+' passed</b>'+(failed?' · <b class="tn-fail">'+failed+' failed</b>':'')+'</span></div></div>';
 }).join('')||'<div class="tn-empty-inline">No test runs yet. Use <strong>Start Testing</strong> above to run this project&#39;s first tests.</div>';
}
function renderStartCard(c){
 const env=$('startEnvironment'),story=$('startStory');if(!env||!story)return;
 const previousEnv=env.value,previousStory=story.value;
 env.innerHTML=c.environments.filter(e=>e.is_active!==false).map(e=>'<option value="'+esc(e.id)+'"'+(e.is_default?' selected':'')+'>'+esc(e.name)+(e.is_default?' (default)':'')+'</option>').join('')||'<option value="">Project target URL</option>';
 story.innerHTML='<option value="">Whole project scope</option>'+c.stories.map(s=>'<option value="'+esc(s.id)+'" data-ref="'+esc(s.reference_no||'')+'">'+esc(s.title||s.reference_no||'Story')+'</option>').join('');
 if([...env.options].some(o=>o.value===previousEnv))env.value=previousEnv;
 if([...story.options].some(o=>o.value===previousStory))story.value=previousStory;
 env.onchange=story.onchange=syncStartButton;
 setupStoryPicker();
 syncScopeChoice();
 syncStartButton();
}
// Story box on the Start testing card: opens a searchable popup listing "Whole project scope" and every story.
// The hidden #startStory select holds the chosen story, so starting a test works as before.
const storyPicker={stats:null,picked:'',rows:[]};
function syncScopeChoice(){
 const select=$('startStory');if(!select||!$('storyBoxText'))return;
 const story=select.value?select.selectedOptions[0]:null;
 $('storyBoxText').textContent=story?((story.dataset.ref?story.dataset.ref+' · ':'')+story.textContent):'Whole project scope';
 $('storyBox').title=$('storyBoxText').textContent;
}
function setStartStory(id){const select=$('startStory');select.value=id;select.dispatchEvent(new Event('change'));syncScopeChoice();}
async function openStoryPicker(){
 const dialog=$('storyPicker');
 storyPicker.picked=$('startStory').value;
 $('storyPickerSearch').value='';
 renderStoryPicker();
 dialog.showModal();
 $('storyPickerSearch').focus();
 // Test case and run counts per story (loaded once per project).
 if(!storyPicker.stats||storyPicker.stats.project!==state.projectId){
  try{const inv=await api('/api/projects/'+encodeURIComponent(state.projectId)+'/test-inventory');storyPicker.stats={project:state.projectId,byId:Object.fromEntries((inv.stories||[]).map(x=>[x.id,x]))};renderStoryPicker();}catch{/* counts are optional */}
 }
}
function closeStoryPicker(){$('storyPicker').close();syncScopeChoice();}
function renderStoryPicker(){
 const q=$('storyPickerSearch').value.trim().toLowerCase();
 const all=[...$('startStory').options].map(o=>({id:o.value,ref:o.dataset.ref||'',title:o.value?o.textContent:'Whole project scope',whole:!o.value}));
 const rows=all.filter(r=>!q||(r.ref+' '+r.title).toLowerCase().includes(q));
 const storyCount=all.length-1;
 const LIMIT=50,shown=rows.slice(0,LIMIT),stats=storyPicker.stats?.byId||{};
 storyPicker.rows=shown;
 $('storyPickerBody').innerHTML=shown.map(r=>{const st=stats[r.id];return '<tr class="tn-pick-row'+(r.whole?' tn-pick-whole':'')+(r.id===storyPicker.picked?' picked':'')+'" data-pick-story="'+esc(r.id)+'" tabindex="0" aria-selected="'+(r.id===storyPicker.picked)+'"><td class="tn-muted">'+(r.whole?'All':esc(r.ref||'—'))+'</td><td><strong>'+esc(r.title)+'</strong>'+(r.whole?'<div class="tn-muted">Uses the project requirements, not one story</div>':'')+'</td><td>'+(r.whole?'—':st?esc(st.case_count):'…')+'</td><td>'+(r.whole?'—':st?esc(st.execution_count):'…')+'</td></tr>';}).join('')
  ||'<tr><td colspan="4" class="tn-empty">No stories match “'+esc(q)+'”.</td></tr>';
 if(!storyCount&&!q)$('storyPickerBody').insertAdjacentHTML('beforeend','<tr><td colspan="4" class="tn-empty">This project has no stories yet. Add one on the <a href="#" data-goto-stories>Stories</a> tab.</td></tr>');
 $('storyPickerCount').textContent=rows.length>LIMIT?'Showing '+LIMIT+' of '+rows.length+' · refine your search':storyCount+' '+(storyCount===1?'story':'stories');
}
function setupStoryPicker(){
 const dialog=$('storyPicker');if(!dialog||dialog.dataset.ready)return;dialog.dataset.ready='1';
 $('storyBox').addEventListener('click',openStoryPicker);
 $('storyPickerSearch').addEventListener('input',renderStoryPicker);
 $('storyPickerSearch').addEventListener('keydown',e=>{if(e.key==='ArrowDown'){e.preventDefault();$('storyPickerBody').querySelector('[data-pick-story]')?.focus();}});
 const confirm=()=>{setStartStory(storyPicker.picked);dialog.close();$('storyBox').focus();};
 $('storyPickerSelect').addEventListener('click',confirm);
 dialog.addEventListener('click',e=>{
  if(e.target.closest('[data-close-picker]')||e.target===dialog){closeStoryPicker();return;}
  if(e.target.closest('[data-goto-stories]')){e.preventDefault();closeStoryPicker();show('stories');return;}
  const row=e.target.closest('[data-pick-story]');
  if(row){storyPicker.picked=row.dataset.pickStory;renderStoryPicker();$('storyPickerBody').querySelector('[data-pick-story="'+CSS.escape(storyPicker.picked)+'"]')?.focus();}
 });
 dialog.addEventListener('dblclick',e=>{const row=e.target.closest('[data-pick-story]');if(row){storyPicker.picked=row.dataset.pickStory;confirm();}});
 dialog.addEventListener('keydown',e=>{
  const row=e.target.closest?.('[data-pick-story]');if(!row)return;
  if(e.key==='Enter'){e.preventDefault();storyPicker.picked=row.dataset.pickStory;confirm();}
  else if(e.key===' '){e.preventDefault();storyPicker.picked=row.dataset.pickStory;renderStoryPicker();$('storyPickerBody').querySelector('[data-pick-story="'+CSS.escape(storyPicker.picked)+'"]')?.focus();}
  else if(e.key==='ArrowDown'){e.preventDefault();row.nextElementSibling?.focus();}
  else if(e.key==='ArrowUp'){e.preventDefault();(row.previousElementSibling||$('storyPickerSearch')).focus();}
 });
 dialog.addEventListener('close',()=>syncScopeChoice());
}
// The shared testing launcher reads these attributes: a story start or a whole-project start, plus the chosen environment.
function syncStartButton(){
 const button=$('startProjectTesting');if(!button)return;
 const storyId=$('startStory').value;
 button.removeAttribute('data-start-project');button.removeAttribute('data-start-story');
 if(storyId)button.setAttribute('data-start-story',storyId);else button.setAttribute('data-start-project',state.projectId||'');
 button.dataset.environmentId=$('startEnvironment').value||'';
}
async function fetchDirectory(){
 try{const r=await api('/api/projects/'+encodeURIComponent(requireProject())+'/user-directory');state.users=r.users||[];renderTeam();}catch{state.users=null;renderTeam();}
}
let taskOpenSerial=0;
// Task popup layout: the essentials first (details, start/retest, linked test cases); the rest folded under "More".
// Only moves the existing sections, so every task action keeps working as before.
function arrangeTaskPopup(){
 const drawer=$('taskDrawer'),body=drawer?.querySelector(':scope > .p-4');if(!body||body.dataset.arranged)return;
 body.dataset.arranged='1';
 const kids=[...body.children],linkedHead=kids.find(k=>k.tagName==='H3'&&/Linked test cases/i.test(k.textContent));
 const linkForm=$('testLinkForm'),keep=new Set([$('drawerInfo'),$('taskStartTest')?.parentElement]);
 if(linkedHead){let n=linkedHead.previousElementSibling?.classList.contains('tn-divider')?linkedHead.previousElementSibling:linkedHead;for(;n;n=n.nextElementSibling){keep.add(n);if(n===linkForm)break;}}
 // No "More" section: every part stays in order; Edit ends with one Cancel / Save bar.
 const bar=document.createElement('div');bar.className='tn-task-savebar';
 bar.innerHTML='<button type="button" class="btn btn-outline-secondary tn-btn" id="cancelTaskEdit">Cancel</button><button type="button" class="btn btn-primary tn-btn" id="saveTaskEdit">Save</button>';
 body.appendChild(bar);
 // "Retest this task" next to "Start test"; "retest with child tasks" stays under More.
 const retest=$('retestOne');if(retest)$('taskStartTest').parentElement.appendChild(retest);
 const eyebrow=drawer.querySelector('.tn-card-head .tn-eyebrow');if(eyebrow)eyebrow.remove();
 const close=$('closeTask');if(close){close.textContent='×';close.className='tn-dialog-close';close.setAttribute('aria-label','Close task');}
}
async function openTask(id,mode){
 // 👁 opens the task read-only; ✏ opens it with the edit controls. Reloading the same task (after a save) keeps its mode.
 {const dr=$('taskDrawer');mode=mode||(dr&&String(state.taskId)===String(id)&&dr.classList.contains('open')!==false&&dr.dataset.mode)||'view';if(dr){dr.classList.toggle('tn-task-viewonly',mode!=='edit');dr.dataset.mode=mode;}}
 arrangeTaskPopup();
 // Activity history starts folded each time a task opens (click its heading to show it).
 $('taskDrawer')?.classList.remove('tn-history-open');
 // View shows everything, so the More section is open; Edit keeps it folded.
 {const more=document.querySelector('#taskDrawer .tn-task-more');if(more)more.open=mode!=='edit';}
 const serial=++taskOpenSerial;
 const d=await api('/api/work-items/'+encodeURIComponent(id)+'/details');if(serial!==taskOpenSerial)return;state.taskId=id;state.taskRole=d.projectRole;const t=d.task;
 $('taskDrawer').classList.toggle('tn-task-failed',t.origin==='FAILED_TEST');
 const canReview=['PROJECT_MANAGER','QA'].includes(d.projectRole),isManager=d.projectRole==='PROJECT_MANAGER',isDeveloper=d.projectRole==='DEVELOPER';
 $('taskStartTest').disabled=!canReview;
 $('retestOne').disabled=!canReview;$('retestWithChildren').disabled=!canReview;
 $('subtaskForm').querySelectorAll('input,button').forEach(el=>el.disabled=!canReview);
 $('taskDrop').setAttribute('aria-disabled',String(d.projectRole==='VIEWER'));
 $('taskDrop').tabIndex=d.projectRole==='VIEWER'?-1:0;
 $('taskFiles').disabled=d.projectRole==='VIEWER';
 for(const btn of document.querySelectorAll('[data-task-action]'))btn.disabled=!(canReview||(btn.dataset.taskAction==='ETA'&&isDeveloper))||(btn.dataset.taskAction==='DELETE'&&!isManager);
 $('drawerTitle').textContent=t.title;
 $('drawerInfo').innerHTML='<div class="tn-kv"><span>Task no.</span><span>'+taskNo(t.task_number)+'</span></div>'+'<div class="tn-kv"><span>Parent task</span><span>'+(d.parent?'<button class="tn-link" data-task="'+esc(d.parent.id)+'">'+taskNo(d.parent.task_number)+' · '+esc(d.parent.title)+'</button>':'—')+'</span></div>'+'<div class="tn-kv"><span>Story</span><span>'+(d.story?'<button class="tn-link" data-story="'+esc(d.story.id)+'">'+esc(d.story.reference_no+' · '+d.story.title)+'</button>'+(d.story.story_points?' <span class="tn-points">'+Number(d.story.story_points)+' pts</span>':''):'—')+'</span></div>'+'<div class="tn-kv"><span>Type / Priority</span><span>'+esc(workTypeLabel(t.work_type))+' / '+priorityTag(t.priority)+'</span></div>'+(['FAILED_TEST','CODE_FINDING'].includes(t.origin)?'<div class="tn-kv"><span>Team / Role</span><span>'+display((state.tasks||[]).find(x=>x.id===t.id)?.team_name)+(t.assigned_role?' · '+esc(ROLE_NAMES[t.assigned_role]||t.assigned_role):'')+(t.assigned_by_system?' <span class="tn-muted">(assigned by system)</span>':'')+'</span></div>':'')+'<div class="tn-kv"><span>Assigned to</span><span>'+display((state.tasks||[]).find(x=>x.id===t.id)?.assigned_to_name)+(t.assigned_role?' · '+esc(ROLE_NAMES[t.assigned_role]||t.assigned_role):'')+'</span></div><div class="tn-kv"><span>Status</span><span>'+statusTag(t.status)+'</span></div><div class="tn-kv"><span>Start date</span><span>'+(t.start_at?date(t.start_at):'—')+'</span></div><div class="tn-kv"><span>Due date</span><span>'+(t.due_at?date(t.due_at):'—')+'</span></div><div class="tn-kv"><span>Story points</span><span>'+(t.story_points?Number(t.story_points)+' pts':'—')+'</span></div><div class="tn-kv tn-task-viewrow"><span>Progress</span><span>'+Number(t.progress_percent||0)+'%'+(t.time_spent_minutes?' · time spent '+esc(hoursText(t.time_spent_minutes)):'')+'</span></div>'+(t.closed_at?'<div class="tn-kv"><span>Closed</span><span>'+dateTime(t.closed_at)+(t.closed_by_name?' · by '+esc(t.closed_by_name):'')+'</span></div>':'')+'<div id="taskFailureBox"></div>'+(t.origin==='CODE_FINDING'?'':'<p class="tn-info mt-3">'+display(t.description)+'</p>')+'<div class="tn-task-edit"><div class="tn-edit-grid"><div class="tn-edit-field tn-edit-full"><label class="form-label" for="taskAssignee">Assigned to</label><input id="taskAssignee" class="form-control" placeholder="Search by name or role"></div><div class="tn-edit-field"><label class="form-label" for="taskParentSearch">Parent task (optional)</label><input id="taskParentSearch" class="form-control" placeholder="Search by task number or title"></div><div class="tn-edit-field"><label class="form-label" for="taskStorySearch">Story (optional)</label><input id="taskStorySearch" class="form-control" placeholder="Search by story number or title"><div class="tn-muted tn-edit-hint" id="taskStoryPoints">'+(d.story?.story_points?'Story points: '+Number(d.story.story_points):'')+'</div></div><div class="tn-edit-field tn-edit-third"><label class="form-label" for="taskStatusChange">Status</label><select id="taskStatusChange" class="form-select">'+['PENDING','IN_PROGRESS','ON_HOLD','READY_FOR_RETEST','COMPLETED','CANCELLED'].map(v=>'<option value="'+v+'"'+(v===t.status?' selected':'')+'>'+(TASK_STATUS_LABELS[v]||v)+'</option>').join('')+'</select></div><div class="tn-edit-field tn-edit-third"><label class="form-label" for="taskStartDate">Start date</label><input id="taskStartDate" type="date" class="form-control" value="'+(t.start_at?new Date(new Date(t.start_at).getTime()-new Date(t.start_at).getTimezoneOffset()*60000).toISOString().slice(0,10):'')+'"></div><div class="tn-edit-field tn-edit-third"><label class="form-label" for="taskDueDate">Due date</label><input id="taskDueDate" type="date" class="form-control" value="'+(t.due_at?new Date(new Date(t.due_at).getTime()-new Date(t.due_at).getTimezoneOffset()*60000).toISOString().slice(0,10):'')+'"></div><div class="tn-edit-field tn-edit-third"><label class="form-label" for="taskPoints">Story points</label><input id="taskPoints" class="form-control" type="text" inputmode="numeric" maxlength="2" placeholder="Add story points" value="'+(t.story_points?Number(t.story_points):'')+'"></div><div class="tn-edit-field tn-edit-third"><label class="form-label" for="taskProgress">Progress</label><select id="taskProgress" class="form-select">'+[0,10,20,30,40,50,60,70,80,90,100].map(v=>'<option value="'+v+'"'+(v===Math.round(Number(t.progress_percent||0)/10)*10?' selected':'')+'>'+v+'%</option>').join('')+'</select></div><div class="tn-edit-field tn-edit-third"><label class="form-label" for="taskAddHours">Add hours</label><input id="taskAddHours" class="form-control" type="number" min="0" max="24" step="0.25" placeholder="e.g. 1.5"><div class="tn-muted tn-edit-hint" id="taskTimeSpent">Time spent: '+esc(hoursText(t.time_spent_minutes))+'</div></div><div class="tn-edit-field tn-edit-full"><label class="form-label" for="taskEditComment">Comment</label><textarea id="taskEditComment" class="form-control" rows="3" placeholder="What was done, or what is next (optional)"></textarea></div></div></div>'+((t.deferred_until)?'<p class="tn-muted mt-2">Deferred until '+dateTime(t.deferred_until)+' · '+esc(t.deferred_reason||'')+'</p>':'');
 if($('saveTaskEdit'))Object.assign($('saveTaskEdit').dataset,{origAssignee:t.assigned_to||'',origStatus:t.status,origProgress:String(Math.round(Number(t.progress_percent||0)/10)*10),origParent:t.parent_work_item_id||'',origStory:t.story_id||'',origDue:$('taskDueDate')?.value||'',origStart:$('taskStartDate')?.value||'',origPoints:t.story_points?String(t.story_points):''});
 if($('taskAssignee'))$('taskAssignee').disabled=d.projectRole!=='PROJECT_MANAGER';
 {const all=state.tasks||[],kids=new Set([t.id]);let grew=true;while(grew){grew=false;for(const x of all)if(x.parent_work_item_id&&kids.has(x.parent_work_item_id)&&!kids.has(x.id)){kids.add(x.id);grew=true;}}
  state.parentChoices=all.filter(x=>!x.deleted_at&&x.task_number&&!kids.has(x.id)).sort((a,b)=>a.task_number-b.task_number).map(x=>({id:x.id,label:taskNo(x.task_number)+' · '+x.title}));
  state.storyChoices=(state.context?.stories||[]).map(x=>({id:x.id,label:(x.reference_no?x.reference_no+' · ':'')+x.title}));
  state.assigneeChoices=(state.context?.members||[]).filter(m=>m.project_role&&m.project_role!=='VIEWER').map(m=>({id:m.user_id,label:m.display_name+' · '+(ROLE_NAMES[m.project_role]||m.project_role)}));
  window.TNPick.attach($('taskAssignee'),state.assigneeChoices,{value:t.assigned_to||''});
  window.TNPick.attach($('taskParentSearch'),state.parentChoices,{value:t.parent_work_item_id||''});
  window.TNPick.attach($('taskStorySearch'),state.storyChoices,{value:t.story_id||''});
  const canLink=['PROJECT_MANAGER','QA'].includes(d.projectRole);['taskParentSearch','taskStorySearch'].forEach(x=>{if($(x))$(x).disabled=!canLink;});}
 {const canProgress=['PROJECT_MANAGER','QA'].includes(d.projectRole)||String(t.assigned_to||'')===String(state.user?.id||state.user?.sub||'');['taskProgress','taskAddHours'].forEach(x=>{if($(x))$(x).disabled=!canProgress;});}
 loadTaskFailure(t).catch(err=>{if($('taskFailureBox'))$('taskFailureBox').innerHTML='<p class="tn-muted">Failure details are not available: '+esc(err.message)+'</p>';});
 if(t.origin==='CODE_FINDING')loadTaskCodeProblem(t).catch(err=>{if($('taskFailureBox'))$('taskFailureBox').innerHTML='<p class="tn-muted">Code problem details are not available: '+esc(err.message)+'</p>';});
 $('linkSession').value=t.session_id||'';$('linkCase').value=t.external_case_id||'';
 let availableCases=[];try{availableCases=(await api('/api/projects/'+encodeURIComponent(requireProject())+'/test-cases')).cases||[];}catch(err){console.warn('Case catalog unavailable:',err.message);}
 const choices=[...new Set([t.session_id,...availableCases.map(x=>x.session_id)].filter(Boolean))];
 $('sessionChoices').innerHTML=choices.map(v=>'<option value="'+esc(v)+'"></option>').join('');
 function populateCases(){const sid=$('linkSession').value;const filtered=availableCases.filter(x=>x.session_id===sid);$('caseChoices').innerHTML=filtered.map(x=>'<option value="'+esc(x.external_case_id)+'" label="'+esc(x.title||x.external_case_id)+'"></option>').join('');}
 $('linkSession').oninput=populateCases;populateCases();
 const canLink=['PROJECT_MANAGER','QA'].includes(d.projectRole);$('testLinkForm').querySelectorAll('input,button').forEach(el=>el.disabled=!canLink);await loadTaskLinks(id);
 if($('saveTaskEdit'))$('saveTaskEdit').disabled=d.projectRole==='VIEWER';if(isDeveloper){const complete=$('taskStatusChange').querySelector('option[value="COMPLETED"]');if(complete)complete.disabled=true;}
 $('taskEta').value=t.eta_at?new Date(t.eta_at).toISOString().slice(0,16):'';
 $('taskDeferDate').value=t.deferred_until?new Date(t.deferred_until).toISOString().slice(0,16):'';
 $('taskReason').value='';
 // Subtasks: a table like the other lists (only shown when the task has subtasks).
 $('taskDrawer').classList.toggle('tn-no-subtasks',!d.subtasks.length);
 $('taskDrawer').classList.toggle('tn-no-attachments',!d.attachments.length);
 $('drawerSubtasks').innerHTML=d.subtasks.length?'<div class="tn-scroll"><table class="table tn-table tn-subtask-table"><thead><tr><th>Task no.</th><th>Subtask</th><th>Assigned to</th><th>Status</th><th>Progress</th><th>Created</th><th>Last updated</th></tr></thead><tbody>'+d.subtasks.map(x=>'<tr><td><span class="tn-task-no">'+taskNo(x.task_number)+'</span></td><td><button class="tn-link" data-task="'+esc(x.id)+'">'+esc(x.title)+'</button></td><td>'+(x.assigned_to_name?'<strong>'+esc(x.assigned_to_name)+'</strong>'+(x.assigned_role?'<div class="tn-muted">'+esc(ROLE_NAMES[x.assigned_role]||x.assigned_role)+'</div>':''):'<span class="tn-muted">Not assigned</span>')+'</td><td>'+statusTag(x.status)+'</td><td>'+Number(x.progress_percent||0)+'%'+(x.time_spent_minutes?'<div class="tn-muted">'+esc(hoursText(x.time_spent_minutes))+'</div>':'')+'</td>'+createdCell(x.created_by_name,x.created_at)+updatedCell(x.updated_by_name,x.updated_at,x.created_by_name,x.created_at)+'</tr>').join('')+'</tbody></table></div>':'';
 $('drawerAttachments').innerHTML=d.attachments.map(x=>'<div class="tn-kv"><span>'+date(x.created_at)+'</span><button class="tn-link" data-task-file="'+esc(x.id)+'">'+esc(x.filename)+'</button></div>').join('')||'<p class="tn-muted">No attachments yet.</p>';
 $('drawerComments').innerHTML=d.comments.map(x=>'<div class="tn-comment"><strong>'+esc(x.user_name||'User')+'</strong> <span class="tn-muted">'+dateTime(x.created_at)+'</span><p>'+esc(x.comment)+'</p></div>').join('')||'<p class="tn-muted mt-2">No comments.</p>';
 // Failed-test tasks show their runs, screenshots, video and reports through the Failure section's button, so these two lists are only for other tasks.
 // Code-problem tasks have no test runs either: their scan places are shown in the Code problem section instead.
 const failedTask=t.origin==='FAILED_TEST'||t.origin==='CODE_FINDING';
 const history=failedTask?{results:[]}:await api('/api/projects/'+encodeURIComponent(requireProject())+'/task-test-history?taskId='+encodeURIComponent(id));if(serial!==taskOpenSerial)return;
 if(!failedTask)$('drawerInfo').insertAdjacentHTML('beforeend','<h3 class="mt-3">Task test history</h3>'+(history.results.length?history.results.map(r=>'<div class="tn-sub">Run #'+esc(r.run_number)+' · '+esc(r.tester||'Unknown tester')+' · '+dateTime(r.completed_at)+' · '+(r.passed?'Passed':'Failed')+'<div>'+evidenceButtons(r.evidence_json)+'</div></div>').join(''):'<p class="tn-muted">No linked execution history yet.</p>'));
 // Activity history in plain words, one line each (comments too). Only the latest AI line is kept, so repeated AI checks do not fill the list.
 {const labels={WORK_ITEM_CREATED:'Task created',WORKFLOW_FAILED_TEST:'Created from failed test',TEST_FAILED_AGAIN:'Failed again',TEST_PASSED:'Passed',AI_ROUTED:'AI check',AI_ANALYSED:'AI check',ROUTING_CHANGED:'Team or type changed',PROGRESS_UPDATED:'Progress',COMMENT_ADDED:'Comment',STATUS_CHANGED:'Status changed',WORK_ITEM_ASSIGNED:'Assigned',ASSIGNED:'Assigned',SUBTASK_CREATED:'Subtask added',VERIFIED_RETEST_PASSED:'Closed after passing retest',CODE_TASK_CREATED:'Created from code scan',CODE_DECISION:'Decision',CODE_REJECTED:'Rejected',AI_TASK_WRITTEN:'Written by AI',AI_TASK_CHECKED:'AI checked',CODE_STILL_FOUND:'Still found by scan',CODE_FIXED:'Fixed (checked by scan)',TASK_DELETE:'Deleted',TASK_RESTORE:'Restored',LINKS_CHANGED:'Details changed'};
  let aiSeen=false;const rows=d.history.filter(h=>{if(!/^AI_/.test(h.event_type))return true;if(aiSeen)return false;aiSeen=true;return true;});
  $('drawerHistory').innerHTML=rows.map(h=>'<div class="tn-activity"><strong>'+esc(labels[h.event_type]||titleCase(h.event_type))+'</strong> · '+dateTime(h.created_at)+(h.by_name?' · '+esc(h.by_name):' · System')+(h.comment?' — '+esc(h.comment):'')+'</div>').join('')||'No activity';}
 const related=state.evidence.filter(x=>String(x.session_id)===String(t.session_id)&&String(x.external_case_id)===String(t.external_case_id)).slice(0,2);
 if(related.length&&!failedTask)$('drawerInfo').insertAdjacentHTML('beforeend','<h3 class="mt-3">Run evidence</h3>'+related.map(x=>'<div class="tn-sub">'+(x.passed?'Passed':'Failed')+' · '+dateTime(x.completed_at)+'<div>'+evidenceButtons(x.evidence_json)+'</div></div>').join(''));
 $('taskShade').classList.add('open');$('taskDrawer').classList.add('open');$('taskDrawer').setAttribute('aria-hidden','false');$('closeTask').focus();
}
function closeTask(){taskOpenSerial++;$('taskDrawer').classList.remove('open');$('taskDrawer').setAttribute('aria-hidden','true');$('taskShade').classList.remove('open');state.taskId=null;if(lastTaskTrigger?.isConnected)lastTaskTrigger.focus();}
async function lifecycle(action){
 const id=state.taskId;if(!id)return;
 if(action==='DELETE'&&!await confirmDanger({title:'Delete task?',message:'Do you want to delete this task?',note:'It moves to deleted items and can be restored. It stays in the audit history.',confirmLabel:'Delete task'}))return;
 const body={action,comment:$('taskReason').value};
 if(action==='ETA')body.etaAt=$('taskEta').value?new Date($('taskEta').value).toISOString():null;
 if(action==='DEFER'){body.deferredUntil=$('taskDeferDate').value?new Date($('taskDeferDate').value).toISOString():null;body.reason=$('taskReason').value;}
 await api('/api/work-items/'+encodeURIComponent(id)+'/lifecycle',{method:'PATCH',body:JSON.stringify(body)});
 if(action==='DELETE')closeTask();
 await loadWorkspace();if(state.taskId)await openTask(id);
 notice('Task updated.','success');
}
async function changeTaskStatus(){
 const id=state.taskId;if(!id)return;
 await api('/api/work-items/'+encodeURIComponent(id)+'/status',{method:'PATCH',body:JSON.stringify({status:$('taskStatusChange').value,comment:$('taskReason').value})});
 await loadWorkspace();await openTask(id);notice('Task status saved.','success');
}
async function fileUpload(file,kind,category){
 if(file.size>5*1024*1024 || !file.size)throw Error(file.name+' must be between 1 byte and 5 MB.');
 const allowed=['pdf','doc','docx','xls','xlsx','pptx','png','jpg','jpeg','webp','txt','csv','zip'];
 const ext=(file.name.split('.').pop()||'').toLowerCase();
 if(!allowed.includes(ext))throw Error('Unsupported file type: '+file.name);
 const mime={'pdf':'application/pdf','doc':'application/msword','docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','xls':'application/vnd.ms-excel','xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation','png':'image/png','jpg':'image/jpeg','jpeg':'image/jpeg','webp':'image/webp','txt':'text/plain','csv':'text/csv','zip':'application/zip'}[ext];
 const data=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<data.length;i+=32768)binary+=String.fromCharCode.apply(null,data.subarray(i,i+32768));
 const body={filename:file.name,mimeType:mime,base64:btoa(binary)};
 if(kind==='project'){body.category=category||'OTHER';}
 const path=kind==='project'?'/api/projects/'+encodeURIComponent(requireProject())+'/documents':'/api/work-items/'+encodeURIComponent(state.taskId)+'/attachments';
 await api(path,{method:'POST',body:JSON.stringify(body)});
}
async function uploadMany(files,kind,category){
 if(!files.length)return true;
 try{
  if(kind==='task'&&!state.taskId)throw Error('Open a task first.');
  for(const file of files)await fileUpload(file,kind,category);
  await loadWorkspace();
  if(kind==='task'&&state.taskId)await openTask(state.taskId);
  notice(files.length+' file(s) uploaded'+(kind==='project'&&category?' as '+(DOC_CATEGORIES[category]||category):'')+'.','success');
  return true;
 }catch(e){notice(e.message);return false;}
}
function dropZone(zoneId,inputId,kind){
 const zone=$(zoneId),input=$(inputId);
 zone.onclick=()=>{if(zone.getAttribute('aria-disabled')!=='true'&&!needsCategory())input.click();};zone.onkeydown=e=>{if((e.key==='Enter'||e.key===' ')&&zone.getAttribute('aria-disabled')!=='true'){e.preventDefault();if(!needsCategory())input.click();}};
 for(const event of ['dragenter','dragover'])zone.addEventListener(event,e=>{e.preventDefault();if(zone.getAttribute('aria-disabled')!=='true')zone.classList.add('drag');});
 for(const event of ['dragleave','drop'])zone.addEventListener(event,e=>{e.preventDefault();zone.classList.remove('drag');});
 const picker=()=>$('detailCategory');
 const category=()=>picker()?.value||'';
 // Project documents need a category chosen on purpose before uploading.
 const needsCategory=()=>{if(kind!=='project'||category())return false;notice('Choose a category before uploading documents.','warning');picker()?.focus();picker()?.classList.add('is-invalid');return true;};
 picker()?.addEventListener('change',()=>picker().classList.remove('is-invalid'));
 const done=ok=>{if(ok&&zoneId==='detailDrop')bootstrap.Modal.getInstance($('uploadDocsModal'))?.hide();};
 zone.addEventListener('drop',async e=>{if(zone.getAttribute('aria-disabled')!=='true'&&!needsCategory())done(await uploadMany([...e.dataTransfer.files],kind,category()));});
 input.onchange=async e=>{const files=[...e.target.files];input.value='';done(await uploadMany(files,kind,category()));};
}
let evidenceObjectUrl='';
async function previewEvidence(url){
 const r=await fetch(url,{headers:{Authorization:'Bearer '+token()}});
 if(!r.ok){
  // Old evidence lived only in server memory and is gone after a restart: say so clearly, where the user is looking.
  const msg=document.createElement('div');msg.className='tn-evidence-missing';
  msg.innerHTML='<strong>This screenshot is no longer available.</strong><span>It was taken before evidence was stored permanently, or the file was removed. Re-run the test to capture a new one.</span>';
  if($('runDialog')?.open){$('evidenceDialogBody').replaceChildren(msg);$('evidenceDialog').showModal();return;}
  $('evidencePreview').replaceChildren(msg);bootstrap.Modal.getOrCreateInstance($('evidenceModal')).show();return;
 }
 const blob=await r.blob();const view=$('evidencePreview');view.replaceChildren();
 if(evidenceObjectUrl)URL.revokeObjectURL(evidenceObjectUrl);
 evidenceObjectUrl=URL.createObjectURL(blob);
 const node=document.createElement(blob.type.startsWith('video/')?'video':'img');
 node.src=evidenceObjectUrl;node.style.maxWidth='100%';node.style.maxHeight='75vh';
 if(node.tagName==='VIDEO'){node.controls=true;node.preload='metadata';}
 // Opened from the run popup: show it in a popup stacked on top, so the run popup stays open underneath.
 if($('runDialog')?.open){const d=$('evidenceDialog');$('evidenceDialogBody').replaceChildren(node);d.showModal();return;}
 view.appendChild(node);bootstrap.Modal.getOrCreateInstance($('evidenceModal')).show();
}
document.addEventListener('click',e=>{const d=$('evidenceDialog');if(d?.open&&(e.target.closest('[data-close-evidence]')||e.target===d))d.close();});
// Attachment preview: images, PDF and text open in the popup; other files offer Download.
let docPreviewUrl='';
async function previewDocument(id){
 const d=(state.context?.documents||[]).find(x=>String(x.id)===String(id));if(!d)return;
 const url='/api/projects/'+encodeURIComponent(requireProject())+'/documents/'+encodeURIComponent(id)+'/download';
 $('docPreviewTitle').textContent=d.filename;
 $('docPreviewMeta').textContent=[(DOC_CATEGORIES[String(d.category||'').toUpperCase()]||d.category||''),Math.ceil(d.file_size/1024)+' KB',d.uploaded_by_name?'Uploaded by '+d.uploaded_by_name:''].filter(Boolean).join(' · ');
 $('docPreviewDownload').onclick=()=>download(url).catch(err=>notice(err.message));
 const body=$('docPreviewBody');body.innerHTML='<div class="tn-muted">Loading preview…</div>';
 $('docPreviewDialog').showModal();
 const r=await fetch(url,{headers:{Authorization:'Bearer '+token()}});
 if(!r.ok){body.innerHTML='<div class="tn-evidence-missing"><strong>This document is no longer available.</strong><span>The file may have been removed from storage.</span></div>';return;}
 const blob=await r.blob(),name=d.filename.toLowerCase(),type=blob.type||'';
 if(docPreviewUrl)URL.revokeObjectURL(docPreviewUrl);docPreviewUrl=URL.createObjectURL(blob);
 if(/^image\//.test(type)||/\.(png|jpe?g|webp|gif)$/.test(name)){const img=new Image();img.src=docPreviewUrl;img.alt=d.filename;body.replaceChildren(img);}
 else if(type==='application/pdf'||name.endsWith('.pdf')){const f=document.createElement('iframe');f.className='tn-doc-frame';f.title=d.filename;f.src=URL.createObjectURL(new Blob([blob],{type:'application/pdf'}));body.replaceChildren(f);}
 else if(/^text\//.test(type)||/\.(txt|csv|md|json|log)$/.test(name)){const pre=document.createElement('pre');pre.className='tn-doc-text';pre.textContent=(await blob.text()).slice(0,200000);body.replaceChildren(pre);}
 else body.innerHTML='<div class="tn-evidence-missing"><strong>Preview is not available for this file type.</strong><span>Word, Excel, PowerPoint and ZIP files open on your computer. Use Download.</span></div>';
}
document.addEventListener('click',e=>{const d=$('docPreviewDialog');if(d?.open&&(e.target.closest('[data-close-doc]')||e.target===d))d.close();});
async function download(url){
 const r=await fetch(url,{headers:{Authorization:'Bearer '+token()}});if(!r.ok)throw Error('Evidence or attachment is no longer available ('+r.status+').');
 const blob=await r.blob(),href=URL.createObjectURL(blob),link=document.createElement('a');
 link.href=href;link.target='_blank';link.rel='noopener';link.download='';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(href),60000);
}
async function runProjectTests(){
 const button=$('projectRunAll');button.disabled=true;
 try{
  const plan=await api('/api/projects/'+encodeURIComponent(requireProject())+'/project-test-plan',{method:'POST',body:'{}'});
  const out=$('retestOutput');out.replaceChildren();
  if(plan.blocked?.length){const warning=document.createElement('div');warning.className='tn-note mb-2';warning.textContent=plan.blocked.length+' session(s) excluded because they have not been reviewed or cannot be restored.';out.appendChild(warning);}
  if(!plan.groups.length){notice('No project test sessions are ready. Generate and review test cases in Test Studio first.','warning');return;}
  const count=plan.groups.reduce((n,g)=>n+g.caseIds.length,0);
  if(!confirm('Execute '+count+' approved test case(s) across '+plan.groups.length+' session(s)?'))return;
  for(const group of plan.groups){
   const p=document.createElement('div');p.className='tn-card p-3 my-2';out.appendChild(p);p.textContent='Starting '+group.caseIds.length+' approved tests in '+group.sessionId;
   const run=await api('/api/test-runs/start',{method:'POST',body:JSON.stringify({sessionId:group.sessionId,approvedIds:group.caseIds})});p.textContent='Run #'+run.runNumber+' started for '+group.caseIds.length+' approved tests';
   let completed=false;
   for(let i=0;i<120;i++){await new Promise(resolve=>setTimeout(resolve,2500));const progress=await api('/api/test-runs/progress/'+encodeURIComponent(group.sessionId));p.textContent='Run #'+run.runNumber+' · '+(progress.progress?.completed||0)+'/'+(progress.progress?.total||group.caseIds.length)+' complete';if(progress.progress?.complete){completed=true;break;}}
   if(!completed){p.textContent+=' · Still running. Check Test Studio before starting another session.';break;}
  }
  await loadWorkspace();
 }finally{button.disabled=!(state.context?.projectRole==='PROJECT_MANAGER'||state.context?.projectRole==='QA');}
}
async function retest(taskIds,includeChildren=false){
 const d=await api('/api/projects/'+encodeURIComponent(requireProject())+'/retest-plan',{method:'POST',body:JSON.stringify({taskIds,includeChildren})});
 const box=$('retestOutput');box.replaceChildren();
 if(d.blocked.length){const p=document.createElement('div');p.className='tn-note mb-2';p.textContent=d.blocked.length+' task(s) cannot run yet: '+d.blocked.map(x=>x.reason).join('; ')+'. Open the existing runner to regenerate/review their cases.';box.appendChild(p);}
 if(!d.groups.length){notice('No selected task is linked to a currently approved, Automation Ready test case.','warning');return;}
 for(const group of d.groups){
 const p=document.createElement('div');p.className='tn-card p-3 my-2';p.textContent='Retest '+group.caseIds.join(', ')+' in session '+group.sessionId+' — starting with existing isolated execution.';
 box.appendChild(p);
 const result=await api('/api/test-runs/start',{method:'POST',body:JSON.stringify({sessionId:group.sessionId,approvedIds:group.caseIds})});
 p.textContent='Run #'+result.runNumber+' started: '+group.caseIds.join(', ')+' · Screenshots/video captured by existing runner when configured.';
 let finished=false;
 for(let retry=0;retry<120;retry++){
 await new Promise(resolve=>setTimeout(resolve,2500));
 const prog=await api('/api/test-runs/progress/'+encodeURIComponent(group.sessionId));
 p.textContent='Run #'+result.runNumber+' · '+(prog.progress?.completed||0)+'/'+(prog.progress?.total||group.caseIds.length)+' complete · '+(prog.progress?.status||prog.state);
 if(prog.progress?.complete){finished=true;break;}
 }
 if(!finished){p.textContent+=' · Still running. Open Run Tests to monitor.';break;}
 }
 await loadWorkspace();
}
let lastTaskTrigger=null;
function bind(){
 if($('inventoryRefresh'))$('inventoryRefresh').onclick=()=>loadInventory().catch(e=>notice(e.message));
 if($('teamCreateForm'))$('teamCreateForm').onsubmit=async e=>{e.preventDefault();try{await api('/api/teams',{method:'POST',body:JSON.stringify(formPayload(e.target))});e.target.reset();await loadTeams();notice('Team created.','success');}catch(err){notice(err.message);}};
 if($('projectTeamMembers'))$('projectTeamMembers').onclick=async e=>{const button=e.target.closest('[data-remove-team-member]');if(!button)return;if(!await confirmDanger({title:'Remove team member?',message:'Do you want to remove '+(nameFrom(button,'Remove member ')||'this member')+' from this team?',note:'They stay on the project; only their team membership is removed.',confirmLabel:'Remove'}))return;try{await api('/api/projects/'+encodeURIComponent(requireProject())+'/teams/'+encodeURIComponent(button.dataset.removeTeamMember)+'/members/'+encodeURIComponent(button.dataset.memberId),{method:'DELETE'});await loadTeams();notice('Team member removed.','success');}catch(err){notice(err.message);}};
 if($('teamMemberForm'))$('teamMemberForm').onsubmit=async e=>{e.preventDefault();try{const data=formPayload(e.target);await api('/api/teams/'+encodeURIComponent(data.teamId)+'/members',{method:'POST',body:JSON.stringify({userId:data.userId,projectId:requireProject()})});e.target.reset();await loadTeams();notice('Team member added.','success');}catch(err){notice(err.message);}};
 if($('teamAttachForm'))$('teamAttachForm').onsubmit=async e=>{e.preventDefault();try{await api('/api/projects/'+encodeURIComponent(requireProject())+'/teams',{method:'POST',body:JSON.stringify(formPayload(e.target))});await loadTeams();notice('Team attached.','success');}catch(err){notice(err.message);}};
 if($('projectTeams'))$('projectTeams').onclick=async e=>{const btn=e.target.closest('[data-detach-team]');if(!btn)return;if(!await confirmDanger({title:'Detach team?',message:'Do you want to detach '+(nameFrom(btn,'Detach team ')||'this team')+' from this project?',note:'The team itself is not deleted and can be attached again.',confirmLabel:'Detach'}))return;try{await api('/api/projects/'+encodeURIComponent(requireProject())+'/teams/'+encodeURIComponent(btn.dataset.detachTeam),{method:'DELETE'});await loadTeams();}catch(err){notice(err.message);}};

 $('testLinkForm').onsubmit=async e=>{e.preventDefault();try{const id=state.taskId;if(!id)throw Error('Open a task first.');await api('/api/work-items/'+encodeURIComponent(id)+'/test-links',{method:'POST',body:JSON.stringify(formPayload(e.target))});await loadTaskLinks(id);notice('Test case linked to task.','success');}catch(err){notice(err.message);}};
 $('drawerTestLinks').addEventListener('click',async e=>{const b=e.target.closest('[data-unlink-test]');if(!b)return;if(!await confirmDanger({title:'Unlink test case?',message:'Do you want to unlink '+(nameFrom(b,'Unlink case ')||'this test case')+' from this task?',note:'The test case is not deleted and can be linked again.',confirmLabel:'Unlink'}))return;try{const id=state.taskId;await api('/api/work-items/'+encodeURIComponent(id)+'/test-links/'+encodeURIComponent(b.dataset.unlinkTest),{method:'DELETE'});await loadTaskLinks(id);notice('Test case unlinked.','success');}catch(err){notice(err.message);}});

 document.addEventListener('keydown',e=>{if(!$('taskDrawer').classList.contains('open'))return;if(e.key==='Escape'){e.preventDefault();closeTask();}else if(e.key==='Tab'){const items=[...$('taskDrawer').querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]')].filter(x=>x.getClientRects().length);if(!items.length)return;const first=items[0],last=items[items.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
 document.querySelectorAll('[data-view]').forEach(el=>el.onclick=()=>show(el.dataset.view));
  $('projectDetailTabs').addEventListener('keydown',e=>{
   if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
   const tabs=[...$('projectDetailTabs').querySelectorAll('[role=tab]')];
   const position=tabs.indexOf(document.activeElement);
   if(position<0)return;
   e.preventDefault();
   const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(position+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
   show(tabs[next].dataset.view);
   tabs[next].focus();
  });
 document.querySelectorAll('[data-go]').forEach(el=>el.onclick=()=>{show(el.dataset.go);if(el.dataset.go==='stories')clearStory();});
 // Projects list: clicking anywhere on a row (except its buttons) opens the project.
 $('projectsBody').addEventListener('click',e=>{if(e.target.closest('a,button,input,select'))return;const row=e.target.closest('tr[data-href]');if(row)window.location.href=row.dataset.href;});
 if($('addScope'))$('addScope').onclick=()=>$('editProfile').click();
 $('projectPicker').onchange=async e=>{closeTask();state.projectId=e.target.value;localStorage.setItem('testnexus:currentProject',state.projectId);try{await loadWorkspace();show(state.projectId?'details':'projects');}catch(err){notice(err.message);}};
 $('environmentForm').onsubmit=async e=>{e.preventDefault();try{const vals=formPayload(e.target);await api('/api/projects/'+encodeURIComponent(requireProject())+'/environments',{method:'POST',body:JSON.stringify({...vals,isDefault:!!e.target.elements.namedItem('isDefault').checked})});e.target.reset();await loadWorkspace();notice('Environment saved.','success');}catch(err){notice(err.message);}};
 // Story type dropdown: tick to change, closes when clicking elsewhere.
 document.addEventListener('change',e=>{
  if(!e.target.closest('#storyTypePick'))return;
  // Ticking "Code Intelligence" ticks (or clears) all of its code checks.
  // Choosing Code Intelligence with nothing ticked ticks all of its checks.
  // Choosing Code Intelligence with nothing ticked ticks all of its checks.
  if(e.target.name==='storyKind'&&e.target.value==='CODE'&&!storyTypeChecks().some(c=>c.checked))for(const c of storyTypeChecks())c.checked=true;
  syncStoryType();
 });
 document.addEventListener('change',e=>{if(e.target.id==='storyTargetType')loadStoryTargets();if(e.target.id==='storyRepo'){const i=$('storyCodeBranch');i.dataset.wanted='';i.value='';i.dataset.value='';loadStoryTargets();}});
 document.addEventListener('click',e=>{const d=$('storyTypePick');if(d?.open&&!d.contains(e.target))d.open=false;});
 $('storyForm').onsubmit=async e=>{e.preventDefault();storyFormError('');try{await saveStory();bootstrap.Modal.getOrCreateInstance($('storyModal')).hide();}catch(err){storyFormError(err.message);}};
 document.addEventListener('click',e=>{if(e.target.closest('#storyCreate')){clearStory();openStoryModal();}});
 $('storyLaunch').onclick=async()=>{storyFormError('');try{await launchStory();}catch(err){storyFormError(err.message);}};
 $('workflowForm').onsubmit=async e=>{e.preventDefault();try{
 const f=e.target;await api('/api/projects/'+encodeURIComponent(requireProject())+'/workflow',{method:'PUT',body:JSON.stringify({autoCreateFailedTasks:f.elements.namedItem('autoCreateFailedTasks').checked,autoCloseVerifiedRetests:f.elements.namedItem('autoCloseVerifiedRetests').checked,defaultDeveloper:$('workflowDeveloper').value||null})});
 await loadWorkflow();notice('Project workflow configuration saved.','success');
 }catch(err){notice(err.message);}};
 if($('taskStatusFilter'))$('taskStatusFilter').onchange=async()=>{if($('taskStatusFilter').value==='DELETED'){try{state.deletedTasks=(await api('/api/projects/'+encodeURIComponent(requireProject())+'/deleted-tasks')).tasks||[];}catch(err){notice(err.message);state.deletedTasks=[];}}renderTasks();};
 $('evidenceModal').addEventListener('hidden.bs.modal',()=>{const v=$('evidencePreview');v.replaceChildren();if(evidenceObjectUrl)URL.revokeObjectURL(evidenceObjectUrl);evidenceObjectUrl='';});
 $('allTasks').onchange=e=>{document.querySelectorAll('.task-select').forEach(x=>x.checked=e.target.checked);updateTaskSelection();};
 $('tasksBody').addEventListener('change',e=>{if(e.target.matches('.task-select'))updateTaskSelection();});
 $('taskSearch').addEventListener('input',renderTasks);
 
 $('projectRunAll').onclick=async()=>{try{await runProjectTests();}catch(e){notice(e.message);}};
 $('batchRetest').onclick=async()=>{const ids=[...document.querySelectorAll('.task-select:checked')].map(x=>x.value);if(!ids.length){notice('Select one or more tasks to retest.','warning');return;}try{await retest(ids);}catch(e){notice(e.message);}};
 $('taskStartTest').onclick=()=>launchTaskTest().catch(e=>notice(e.message));
 $('taskShade').onclick=closeTask;$('closeTask').onclick=closeTask;
 $('taskDrawer').addEventListener('click',async e=>{const link=e.target.closest('[data-task]');if(link){try{await openTask(link.dataset.task);}catch(err){notice(err.message);}return;}
 const btn=e.target.closest('[data-task-action]');if(btn){try{await lifecycle(btn.dataset.taskAction);}catch(err){notice(err.message);}return;}
 if(e.target.id==='saveTaskStatus'){try{await changeTaskStatus();}catch(err){notice(err.message);}}
 });
 $('subtaskForm').onsubmit=async e=>{e.preventDefault();try{const id=state.taskId;await api('/api/work-items/'+encodeURIComponent(id)+'/subtasks',{method:'POST',body:JSON.stringify(formPayload(e.target))});e.target.reset();await openTask(id);notice('Subtask created.','success');}catch(err){notice(err.message);}};
 $('commentForm').onsubmit=async e=>{e.preventDefault();try{const id=state.taskId;await api('/api/work-items/'+encodeURIComponent(id)+'/comments',{method:'POST',body:JSON.stringify({comment:$('commentText').value})});e.target.reset();await openTask(id);notice('Comment added.','success');}catch(err){notice(err.message);}};
 $('retestOne').onclick=async()=>{try{await retest([state.taskId]);closeTask();show('tasks');}catch(e){notice(e.message);}};
 $('retestWithChildren').onclick=async()=>{try{await retest([state.taskId],true);closeTask();show('tasks');}catch(e){notice(e.message);}};
 $('memberForm').onsubmit=async e=>{e.preventDefault();try{const v=formPayload(e.target),project=v.projectId||requireProject(),role=v.projectRole||state.accountRoles?.[v.userId]||'QA';await api('/api/projects/'+encodeURIComponent(project)+'/members',{method:'POST',body:JSON.stringify({userId:v.userId,projectRole:role,teamId:v.teamId||null})});if(project===state.projectId)await loadTeams();bootstrap.Modal.getOrCreateInstance($('assignMemberModal')).hide();await loadWorkspace();notice(project===state.projectId?'Member added to the project.':'Member added to '+((state.projects||[]).find(p=>p.id===project)?.name||'the project')+'.','success');}catch(err){notice(err.message);}};
 if($('userForm'))$('userForm').onsubmit=async e=>{e.preventDefault();try{await api('/api/users',{method:'POST',body:JSON.stringify(formPayload(e.target))});e.target.reset();bootstrap.Modal.getOrCreateInstance($('newUserModal')).hide();await fetchDirectory();if(state.view==='users')await loadUsers();notice('User created.','success');}catch(err){notice(err.message);}};
 $('editProfile').onclick=()=>{
 const p=state.context?.project;if(!p)return;const f=$('profileForm');
 for(const [k,v] of Object.entries({name:p.name,referenceNo:p.reference_no,startDate:p.start_date?.slice(0,10),endDate:p.end_date?.slice(0,10),description:p.description,objectives:p.objectives,scopeIn:p.scope_in,scopeOut:p.scope_out,businessRules:p.business_rules,acceptanceCriteria:p.acceptance_criteria,targetUrl:p.target_url,technologyStack:p.technology_stack})){const el=f.elements.namedItem(k);if(el)el.value=v||'';}
 bootstrap.Modal.getOrCreateInstance($('profileModal')).show();
 };
 $('profileForm').onsubmit=async e=>{e.preventDefault();try{await api('/api/projects/'+encodeURIComponent(requireProject())+'/profile',{method:'PATCH',body:JSON.stringify(formPayload(e.target))});bootstrap.Modal.getOrCreateInstance($('profileModal')).hide();await loadWorkspace();notice('Project profile saved.','success');}catch(err){notice(err.message);}};

 dropZone('detailDrop','detailFiles','project');dropZone('taskDrop','taskFiles','task');
 document.body.addEventListener('click',async e=>{
 const removeMember=e.target.closest('[data-remove-project-member]');if(removeMember){if(!await confirmDanger({title:'Remove project member?',message:'Do you want to remove '+(nameFrom(removeMember,'Remove project member ')||'this member')+' from the project?',note:'They will lose access to this project. Their past work stays in the history.',confirmLabel:'Remove'}))return;try{await api('/api/projects/'+encodeURIComponent(requireProject())+'/members/'+encodeURIComponent(removeMember.dataset.removeProjectMember),{method:'DELETE'});await loadWorkspace();notice('Member removed.','success');}catch(err){notice(err.message);}return;}
 const editProject=e.target.closest('[data-edit-project]');if(editProject){
  try{await openProject(editProject.dataset.editProject);if($('editProfile').disabled)throw Error('Project manager permission required to edit this project.');$('editProfile').click();}catch(err){notice(err.message);}
  return;
 }
 const editTask=e.target.closest('[data-edit-task]');if(editTask){lastTaskTrigger=editTask;try{await openTask(editTask.dataset.editTask,'edit');}catch(err){notice(err.message);}return;}
 const deleteTask=e.target.closest('[data-delete-task]');if(deleteTask){
  if(!await confirmDanger({title:'Delete task?',message:'Do you want to delete '+(nameFrom(deleteTask,'Delete task ')||'this task')+'?',note:'It moves to deleted items and can be restored. Linked history is kept.',confirmLabel:'Delete task'}))return;
  try{await api('/api/work-items/'+encodeURIComponent(deleteTask.dataset.deleteTask)+'/lifecycle',{method:'PATCH',body:JSON.stringify({action:'DELETE',reason:'Deleted from task table'})});await loadWorkspace();notice('Task moved to deleted items.','success');}catch(err){notice(err.message);}
  return;
 }
 const st=e.target.closest('[data-story]');if(st){selectStory(st.dataset.story);return;}
 const t=e.target.closest('[data-task]');if(t){lastTaskTrigger=t;try{await openTask(t.dataset.task);}catch(err){notice(err.message);}return;}
 const pv=e.target.closest('[data-preview-doc]');if(pv){previewDocument(pv.dataset.previewDoc).catch(err=>notice(err.message));return;}
 const doc=e.target.closest('[data-doc]');if(doc){try{await download('/api/projects/'+encodeURIComponent(requireProject())+'/documents/'+encodeURIComponent(doc.dataset.doc)+'/download');}catch(err){notice(err.message);}return;}
 const file=e.target.closest('[data-task-file]');if(file){try{await download('/api/work-items/'+encodeURIComponent(state.taskId)+'/attachments/'+encodeURIComponent(file.dataset.taskFile)+'/download');}catch(err){notice(err.message);}return;}
 const evidence=e.target.closest('[data-evidence]');if(evidence){try{await previewEvidence(evidence.dataset.evidence);}catch(err){notice(err.message);}return;}
 const restore=e.target.closest('[data-restore]');if(restore){try{await api('/api/work-items/'+encodeURIComponent(restore.dataset.restore)+'/lifecycle',{method:'PATCH',body:JSON.stringify({action:'RESTORE'})});state.deletedTasks=(await api('/api/projects/'+encodeURIComponent(requireProject())+'/deleted-tasks')).tasks||[];renderTasks();notice('Task restored.','success');}catch(err){notice(err.message);}return;}
 const report=e.target.closest('[data-report]');if(report){openRunDialog(report.dataset.report,report.dataset.runNumber);}
 });
}
function enableSearchableSelects(){
 const setup=select=>{
  if(select.multiple||select.dataset.searchEnhanced==='true'||!['memberUser','newTaskAssignee','workflowDeveloper'].includes(select.id))return;
  select.dataset.searchEnhanced='true';
  const search=document.createElement('input');
  search.type='search';search.className='form-control form-control-sm tn-select-search mb-1';
  search.placeholder='Search options…';
  search.setAttribute('aria-label','Search '+(select.getAttribute('aria-label')||select.name||'options'));
  select.before(search);
  let original=[];let rendering=false;
  const snapshot=()=>{if(!rendering&&!search.value)original=[...select.options].map(o=>({value:o.value,text:o.textContent,disabled:o.disabled}));};
  snapshot();
  const observer=new MutationObserver(()=>snapshot());
  observer.observe(select,{childList:true,subtree:true,characterData:true});
  const restore=()=>{if(!search.value)return;search.value='';render('');};
  const render=q=>{
   const value=select.value;
   rendering=true;observer.disconnect();
   const items=original.filter(o=>!q||o.text.toLocaleLowerCase().includes(q.toLocaleLowerCase()));
   select.replaceChildren(...items.map(o=>new Option(o.text,o.value,false,o.value===value)));
   for(let i=0;i<items.length;i++)select.options[i].disabled=items[i].disabled;
   if(!items.some(o=>o.value===value))select.selectedIndex=-1;
   observer.observe(select,{childList:true,subtree:true,characterData:true});
   rendering=false;
  };
  search.addEventListener('input',()=>render(search.value.trim()));
  search.addEventListener('keydown',e=>{if(e.key==='Escape'){restore();select.focus();}else if(e.key==='ArrowDown'){e.preventDefault();select.focus();}});
  select.addEventListener('change',restore);
  select.addEventListener('focus',()=>{if(!search.value)snapshot();});
 };
 document.querySelectorAll('select:is(#memberUser,#newTaskAssignee,#workflowDeveloper)').forEach(setup);
 new MutationObserver(()=>document.querySelectorAll('select:is(#memberUser,#newTaskAssignee,#workflowDeveloper):not([data-search-enhanced])').forEach(setup)).observe(document.body,{childList:true,subtree:true});
}
async function initialize(){
 bind();enableSearchableSelects();try{
 if(!token()){location.replace('/login.html');return;}
 const me=await api('/api/auth/me');state.user=me.user;window.TestNexusProfileMenu?.mount('currentUser',me.user||{});
 await loadProjects();await fetchDirectory();clearStory();
 await routeFromUrl();
 }catch(e){if(/auth|token|unauthoriz|sign.in/i.test(e.message))location.replace('/login.html');else notice(e.message);}
}
window.addEventListener('popstate',()=>routeFromUrl().catch(e=>notice(e.message)));
// Add member popup: the project role comes from the user's account (DEV -> Developer, QA -> QA, MANAGER -> Project manager).
function accountProjectRole(u){
 if(u.project_role)return u.project_role;
 return {DEV:'DEVELOPER',QA:'QA',MANAGER:'PROJECT_MANAGER'}[String(u.role||'').toUpperCase()]||'QA';
}
function showMemberRole(){
 const el=$('memberRoleNote');if(!el)return;
 const r=state.accountRoles?.[$('memberUser')?.value];
 if(r&&$('memberRole'))$('memberRole').value=r;
 el.textContent=r?'From the user account: '+(ROLE_LABELS[r]||r):'';
}
document.addEventListener('change',e=>{if(e.target.id==='memberUser'){showMemberRole();pickMemberTeam();}if(e.target.id==='memberRole')pickMemberTeam();if(e.target.id==='memberProject')fillMemberTeams(e.target.value);});
// Add member popup: teams of the chosen project, from the DB.
async function fillMemberTeams(projectId){
 const sel=$('memberTeam');if(!sel)return;
 let teams=state.projectTeams||[];
 if(projectId&&projectId!==state.projectId){try{teams=(await api('/api/projects/'+encodeURIComponent(projectId)+'/project-teams')).teams||[];}catch{teams=[];}}
 sel.innerHTML=teams.map(t=>'<option value="'+esc(t.id)+'">'+esc(t.name)+'</option>').join('')||'<option value="">No teams in this project</option>';
 pickMemberTeam();
}
// Pre-select the team that matches the chosen user's role (can be changed).
const ROLE_TEAM={QA:'QA team',DEVELOPER:'Development team',PROJECT_MANAGER:'Project management',VIEWER:'Observers'};
function pickMemberTeam(){
 const sel=$('memberTeam');if(!sel)return;
 const want=(ROLE_TEAM[$('memberRole')?.value||state.accountRoles?.[$('memberUser')?.value]]||'').toLowerCase();
 const opt=[...sel.options].find(o=>o.text.toLowerCase()===want);if(opt)sel.value=opt.value;
}
// ---- Environments tab: same list as the old Environments page, inside the project ----
async function loadEnvironments(){
 const d=await api('/api/projects/'+encodeURIComponent(requireProject())+'/environments');
 state.environments=d.environments||[];state.envCanManage=!!d.canManage;
 renderEnvironments();
}
function renderEnvironments(){
 const list=state.environments||[],manage=state.envCanManage;
 $('envCount').textContent=list.length;
 $('envCreate').hidden=!manage;
 $('envRows').innerHTML=list.map(e=>{
  const name=e.name||'environment';
  const actions=actionIcon('eye','data-env-open="view" data-env-id="'+esc(e.id)+'"','View environment '+name)
   +(manage?actionIcon('edit','data-env-open="edit" data-env-id="'+esc(e.id)+'"','Edit environment '+name)
   +actionIcon(e.is_active?'pause':'play','data-env-toggle="'+esc(e.id)+'"',(e.is_active?'Disable':'Enable')+' environment '+name)
   +actionIcon('remove','data-env-open="delete" data-env-id="'+esc(e.id)+'"','Delete environment '+name):'');
  const updatedBy=e.updated_by_name||(Math.abs(new Date(e.updated_at)-new Date(e.created_at))<2000?e.created_by_name:'');
  return '<tr><td><strong>'+esc(name)+'</strong></td><td>'+esc(e.stage_type||'—')+'</td><td class="tn-env-url">'+esc(e.base_url||'—')+'</td><td><span class="tn-env-status'+(e.is_active?'':' off')+'">'+(e.is_active?'Active':'Disabled')+'</span></td><td>'+Number(e.usage?.total||0)+' reference(s)</td><td>'+(e.is_default?'Yes':'—')+'</td>'+createdCell(e.created_by_name,e.created_at)+updatedCell(updatedBy,e.updated_at||e.created_at)+'<td><span class="tn-icon-actions">'+actions+'</span></td></tr>';
 }).join('')||'<tr><td colspan="9" class="tn-empty">No environments yet.'+(manage?' Create the first one.':'')+'</td></tr>';
}
function envFormUrl(id,mode){
 const u=new URLSearchParams({projectId:state.projectId||''});if(id)u.set('id',id);if(mode&&mode!=='edit')u.set('mode',mode);
 return '/environment-form.html?'+u.toString();
}
document.addEventListener('click',async e=>{
 if(e.target.closest('#envCreate')){openCreatePopup(envFormUrl());return;}
 const open=e.target.closest('[data-env-open]');if(open){openCreatePopup(envFormUrl(open.dataset.envId,open.dataset.envOpen));return;}
 const t=e.target.closest('[data-env-toggle]');if(!t)return;
 const env=(state.environments||[]).find(x=>String(x.id)===String(t.dataset.envToggle));if(!env)return;
 const activate=!env.is_active;
 if(!await window.TestNexusConfirm({title:(activate?'Enable':'Disable')+' environment?',message:'Do you want to '+(activate?'enable':'disable')+' '+env.name+'?',note:activate?'It becomes available for new testing again.':'It will not be offered for new testing. Past runs are kept.',confirmLabel:activate?'Enable':'Disable'}))return;
 try{await api('/api/projects/'+encodeURIComponent(requireProject())+'/environments/'+encodeURIComponent(env.id),{method:'PATCH',body:JSON.stringify({isActive:activate,isDefault:false})});await loadEnvironments();notice('Environment '+(activate?'enabled':'disabled')+'.','success');}
 catch(err){notice(err.message);}
});
// The environment form (in the popup) reports back when it saved or deleted something.
window.addEventListener('message',async e=>{
 if(e.origin!==location.origin||e.data?.type!=='tn-env-form')return;
 $('createDialog').close();$('createFrame').src='about:blank';
 if(!e.data.changed)return;
 try{await loadEnvironments();await loadWorkspace();show('environments','none');if(e.data.message)notice(e.data.message,'success');}catch(err){notice(err.message);}
});
// ---- Run details page: the run's test cases with their up-to-date status ----
const runPage={data:null,shots:[],viewList:[],caseShots:[],shotIndex:0,urls:[]};
document.addEventListener('click',e=>{
 const open=e.target.closest('[data-open-run]');if(open){state.runId=open.dataset.openRun;show('run');return;}
 if(e.target.closest('#runPageBack')){show('executions');return;}
});
const caseTitle=t=>String(t||'').replace(/^Test execution\s+\S+\s+-\s+/i,'');
const secs=ms=>ms==null?'—':(Number(ms)/1000).toFixed(1)+' s';
function evidenceOf(r){const e=r.evidence_json?.evidence||r.evidence_json||{};const ok=u=>typeof u==='string'&&(u.startsWith('/api/artifacts/')||/^\/api\/projects\/[^/]+\/run-evidence\//.test(u));return {shot:ok(e.screenshotUrl)?e.screenshotUrl:'',video:ok(e.videoUrl)?e.videoUrl:''};}
async function loadRunPage(){
 if(!state.runId){show('executions','replace');return;}
 for(const u of runPage.urls)URL.revokeObjectURL(u);runPage.urls=[];
 $('runResultsBody').innerHTML='<tr><td colspan="10" class="tn-empty">Loading run…</td></tr>';
 const g=await api('/api/projects/'+encodeURIComponent(requireProject())+'/runs/'+encodeURIComponent(state.runId)+'/group');
 runPage.group=g;state.runId=g.run.id; // always the run itself (attempt 1)
 const run=g.run,project=state.context?.project||{};
 $('runPageTitle').textContent='Run #'+run.run_number;
 $('runPageMeta').textContent=[run.environment,'Times run: '+g.attempts.length].filter(Boolean).join(' · ');
 // breadcrumb: Projects › project › Runs & reports › Run #N
 $('breadcrumb').innerHTML='<a href="/workspace.html#projects">Projects</a><span aria-hidden="true">›</span><a href="'+esc(projectRoute(state.projectId,'details'))+'">'+esc(project.name||'Project')+'</a><span aria-hidden="true">›</span><a href="'+esc(projectRoute(state.projectId,'executions'))+'">Runs &amp; reports</a><span aria-hidden="true">›</span><span aria-current="page">Run #'+esc(run.run_number)+'</span>';
 renderRunResults();
}
const resultTag=passed=>'<span class="tn-result '+(passed?'pass':'fail')+'">'+(passed?'Passed':'Failed')+'</span>';
const attemptLabel=n=>'Attempt '+n;
// Test cases: latest result across all attempts.
function renderRunResults(){
 const g=runPage.group;$('runCasesCount').textContent=g.cases.length;
 $('runResultsBody').innerHTML=g.cases.map(r=>'<tr><td><span class="tn-case-id">'+esc(r.external_case_id||'—')+'</span> '+esc(caseTitle(r.title))+'</td><td data-sort="'+(/^ai/i.test(r.source||'')?'AI':'Manual')+'">'+sourceTag(r.source)+'</td><td>'+esc((x=>/^(ui|api)$/i.test(String(x||''))?String(x).toUpperCase():x?String(x).charAt(0).toUpperCase()+String(x).slice(1).toLowerCase():'—')(r.test_category))+'</td><td>'+esc((x=>x?String(x).charAt(0).toUpperCase()+String(x).slice(1).toLowerCase():'—')(r.scenario_type))+'</td><td>'+(r.priority?priorityTag(r.priority):'—')+'</td><td data-sort="'+(r.passed?1:0)+'">'+resultTag(r.passed)+(r.passed?'':taskChip(failureTaskFor(g.run?.session_id,r.external_case_id)))+'</td><td data-sort="'+Number(r.times_run||1)+'">'+Number(r.times_run||1)+'</td>'+createdCell(r.case_created_by_name,r.case_created_at)+updatedCell(r.latest_by_name,r.latest_completed_at,r.case_created_by_name,r.case_created_at)+'<td><span class="tn-icon-actions">'+actionIcon('eye','data-open-case="'+esc(r.external_case_id||'')+'"','Details and run history of '+(r.external_case_id||'this test case'))+(canRerun()?actionIcon('play','data-rerun-case="'+esc(r.external_case_id||'')+'"','Re-run '+(r.external_case_id||'this test case')):'')+'</span></td></tr>').join('')||'<tr><td colspan="10" class="tn-empty">No test cases were recorded for this run.</td></tr>';
}
// One attempt's results, for its PDF report (kept apart from the run page).
const reportRun={data:null,shots:[],runId:'',label:''};
async function loadRunData(runId,label=''){
 const d=await api('/api/projects/'+encodeURIComponent(requireProject())+'/runs/'+encodeURIComponent(runId)+'/details');
 reportRun.data=d;reportRun.runId=runId;reportRun.label=label||('Run #'+d.run.run_number);reportRun.shots=d.results.map(r=>({r,...evidenceOf(r)})).filter(x=>x.shot);
 return d;
}
async function authedUrl(url){const r=await fetch(url,{headers:{Authorization:'Bearer '+token()}});if(!r.ok)throw Error('missing');const u=URL.createObjectURL(await r.blob());runPage.urls.push(u);return u;}
// Short failure reason for tables: first line, without internal tags like [TN_ITEM=...] or "AssertionError:".
const failReason=m=>{const t=String(m||'').split('\n')[0].replace(/\[[A-Z_]+=[^\]]*\]/g,'').replace(/^\s*\w*Error:\s*/,'').replace(/\s+/g,' ').trim();return t.length>110?t.slice(0,110)+'…':t;};
// ---- Test case popup: Details (steps, test data, passing criteria) and Run history ----
function showCaseTab(name){for(const b of document.querySelectorAll('[data-case-tab]')){const on=b.dataset.caseTab===name;b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1;$('casePanel'+b.dataset.caseTab).hidden=!on;}}
const titleCase=v=>String(v||'').toLowerCase().replace(/_/g,' ').replace(/^./,c=>c.toUpperCase());
function stepText(st){
 if(typeof st==='string')return esc(st);
 const action=titleCase(st?.action||'Step'),target=st?.target?' <code>'+esc(st.target)+'</code>':'',value=st?.value!=null&&st.value!==''?' with <code>'+esc(String(st.value))+'</code>':'';
 return '<strong>'+esc(action)+'</strong>'+target+value;
}
async function openCase(caseId){
 const d=await api('/api/projects/'+encodeURIComponent(requireProject())+'/runs/'+encodeURIComponent(state.runId)+'/cases/'+encodeURIComponent(caseId));
 const tc=d.testCase,h=d.history,last=h[0];
 const title=caseTitle(tc?.title||last?.title||caseId);
 $('caseViewerTitle').innerHTML='<span class="tn-case-id">'+esc(caseId)+'</span> '+esc(title);
 $('caseViewerMeta').textContent=[tc?.source?(/^ai/i.test(tc.source)?'Created with AI':'Written manually'):'',tc?.category?titleCase(tc.category):'',tc?.type?titleCase(tc.type):'',tc?.priority?titleCase(tc.priority)+' priority':'',tc?.review?.status==='CONFIRMED'?'Approved'+(tc.review.confirmedAt?' on '+dateTime(tc.review.confirmedAt):''):tc?.review?.status?titleCase(tc.review.status):'',tc?.review?.revision?'Revision '+tc.review.revision:''].filter(Boolean).join(' · ');
 {const ft=failureTaskFor(runPage.group?.run?.session_id,caseId);if(ft)$('caseViewerMeta').insertAdjacentHTML('beforeend',' · '+taskChip(ft));}
 const list=(items,ordered)=>items.length?'<'+(ordered?'ol':'ul')+'>'+items.map(x=>'<li>'+(ordered?stepText(x):esc(typeof x==='string'?x:JSON.stringify(x)))+'</li>').join('')+'</'+(ordered?'ol':'ul')+'>':'<p class="tn-muted">Not recorded</p>';
 const data=tc?Object.entries(tc.testData||{}):[];
 runPage.caseShots=h.map(x=>({r:{...x,external_case_id:caseId,title:x.title||title},meta:(((runPage.group?.attempts||[]).find(a=>a.id===x.run_id))?attemptLabel((runPage.group.attempts.find(a=>a.id===x.run_id)).attempt):'Run #'+x.run_number)+' · '+(x.executed_by_name||'Not recorded')+' · '+dateTime(x.completed_at),...evidenceOf(x)})).filter(x=>x.shot||x.video);
 $('casePanelDetails').innerHTML='<div class="tn-case-status"><span>Status</span><div>'+(last?resultTag(last.passed):'—')+'</div><span>Last run by</span><div>'+esc(last?.executed_by_name||'Not recorded')+(last?' · '+dateTime(last.completed_at):'')+'</div><span>Times run</span><div>'+h.length+'</div></div>'
  +(tc?'<div class="tn-case-section"><h3>Preconditions</h3>'+list(tc.preconditions)+'</div>'
  +'<div class="tn-case-section"><h3>Test data</h3>'+(data.length?'<div class="tn-case-data">'+data.map(([k,v])=>'<code>'+esc(k)+': '+esc(typeof v==='string'?v:JSON.stringify(v))+'</code>').join('')+'</div>':'<p class="tn-muted">None</p>')+'</div>'
  +'<div class="tn-case-section"><h3>Steps</h3>'+list(tc.steps,true)+'</div>'
  +'<div class="tn-case-section tn-case-criteria"><h3>Passing criteria (expected result)</h3>'+list(tc.expectedResults)+'</div>'
  :'<p class="tn-muted">The test case details were not saved for this run.</p>');
 $('caseHistoryCount').textContent=h.length;
 $('caseHistoryBody').innerHTML=h.map(x=>{
  const i=runPage.caseShots.findIndex(s=>s.r.run_id===x.run_id);
  const why=!x.passed&&x.error_message?'<div class="tn-status-sub" title="'+esc(String(x.error_message).slice(0,600))+'">'+esc(failReason(x.error_message))+'</div>':'';
  const att=(runPage.group?.attempts||[]).find(a=>a.id===x.run_id);
  const name=att?attemptLabel(att.attempt):'Run #'+x.run_number,label=(runPage.group?'Run #'+runPage.group.run.run_number+' · ':'')+name,ev=i<0?null:runPage.caseShots[i];
  const pic=!ev?'<span class="tn-muted">Not available</span>':'<span class="tn-icon-actions">'+(ev.shot?actionIcon('image','data-case-shot="'+i+'"','Screenshot of '+name):'')+(ev.video?actionIcon('video','data-case-video="'+i+'"','Video of '+name):'')+'</span>';
  const reports='<span class="tn-icon-actions">'+actionIcon('report','data-run-report="'+esc(x.run_id)+'" data-report-label="'+esc(label)+'"','Report of '+name)+(att&&!att.has_ai_report?actionIcon('ai','aria-disabled="true" data-no-ai','No AI report was generated for '+name):actionIcon('ai','data-run-ai="'+esc(x.run_id)+'" data-report-label="'+esc(label)+'"','AI report of '+name))+'</span>';
  return '<tr><td data-sort="'+esc(x.completed_at||'')+'"><strong>'+esc(name)+'</strong></td><td>'+display(x.environment)+'</td><td>'+resultTag(x.passed)+why+'</td>'+createdCell(x.executed_by_name,x.completed_at)+'<td>'+pic+'</td><td>'+reports+'</td></tr>';
 }).join('')||'<tr><td colspan="6" class="tn-empty">This test case has not run yet.</td></tr>';
 showCaseTab('Details');
 if(!$('caseViewer').open)$('caseViewer').showModal();
}
document.addEventListener('click',e=>{
 const c=e.target.closest('[data-open-case]');if(c){openCase(c.dataset.openCase).catch(err=>notice(err.message));return;}
 const t=e.target.closest('[data-case-tab]');if(t){showCaseTab(t.dataset.caseTab);return;}
 const s=e.target.closest('[data-case-shot]');if(s){runPage.viewList=runPage.caseShots;openShot(Number(s.dataset.caseShot));return;}
 const cv=e.target.closest('[data-case-video]');if(cv){runPage.viewList=runPage.caseShots;openShot(Number(cv.dataset.caseVideo)).then(()=>$('shotViewerVideo')?.click());return;}
 const v=$('caseViewer');if(v?.open&&(e.target.closest('[data-close-case]')||e.target===v))v.close();
});
// Reports open in a new browser tab (full size). The tab is opened at once on the click, so the browser allows it;
// the report is put in it when ready. If the browser blocks new tabs, the report opens in the viewer popup instead.
function reportTab(){const w=window.open('','_blank');if(w){try{w.document.title='Preparing report…';w.document.body.innerHTML='<p style="font:15px system-ui,sans-serif;padding:32px;color:#475569">Preparing the report…</p>';}catch{}}return w;}
// AI report: opens in its own tab (scripts off, Download button at the top); falls back to the viewer popup.
const aiReport={blob:null,name:''};
async function viewAiReport(runId,label,tab=null){
 const r=await fetch('/api/projects/'+encodeURIComponent(requireProject())+'/runs/'+encodeURIComponent(runId)+'/ai-report',{headers:{Authorization:'Bearer '+token()}});
 if(!r.ok)throw Error('No AI report was generated for this run. Use "Generate AI Analysis Report" on the testing page after a run to create one.');
 const html=await r.text();
 aiReport.blob=new Blob([html],{type:'text/html'});aiReport.name='AI-report-'+String(label||'run').replace(/[^\w]+/g,'-')+'-'+String(state.context?.project?.reference_no||'project').replace(/[^\w-]+/g,'_')+'.html';
 if(tab&&!tab.closed){
  const data='data:text/html;charset=utf-8;base64,'+btoa(unescape(encodeURIComponent(html)));
  // Download sits at the top right of the report header (same place as in the AI explanation tab of a code finding).
  const bar='<a href="'+data+'" download="'+esc(aiReport.name)+'" style="display:inline-block;padding:8px 14px;border-radius:9px;background:#0f1f5c;color:#fff;font:600 13px system-ui,sans-serif;text-decoration:none;box-shadow:0 4px 14px rgba(15,23,42,.25)">Download</a>';
  const withHead=html.replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="script-src \'none\'"><title>'+esc('AI report · '+(label||''))+'</title>').replace('</head>','<style>#exportAnalysisExcel{display:none!important}</style></head>');
  // Older reports without the header actions area: keep the button at the top right, fixed.
  const page=withHead.includes('<div class="hero-actions">')?withHead.replace('<div class="hero-actions">','<div class="hero-actions">'+bar)
   :withHead.replace(/<body([^>]*)>/,'<body$1><div style="position:fixed;top:18px;right:18px;z-index:99">'+bar+'</div>');
  tab.location.href=URL.createObjectURL(new Blob([page],{type:'text/html'}));
  return;
 }
 $('pdfViewerTitle').textContent='AI report · '+(label||'');
 $('pdfViewerMeta').textContent=state.context?.project?.name||'';
 const f=document.createElement('iframe');f.title='AI report';f.setAttribute('sandbox','');f.srcdoc=html.replace('</head>','<style>#exportAnalysisExcel{display:none!important}</style></head>');$('pdfViewerBody').replaceChildren(f);
 $('pdfViewer').dataset.mode='ai';$('pdfViewerDownload').textContent='Download';$('pdfViewerDownload').disabled=false;
 if(!$('pdfViewer').open)$('pdfViewer').showModal();
}
function downloadAiReport(){const href=URL.createObjectURL(aiReport.blob),a=document.createElement('a');a.href=href;a.download=aiReport.name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(href),1000);}
// ---- Re-run: a whole run (Runs list ↻ / Re-run this run) or one case (case popup). ----
// Runs again in the original session with the existing runner, so the result is saved as a new run (Run #N+1)
// with its own screenshots and reports; earlier runs are never changed.
let rerunBusy=false;
// Re-run progress: the floating progress popup (same one as the testing page, run-progress.js).
function rerunProgress(title,done,total,result){
 if(!window.TNRunPopup)return;
 window.TNRunPopup.show({title,total,completed:done,passed:Number(result?.passed||0),failed:Number(result?.failed||0),finished:!!result,
  note:result?'Saved as a new attempt.':'You can keep working while the tests run.'});
}
async function rerun(runId,caseId='',runLabel=''){
 if(rerunBusy){notice('A re-run is already in progress. Wait for it to finish.','warning');return;}
 const plan=await api('/api/projects/'+encodeURIComponent(requireProject())+'/runs/'+encodeURIComponent(runId)+'/rerun-plan',{method:'POST',body:JSON.stringify(caseId?{caseId}:{})});
 const skipped=plan.blocked.map(x=>x.caseId+' ('+x.reason+')').join(', ');
 if(!plan.caseIds.length){notice('Nothing can be re-run'+(skipped?': '+skipped:'')+'. Review the test cases on the testing page first.','warning');return;}
 const n=plan.caseIds.length,shown=runLabel||('Run #'+plan.runNumber);
 if(!await confirmDanger({title:caseId?'Re-run '+caseId+'?':'Re-run '+shown+'?',message:'This runs '+(caseId?'this test case':n+' test case'+(n===1?'':'s'))+' again'+(plan.environment?' in '+plan.environment:'')+'. The result is saved as a new attempt of '+shown+'. Earlier attempts stay as they are.',note:skipped?'Skipped: '+skipped:'',confirmLabel:'Re-run',tone:'warning'}))return;
 rerunBusy=true;if($('caseViewer').open)$('caseViewer').close();
 try{
  const started=await api('/api/test-runs/start',{method:'POST',body:JSON.stringify({sessionId:plan.sessionId,approvedIds:plan.caseIds})});
  const label='The re-run of '+shown;
  if(started.runNumber)api('/api/projects/'+encodeURIComponent(requireProject())+'/runs/'+encodeURIComponent(runId)+'/rerun-link',{method:'POST',body:JSON.stringify({runNumber:started.runNumber,caseIds:plan.caseIds})}).catch(()=>{});
  rerunProgress(label+' is running',0,n);
  let done=false;
  for(let i=0;i<240&&!done;i++){
   await new Promise(r=>setTimeout(r,2500));
   const pr=await api('/api/test-runs/progress/'+encodeURIComponent(plan.sessionId));
   done=!!pr.progress?.complete;
   if(!done&&window.TNRunPopup)window.TNRunPopup.show({title:label+' is running',total:Number(pr.progress?.total||n),completed:Number(pr.progress?.completed||0),passed:Number(pr.progress?.passed||0),failed:Number(pr.progress?.failed||0)});
   else rerunProgress(label+(Number(pr.progress?.failed)?' completed with failures':' completed'),Number(pr.progress?.completed||n),Number(pr.progress?.total||n),pr.progress||{passed:0,failed:0});
  }
  if(!done){notice(label+' is still running. Refresh this page later to see its result.','warning');return;}
  await loadWorkspace();
  const fresh=(state.context?.runs||[]).find(r=>r.session_id===plan.sessionId&&String(r.run_number)===String(started.runNumber));
  if(!fresh)notice(label+' finished. It is saved as a new attempt.','success');
  if(state.view==='run'||document.getElementById('view-run')?.classList.contains('active'))loadRunPage().catch(()=>{});
 }finally{rerunBusy=false;}
}
document.addEventListener('click',e=>{
 const r=e.target.closest('[data-rerun-run]');if(r){rerun(r.dataset.rerunRun,'',r.dataset.runLabel).catch(err=>{rerunBusy=false;notice(err.message);});return;}
 const rc=e.target.closest('[data-rerun-case]');if(rc){rerun(state.runId,rc.dataset.rerunCase,runPage.group?'Run #'+runPage.group.run.run_number:'').catch(err=>{rerunBusy=false;notice(err.message);});return;}
});
// Runs list → Actions: report (PDF viewer with download) and AI report.
document.addEventListener('click',async e=>{
 const rep=e.target.closest('[data-run-report]');
 if(rep){const tab=reportTab();try{await loadRunData(rep.dataset.runReport,rep.dataset.reportLabel);if(tab&&!tab.closed){await buildRunPdf();tab.location.href=runPdf.url;}else await viewRunPdf();}catch(err){if(tab)tab.close();notice(err.message);}return;}
 const ai=e.target.closest('[data-run-ai]');
 if(ai){const tab=reportTab();viewAiReport(ai.dataset.runAi,ai.dataset.reportLabel,tab).catch(err=>{if(tab)tab.close();notice(err.message);});}
});
// Evidence viewer: large screenshot with Previous / Next (arrow keys), case details, download, video.
async function openShot(i){
 const shots=runPage.viewList||[];if(!shots.length)return;
 runPage.shotIndex=(i+shots.length)%shots.length;const x=shots[runPage.shotIndex],r=x.r;
 $('shotViewerTitle').textContent=(r.external_case_id||'')+' · '+caseTitle(r.title);
 $('shotViewerMeta').innerHTML='<span class="tn-result '+(r.passed?'pass':'fail')+'">'+(r.passed?'Passed':'Failed')+'</span> '+esc(x.meta||'');
 $('shotViewerCount').textContent=(runPage.shotIndex+1)+' of '+shots.length;
 $('shotPrev').hidden=$('shotNext').hidden=shots.length<2;
 $('shotViewerVideo').hidden=!x.video;$('shotViewerVideo').onclick=async()=>{try{const u=await authedUrl(x.video);const v=document.createElement('video');v.src=u;v.controls=true;v.autoplay=true;$('shotViewerBody').replaceChildren(v);}catch{notice('The video is no longer available.');}};
 $('shotViewerDownload').onclick=()=>download(x.shot).catch(err=>notice(err.message));
 const err=$('shotViewerError');err.hidden=r.passed||!r.error_message;err.textContent=r.error_message?String(r.error_message).slice(0,1500):'';
 const body=$('shotViewerBody');body.innerHTML='<span class="tn-muted">Loading…</span>';
 if($('caseViewer')?.open)$('caseViewer').classList.add('tn-hidden-behind');
 if(!$('shotViewer').open)$('shotViewer').showModal();
 if(!x.shot){body.innerHTML='';$('shotViewerVideo').click();return;}
 try{const u=x.url||await authedUrl(x.shot);x.url=u;const img=new Image();img.src=u;img.alt='Screenshot of '+(r.external_case_id||'');body.replaceChildren(img);}
 catch{body.innerHTML='<div class="tn-evidence-missing"><strong>This screenshot is no longer available.</strong><span>Re-run the test to capture a new one.</span></div>';}
}
document.addEventListener('click',e=>{
 const v=$('shotViewer');if(!v?.open)return;
 if(e.target.closest('[data-close-shot]')||e.target===v)v.close();
 else if(e.target.closest('#shotPrev'))openShot(runPage.shotIndex-1);
 else if(e.target.closest('#shotNext'))openShot(runPage.shotIndex+1);
});
document.addEventListener('keydown',e=>{if(!$('shotViewer')?.open)return;if(e.key==='ArrowLeft'){e.preventDefault();openShot(runPage.shotIndex-1);}if(e.key==='ArrowRight'){e.preventDefault();openShot(runPage.shotIndex+1);}});
// Report tab: an execution report built from the stored results (and the saved execution snapshot).
function runReportHtml(forPrint){
 const d=reportRun.data;if(!d)return '';const run=d.run,project=state.context?.project||{};
 const passed=Number(run.passed||0),failed=Number(run.failed||0),total=Number(run.total||passed+failed),rate=total?Math.round(passed/total*100):0;
 const row=(k,v)=>v?'<tr><th>'+esc(k)+'</th><td>'+esc(v)+'</td></tr>':'';
 const failedList=d.results.filter(r=>!r.passed);
 return '<div class="tn-report-doc">'
  +'<div class="tn-report-title"><div><div class="tn-report-eyebrow">Execution report</div><h3>'+esc(project.name||'Project')+' · '+esc(reportRun.label||('Run #'+run.run_number))+'</h3></div><span class="tn-result '+(failed?'fail':'pass')+'">'+(failed?'Failed':'Passed')+'</span></div>'
  +'<table class="tn-report-facts">'+row('Completed',dateTime(run.completed_at))+row('Environment',[run.environment,run.target_url].filter(Boolean).join(' · '))+row('Story',run.story_ref?run.story_ref+' · '+(run.story_title||''):'Whole project')+row('Executed by',run.executed_by_name||'')+row('Browser',run.browser||'')+row('Session',run.session_id||'')+'</table>'
  +'<div class="tn-report-stats"><div><b>'+total+'</b><span>Total</span></div><div class="ok"><b>'+passed+'</b><span>Passed</span></div><div class="bad"><b>'+failed+'</b><span>Failed</span></div><div><b>'+(total?rate+'%':'—')+'</b><span>Pass rate</span></div></div>'
  +'<h4>Results</h4><table class="tn-report-table"><thead><tr><th>ID</th><th>Test case</th><th>Category</th><th>Type</th><th>Priority</th><th>Result</th></tr></thead><tbody>'+d.results.map(r=>'<tr><td>'+esc(r.external_case_id||'')+'</td><td>'+esc(caseTitle(r.title))+'</td><td>'+esc((x=>/^(ui|api)$/i.test(String(x||''))?String(x).toUpperCase():x?String(x).charAt(0).toUpperCase()+String(x).slice(1).toLowerCase():'—')(r.test_category))+'</td><td>'+esc((x=>x?String(x).charAt(0).toUpperCase()+String(x).slice(1).toLowerCase():'—')(r.scenario_type))+'</td><td>'+esc(r.priority?String(r.priority).charAt(0).toUpperCase()+String(r.priority).slice(1):'—')+'</td><td class="'+(r.passed?'ok':'bad')+'">'+(r.passed?'Passed':'Failed')+'</td></tr>').join('')+'</tbody></table>'
  +(failedList.length?'<h4>Failures</h4>'+failedList.map(r=>{const x=reportRun.shots.find(s=>s.r===r);return '<div class="tn-report-failure"><div><strong>'+esc(r.external_case_id||'')+' · '+esc(caseTitle(r.title))+'</strong>'+(r.error_message?'<pre>'+esc(String(r.error_message).slice(0,2500))+'</pre>':'<p>No error message was recorded.</p>')+'</div>'+(x?.url?'<img src="'+x.url+'" alt="Screenshot of '+esc(r.external_case_id||'')+'">':'')+'</div>';}).join(''):'<h4>Failures</h4><p>No failures in this run.</p>')
  +'<p class="tn-report-foot">'+(d.report?'Saved execution record by '+esc(d.report.recorded_by_name||'the system')+' on '+esc(dateTime(d.report.created_at))+'.':'Built from the stored run results.')+' Generated by TestNexus on '+esc(dateTime(new Date()))+'.</p>'
  +'</div>';
}
// Report as a real PDF: built in the browser, shown in the PDF viewer popup (zoom, pages, print) and downloadable.
let html2pdfReady=null,runPdf={url:'',blob:null,runId:''};
function loadHtml2pdf(){
 if(window.html2pdf)return Promise.resolve();
 return html2pdfReady||(html2pdfReady=new Promise((ok,bad)=>{const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';s.onload=ok;s.onerror=()=>{html2pdfReady=null;bad(Error('The PDF tool could not be loaded. Check the internet connection and try again.'));};document.head.appendChild(s);}));
}
async function buildRunPdf(){
 if(runPdf.blob&&runPdf.runId===reportRun.runId)return runPdf.blob;
 await loadHtml2pdf();
 for(const x of reportRun.shots.filter(s=>!s.r.passed&&!s.url)){try{x.url=await authedUrl(x.shot);}catch{}}
 const box=document.createElement('div');box.className='tn-pdf-render';box.innerHTML=runReportHtml(true);box.firstElementChild.classList.add('tn-pdf');document.body.appendChild(box);
 try{
  const blob=await window.html2pdf().set({margin:[10,10,12,10],image:{type:'jpeg',quality:0.95},html2canvas:{scale:2,useCORS:true,backgroundColor:'#ffffff'},jsPDF:{unit:'mm',format:'a4',orientation:'portrait'},pagebreak:{mode:['css','legacy'],avoid:['.tn-report-failure','.tn-report-stats','tr']}}).from(box.firstElementChild).outputPdf('blob');
  if(runPdf.url)URL.revokeObjectURL(runPdf.url);
  runPdf={blob,url:URL.createObjectURL(blob),runId:reportRun.runId};
  return blob;
 }finally{box.remove();}
}
const runPdfName=()=>String(reportRun.label||('Run '+(reportRun.data?.run?.run_number||''))).replace(/[^\w]+/g,'-')+'-'+String(state.context?.project?.reference_no||'report').replace(/[^\w-]+/g,'_')+'.pdf';
async function viewRunPdf(){
 const run=reportRun.data?.run;if(!run)return;
 $('pdfViewerTitle').textContent='Execution report · '+(reportRun.label||'Run #'+run.run_number);
 $('pdfViewerMeta').textContent=[state.context?.project?.name,dateTime(run.completed_at)].filter(Boolean).join(' · ');
 $('pdfViewer').dataset.mode='pdf';$('pdfViewerDownload').textContent='Download PDF';$('pdfViewerDownload').disabled=true;$('pdfViewerBody').innerHTML='<span>Preparing the PDF…</span>';
 if(!$('pdfViewer').open)$('pdfViewer').showModal();
 try{await buildRunPdf();}catch(err){$('pdfViewerBody').innerHTML='<span>'+esc(err.message)+'</span>';return;}
 const f=document.createElement('iframe');f.title='Execution report PDF';f.src=runPdf.url;$('pdfViewerBody').replaceChildren(f);
 $('pdfViewerDownload').disabled=false;
}
async function downloadRunPdf(){
 await buildRunPdf();
 const a=document.createElement('a');a.href=runPdf.url;a.download=runPdfName();document.body.appendChild(a);a.click();a.remove();
}
document.addEventListener('click',e=>{
 if(e.target.closest('#pdfViewerDownload')){if($('pdfViewer').dataset.mode==='ai')downloadAiReport();else downloadRunPdf().catch(err=>notice(err.message));return;}
 const d=$('pdfViewer');if(d?.open&&(e.target.closest('[data-close-pdf]')||e.target===d))d.close();
});
// ---- Teams page: company-wide teams ----
// List like Stories (+ Create, Created, Last updated). Each row: Add members, Assign project, Edit, Delete.
const ct={teams:[],team:null,detailId:''};
async function loadCompanyTeams(){
 const [d,u]=await Promise.all([api('/api/company-teams'),state.users?Promise.resolve(null):api('/api/users').catch(()=>null)]);
 if(u)state.users=u.users||[];
 ct.teams=d.teams||[];renderCompanyTeams();
 if(ct.detailId){if($('ctMembersModal').classList.contains('show'))renderTeamMembers();if($('ctProjectsModal').classList.contains('show'))renderTeamProjects();}
}
function renderCompanyTeams(){
 $('ctCount').textContent=ct.teams.length;
 $('ctRows').innerHTML=ct.teams.map(t=>{
  const faces=t.members.slice(0,4).map((m,i)=>'<span class="tn-avatar tn-avatar-'+(i%4)+'" title="'+esc(m.display_name)+'">'+esc(initialsOf(m.display_name||m.email))+'</span>').join('');
  // Only active assignments are listed here; inactive ones are under Assign project → Inactive.
  const projects=t.projects.filter(p=>p.is_active!==false).map(p=>'<span class="tn-team-chip">'+esc(p.name)+'</span>').join(' ')||'<span class="tn-muted">Not assigned</span>';
  return '<tr><td><strong>'+esc(t.name)+'</strong>'+(t.description?'<div class="tn-muted small">'+esc(t.description)+'</div>':'')+'</td><td>'+(t.members.length?'<span class="tn-ct-faces">'+faces+'</span>':'')+'<span class="tn-muted">'+(t.members.length?t.members.length+' member'+(t.members.length===1?'':'s'):'No members yet')+'</span></td><td>'+projects+'</td>'+createdCell(t.created_by_name,t.created_at)+updatedCell(t.updated_by_name,t.updated_at||t.created_at,t.created_by_name,t.created_at)+'<td><span class="tn-icon-actions">'+actionIcon('userPlus','data-ct-members="'+esc(t.id)+'"','Add members to '+t.name)+actionIcon('assign','data-ct-projects="'+esc(t.id)+'"','Assign '+t.name+' to a project')+actionIcon('edit','data-ct-edit="'+esc(t.id)+'"','Edit team '+t.name)+actionIcon('remove','data-ct-delete="'+esc(t.id)+'"','Delete team '+t.name)+'</span></td></tr>';
 }).join('')||'<tr><td colspan="6" class="tn-empty">No teams yet. Use + Create to add one.</td></tr>';
}
// Create / edit: team name and description
function openTeamForm(team){
 ct.team=team||null;
 $('ctModalTitle').textContent=team?'Edit team':'Create team';
 $('ctModalSub').textContent=team?'Change the team name or description.':'Give the team a name. Then add its members and assign it to projects.';
 $('ctSave').textContent=team?'Save changes':'Create team';
 $('ctName').value=team?.name||'';$('ctDesc').value=team?.description||'';
 bootstrap.Modal.getOrCreateInstance($('ctModal')).show();
}
const ACCOUNT_ROLE_NAMES={DEV:'Developer',QA:'QA',MANAGER:'Manager'};
const detailTeam=()=>ct.teams.find(x=>String(x.id)===ct.detailId);
// Add members popup
function renderTeamMembers(){
 const t=detailTeam();if(!t)return;
 $('ctMembersTitle').textContent='Add members · '+t.name;
 $('ctMembersCount').textContent=t.members.length;
 const inTeam=new Set(t.members.map(m=>String(m.id)));
 const people=(state.users||[]).filter(u=>u.isActive!==false&&!inTeam.has(String(u.id)));
 $('ctAddMemberSelect').innerHTML='<option value="">Choose a user…</option>'+people.map(u=>'<option value="'+esc(u.id)+'">'+esc(u.displayName||u.email)+' · '+esc(u.email||'')+'</option>').join('');
 $('ctAddMemberForm').hidden=!people.length;
 $('ctMembersBody').innerHTML=t.members.map(m=>'<tr data-search="'+esc(((m.display_name||'')+' '+(m.email||'')).toLowerCase())+'"><td><span class="tn-row-person tn-person-sm"><span class="tn-avatar tn-avatar-0" aria-hidden="true">'+esc(initialsOf(m.display_name||m.email))+'</span><span><strong>'+esc(m.display_name)+'</strong><span class="tn-member-email">'+esc(ACCOUNT_ROLE_NAMES[String(m.role||'').toUpperCase()]||m.role||'')+'</span></span></span></td><td>'+esc(m.email||'')+'</td>'+createdCell(m.added_by_name,m.added_at)+'<td><span class="tn-icon-actions">'+actionIcon('remove','data-ct-remove-member="'+esc(m.id)+'"','Remove '+m.display_name+' from '+t.name)+'</span></td></tr>').join('')||'<tr><td colspan="4" class="tn-empty">No members yet. Choose a user above and click + Add.</td></tr>';
}
// Assign project popup
function renderTeamProjects(){
 const t=detailTeam();if(!t)return;
 $('ctProjectsTitle').textContent='Assign project · '+t.name;
 $('ctProjectsCount').textContent=t.projects.length;
 const assigned=new Set(t.projects.map(p=>String(p.id)));
 const open=(state.projects||[]).filter(p=>!assigned.has(String(p.id)));
 $('ctAssignSelect').innerHTML='<option value="">Choose a project…</option>'+open.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+(p.reference_no?' · '+esc(p.reference_no):'')+'</option>').join('');
 $('ctAssignForm').hidden=!open.length;
 // Active · All · Inactive: an inactive assignment stays listed but its members get no access through this team.
 const f=ct.assignFilter||'active',inactive=t.projects.filter(p=>p.is_active===false);
 $('ctCountActive').textContent=t.projects.length-inactive.length;$('ctCountAll').textContent=t.projects.length;$('ctCountInactive').textContent=inactive.length;
 for(const b of document.querySelectorAll('[data-assign-filter]'))b.setAttribute('aria-checked',String(b.dataset.assignFilter===f));
 const shown=f==='all'?t.projects:f==='inactive'?inactive:t.projects.filter(p=>p.is_active!==false);
 $('ctProjectsBody').innerHTML=shown.map(p=>'<tr data-search="'+esc(((p.name||'')+' '+(p.reference_no||'')).toLowerCase())+'"><td><strong>'+esc(p.name)+'</strong></td><td>'+esc(p.reference_no||'—')+'</td><td>'+(p.is_active===false?'<span class="tn-tag">Inactive</span>':'<span class="tn-tag success">Active</span>')+'</td><td><select class="form-select tn-handles" data-handles-project="'+esc(p.id)+'" aria-label="Failed tests this team handles on '+esc(p.name)+'">'+HANDLE_OPTIONS.map(([v,l])=>'<option value="'+v+'"'+(v===((p.handles||[])[0]||'')?' selected':'')+'>'+l+'</option>').join('')+'</select></td>'+createdCell(p.assigned_by_name,p.assigned_at)+updatedCell(p.status_updated_by_name||p.assigned_by_name,p.status_updated_at||p.assigned_at,p.assigned_by_name,p.assigned_at)
  +'<td><span class="tn-icon-actions">'+(p.is_active===false?actionIcon('restore','data-ct-status="activate" data-project-id="'+esc(p.id)+'"','Activate '+t.name+' on '+p.name):actionIcon('pause','data-ct-status="deactivate" data-project-id="'+esc(p.id)+'"','Deactivate '+t.name+' on '+p.name))+'</span></td></tr>').join('')
  ||'<tr><td colspan="6" class="tn-empty">'+(t.projects.length?(f==='inactive'?'No inactive assignments.':'No active assignments.'):'Not assigned to any project yet. Choose a project above and press + Add.')+'</td></tr>';
}
async function saveTeamLists(t,memberIds,projectIds,message){
 await api('/api/company-teams/'+encodeURIComponent(t.id),{method:'PUT',body:JSON.stringify({name:t.name,description:t.description||'',memberIds,projectIds})});
 notice(message,'success');await loadCompanyTeams();
}
function openTeamPopup(kind,id){
 ct.detailId=String(id);
 if(kind==='members'){renderTeamMembers();bootstrap.Modal.getOrCreateInstance($('ctMembersModal')).show();}
 else{renderTeamProjects();bootstrap.Modal.getOrCreateInstance($('ctProjectsModal')).show();}
}
document.addEventListener('click',async e=>{
 if(e.target.closest('#ctCreate')){openTeamForm();return;}
 const mem=e.target.closest('[data-ct-members]');if(mem){openTeamPopup('members',mem.dataset.ctMembers);return;}
 const prj=e.target.closest('[data-ct-projects]');if(prj){openTeamPopup('projects',prj.dataset.ctProjects);return;}
 const ed=e.target.closest('[data-ct-edit]');if(ed){openTeamForm(ct.teams.find(x=>String(x.id)===String(ed.dataset.ctEdit)));return;}
 const rm=e.target.closest('[data-ct-remove-member]'),un=e.target.closest('[data-ct-unassign]');
 if(rm||un){
  const t=detailTeam();if(!t)return;
  try{
   if(rm){const who=t.members.find(m=>String(m.id)===String(rm.dataset.ctRemoveMember));
    if(!await window.TestNexusConfirm({title:'Remove member?',message:'Remove '+(who?.display_name||'this person')+' from '+t.name+'?',note:t.projects.length?'They also leave the team\'s projects, unless another assigned team or a direct membership keeps them there.':'The team is not assigned to any project yet.',confirmLabel:'Remove'}))return;
    await saveTeamLists(t,t.members.map(m=>String(m.id)).filter(x=>x!==String(rm.dataset.ctRemoveMember)),t.projects.map(p=>String(p.id)),'Member removed from the team.');}
   else{const p=t.projects.find(x=>String(x.id)===String(un.dataset.ctUnassign));
    if(!await window.TestNexusConfirm({title:'Unassign project?',message:'Unassign '+t.name+' from '+(p?.name||'this project')+'?',note:'Members who are on that project only through this team will leave it.',confirmLabel:'Unassign'}))return;
    await saveTeamLists(t,t.members.map(m=>String(m.id)),t.projects.map(x=>String(x.id)).filter(x=>x!==String(un.dataset.ctUnassign)),'Team unassigned from the project.');}
  }catch(err){notice(err.message);}
  return;
 }
 const del=e.target.closest('[data-ct-delete]');if(!del)return;
 const t=ct.teams.find(x=>String(x.id)===String(del.dataset.ctDelete));if(!t)return;
 if(!await window.TestNexusConfirm({title:'Delete team?',message:'Do you want to delete the team "'+t.name+'"?',note:t.projects.length?'It is assigned to '+t.projects.length+' project(s). People who joined those projects only through this team will be removed from them.':'It is not assigned to any project.',confirmLabel:'Delete team'}))return;
 try{await api('/api/company-teams/'+encodeURIComponent(t.id),{method:'DELETE'});notice('Team deleted.','success');await loadCompanyTeams();}catch(err){notice(err.message);}
});
document.addEventListener('submit',async e=>{
 const id=e.target.id;if(!['ctForm','ctAddMemberForm','ctAssignForm'].includes(id))return;e.preventDefault();
 try{
  if(id==='ctForm'){
   const name=$('ctName').value.trim(),description=$('ctDesc').value.trim();
   if(ct.team){await api('/api/company-teams/'+encodeURIComponent(ct.team.id),{method:'PUT',body:JSON.stringify({name,description,memberIds:ct.team.members.map(m=>String(m.id)),projectIds:ct.team.projects.map(p=>String(p.id))})});bootstrap.Modal.getInstance($('ctModal'))?.hide();notice('Team saved.','success');await loadCompanyTeams();return;}
   await api('/api/company-teams',{method:'POST',body:JSON.stringify({name,description})});
   bootstrap.Modal.getInstance($('ctModal'))?.hide();notice('Team created. Use the row buttons to add members and assign projects.','success');
   await loadCompanyTeams();return;
  }
  const t=detailTeam();if(!t)return;
  if(id==='ctAddMemberForm'){const v=$('ctAddMemberSelect').value;if(!v){notice('Choose a user from the list first.','warning');return;}await saveTeamLists(t,[...t.members.map(m=>String(m.id)),v],t.projects.map(p=>String(p.id)),'Member added to the team.');}
  else{const v=$('ctAssignSelect').value;if(!v){notice('Choose a project from the list first.','warning');return;}await saveTeamLists(t,t.members.map(m=>String(m.id)),[...t.projects.map(p=>String(p.id)),v],'Team assigned to the project. Its members joined.');}
 }catch(err){notice(err.message);}
});
// Searchable dropdown: one box; type to filter, pick from the list. The hidden select keeps the chosen value.
document.addEventListener('click',async e=>{
 const f=e.target.closest('[data-assign-filter]');if(f){ct.assignFilter=f.dataset.assignFilter;renderTeamProjects();return;}
 const b=e.target.closest('[data-ct-status]');if(!b)return;
 const t=detailTeam(),p=t?.projects.find(x=>String(x.id)===String(b.dataset.projectId));if(!t||!p)return;
 const activate=b.dataset.ctStatus==='activate';
 if(!await confirmDanger({title:(activate?'Activate ':'Deactivate ')+t.name+' on '+p.name+'?',message:activate?'Team members get access to '+p.name+' again through this team.':'The assignment stays listed under Inactive. Members who joined '+p.name+' only through this team lose access until it is activated again.',confirmLabel:activate?'Activate':'Deactivate',tone:'warning'}))return;
 try{await api('/api/company-teams/'+encodeURIComponent(t.id)+'/projects/'+encodeURIComponent(p.id)+'/status',{method:'PATCH',body:JSON.stringify({active:activate})});notice('Assignment '+(activate?'activated':'deactivated')+'.','success');await loadCompanyTeams();renderTeamProjects();}catch(err){notice(err.message);}
});
function makeCombo(selectId,placeholder){
 const sel=$(selectId);if(!sel||sel.dataset.combo)return;sel.dataset.combo='1';sel.hidden=true;sel.removeAttribute('required');
 const wrap=document.createElement('div');wrap.className='tn-combo';
 const input=document.createElement('input');input.type='text';input.className='form-control tn-combo-input';input.placeholder=placeholder;input.autocomplete='off';
 input.setAttribute('role','combobox');input.setAttribute('aria-expanded','false');input.setAttribute('aria-label',sel.getAttribute('aria-label')||placeholder);
 const list=document.createElement('div');list.className='tn-combo-list';list.setAttribute('role','listbox');list.hidden=true;
 sel.before(wrap);wrap.append(input,list,sel);
 let active=-1;
 const items=()=>[...sel.options].filter(o=>o.value);
 const close=()=>{list.hidden=true;input.setAttribute('aria-expanded','false');active=-1;};
 const pick=o=>{sel.value=o.value;input.value=o.textContent;close();};
 const draw=()=>{
  const q=input.value.trim().toLowerCase(),found=items().filter(o=>!q||o.textContent.toLowerCase().includes(q));
  list.innerHTML=found.map((o,i)=>'<div class="tn-combo-item'+(i===active?' active':'')+'" role="option" data-value="'+esc(o.value)+'">'+esc(o.textContent)+'</div>').join('')||'<div class="tn-combo-empty">No matches</div>';
  list.hidden=false;input.setAttribute('aria-expanded','true');
 };
 input.addEventListener('focus',()=>{active=-1;draw();});
 input.addEventListener('click',()=>{if(list.hidden){active=-1;draw();}});
 input.addEventListener('input',()=>{sel.value='';active=-1;draw();});
 input.addEventListener('keydown',e=>{
  const rows=[...list.querySelectorAll('.tn-combo-item')];
  if(e.key==='ArrowDown'){e.preventDefault();if(list.hidden)draw();active=Math.min(active+1,rows.length-1);draw();}
  else if(e.key==='ArrowUp'){e.preventDefault();active=Math.max(active-1,0);draw();}
  else if(e.key==='Enter'&&!list.hidden&&active>=0){e.preventDefault();const o=items().find(x=>x.value===rows[active]?.dataset.value);if(o)pick(o);}
  else if(e.key==='Escape')close();
 });
 list.addEventListener('mousedown',e=>{const r=e.target.closest('.tn-combo-item');if(!r)return;e.preventDefault();const o=items().find(x=>x.value===r.dataset.value);if(o)pick(o);});
 input.addEventListener('blur',()=>setTimeout(close,120));
 // when the options are rebuilt (after Add), clear the box
 new MutationObserver(()=>{input.value='';sel.value='';close();}).observe(sel,{childList:true});
}
makeCombo('ctAddMemberSelect','Search users by name or email');
makeCombo('ctAssignSelect','Search projects');
// ---- Failed tests as tasks ----
// Task popup: the failed test case (same facts as the Test cases and Runs pages) and its failure.
// Code-problem task: laid out like a failed-test task.
//   "Scanner"     (like "Test case") — what the scanner found: the same labels as the findings popup.
//   "Scan result" (like "Failure")   — latest scan, times found, where, assigned, and a link back to the scan.
//   "AI"                             — the task written by the AI when the problem was accepted (AI · unverified
//                                     until someone clicks "✓ Mark as checked").
// The task itself is worked like any other task (status, progress, comments); the next scan checks the fix.
async function loadTaskCodeProblem(t){
 const box=$('taskFailureBox');if(!box)return;
 const d=await api('/api/projects/'+encodeURIComponent(requireProject())+'/code-intelligence/tasks/'+encodeURIComponent(t.id));
 if(String(state.taskId)!==String(t.id)||!$('taskFailureBox'))return;
 const f=d.places[0]||{},meta=d.task.metadata||{},ai=meta.aiTask;
 const by=d.places.find(p=>p.decided_by_name);
 const places=d.places.map(p=>'<li>'+esc(p.file_path||'—')+(p.line?' <span class="tn-muted">: '+Number(p.line)+'</span>':'')+(p.installed_version&&p.package_name?' <span class="tn-muted">· '+esc(p.installed_version)+'</span>':'')+'</li>').join('');
 const versions=[...new Set(d.places.map(p=>p.installed_version).filter(Boolean))];
 let html='<div class="tn-task-section"><h3>Scanner</h3>'
  +'<div class="tn-task-case-title"><span class="tn-sev tn-sev-'+esc(String(f.severity||'').toLowerCase())+'">'+esc(titleCaseWord(f.severity))+'</span> '+esc(f.title||'')+'</div>'
  +'<div class="tn-task-grid"><span>Category</span><span>Code Intelligence</span>'
  +'<span>Type</span><span>'+esc(CAT_LABELS[f.category]||f.category||'—')+'</span>'
  +'<span>Severity</span><span>'+esc(titleCaseWord(f.severity)||'—')+'</span>'
  +'<span>Priority</span><span>'+(t.priority?priorityTag(t.priority):'—')+'</span>'
  +'<span>Package / fix</span><span>'+(f.package_name?esc(f.package_name+(versions.length?' '+versions.join(', '):''))+(f.fixed_version?' · fix: '+esc(f.fixed_version):''):'—')+'</span>'
  +'<span>CWE / CVE</span><span>'+esc([f.cwe,f.cve].filter(Boolean).join(' · ')||'—')+'</span>'
  +'<span>Accepted by</span><span>'+(by?esc(by.decided_by_name)+(by.decided_at?' · '+dateTime(by.decided_at):''):'—')+'</span></div>'
  +(f.message?'<details class="tn-task-steps"><summary>Scanner details</summary><p class="tn-code-scanner-text">'+esc(f.message)+'</p></details>':'')+'</div>';
 html+='<div class="tn-task-section"><h3>Scan result</h3><div class="tn-task-grid">'
  +'<span>Latest scan</span><span>'+(meta.scanNumber?'Scan #'+Number(meta.scanNumber):'—')+'</span>'
  +'<span>Times found</span><span>'+Number(d.task.failure_count||1)+'</span>'
  +'<span>Where</span><span><details class="tn-places"'+(d.places.length<=3?' open':'')+'><summary>Found in '+d.places.length+' place'+(d.places.length===1?'':'s')+'</summary><ul>'+places+'</ul></details></span>'
  +'<span>Assigned</span><span>'+esc([t.team_name||(state.tasks||[]).find(x=>x.id===t.id)?.team_name||'No team',ROLE_NAMES[t.assigned_role]||t.assigned_role].filter(Boolean).join(' · '))+(t.assigned_by_system?' <span class="tn-muted">(by system)</span>':'')+'</span></div>'
  +(meta.scanRunId?'<button type="button" class="btn btn-outline-secondary tn-btn mt-2" data-task-scan="'+esc(meta.scanRunId)+'">Scan results ↗</button>':'')+'</div>';
 // AI: the task written by the AI when the problem was accepted ("✓ Mark as checked" once someone agrees with it).
 html+='<div class="tn-task-section tn-code-todo"><h3>AI</h3>';
 if(ai){
  const risk=AI_RISK[ai.realRisk]||AI_RISK.POSSIBLE;
  const canCheck=['PROJECT_MANAGER','QA','DEVELOPER'].includes(d.role);
  html+='<div class="tn-code-todo-head">'+(ai.checkedAt?'<span class="tn-ai-badge is-checked">AI · checked by '+esc(ai.checkedByName||'a team member')+' · '+esc(dateTime(ai.checkedAt))+'</span>':'<span class="tn-ai-badge">AI · unverified</span>'+(canCheck?'<button type="button" class="btn btn-outline-success btn-sm tn-ai-check" data-code-ai-check="'+esc(t.id)+'">✓ Mark as checked</button>':''))+'</div>'
   +'<div class="tn-task-grid"><span>Problem</span><span>'+esc(ai.problem||'—')+'</span>'
   +'<span>Real risk?</span><span><span class="tn-ai-risk '+risk[1]+'">'+risk[0]+'</span> '+esc(ai.riskReason||'')+'</span>'
   +'<span>Suggested priority</span><span><span class="tn-sev tn-pri-'+esc(String(ai.suggestedPriority||'').toLowerCase())+'">'+esc(titleCaseWord(ai.suggestedPriority))+'</span></span></div>'
   +'<h4 class="tn-code-todo-k">Steps</h4><ol class="tn-code-steps">'+(ai.steps||[]).map(s=>'<li>'+esc(s)+'</li>').join('')+'</ol>'
   +(ai.fixCode?'<h4 class="tn-code-todo-k">Suggested code</h4><pre class="tn-ai-code fix">'+esc(ai.fixCode)+'</pre>':'')
   +'<div class="tn-muted small mt-2">Written by AI when accepted'+(ai.createdByName?' by '+esc(ai.createdByName):'')+(ai.createdAt?' · '+esc(dateTime(ai.createdAt)):'')+'</div>';
 }else{
  html+='<p class="tn-muted small mb-0">Not written by AI'+(d.aiEnabled?'':' (AI is not enabled on this server)')+'. Use the Package / fix and Scanner details above.</p>';
 }
 html+='</div>';
 box.innerHTML=html;
}
document.addEventListener('click',async e=>{
 // "Scan results ↗" in a code-problem task: open that scan's results (like "Evidence, reports and run history ↗").
 const sc=e.target.closest('[data-task-scan]');
 if(sc){const back=state.taskId;closeTask();scanReturnTask=back;try{await openScan(sc.dataset.taskScan);}catch(err){notice(err.message);}return;}
 // "✓ Mark as checked": someone read the AI text and agrees; the badge becomes "AI · checked by … · date".
 const ck=e.target.closest('[data-code-ai-check]');
 if(ck&&!ck.disabled){
  const id=ck.dataset.codeAiCheck;ck.disabled=true;
  try{await api('/api/projects/'+encodeURIComponent(requireProject())+'/code-intelligence/tasks/'+encodeURIComponent(id)+'/ai-check',{method:'POST',body:'{}'});notice('AI text marked as checked.','success');if(String(state.taskId)===String(id))await openTask(id);}
  catch(err){notice(err.message);ck.disabled=false;}
 }
});
async function loadTaskFailure(t){
 if(!$('taskFailureBox')||!t.session_id||!t.external_case_id)return;
 const d=await api('/api/work-items/'+encodeURIComponent(t.id)+'/failure');
 const box=$('taskFailureBox');if(!box||state.taskId!==t.id)return;
 const c=d.testCase,f=d.failure;let html='';
 if(c){
  const steps=c.steps.length?'<ol>'+c.steps.map(x=>'<li>'+stepText(x)+'</li>').join('')+'</ol>':'<p class="tn-muted">Not recorded</p>';
  const exp=c.expected.length?'<ul>'+c.expected.map(x=>'<li>'+esc(typeof x==='string'?x:JSON.stringify(x))+'</li>').join('')+'</ul>':'<p class="tn-muted">Not recorded</p>';
  html+='<div class="tn-task-section"><h3>Test case</h3>'
   +'<div class="tn-task-case-title"><span class="tn-case-id">'+esc(c.id)+'</span> '+esc(caseTitle(c.title))+'</div>'
   +'<div class="tn-task-grid"><span>Source</span><span>'+sourceTag(c.source)+'</span><span>Category</span><span>'+esc(catLabel(c.category))+'</span>'
   +'<span>Type</span><span>'+esc(c.type?titleCase(c.type):'—')+'</span><span>Priority</span><span>'+(c.priority?priorityTag(c.priority):'—')+'</span>'
   +'<span>Page</span><span>'+display(c.page)+'</span>'
   +'<span>Created</span><span>'+esc(c.createdBy||'Not recorded')+' · '+dateTime(c.createdAt)+'</span><span>Last updated</span><span>'+esc(c.updatedBy||c.createdBy||'Not recorded')+' · '+dateTime(c.updatedAt||c.createdAt)+'</span></div>'
   +'<details class="tn-task-steps"><summary>Steps ('+c.steps.length+') and expected results</summary><h4>Steps</h4>'+steps+'<h4>Passing criteria (expected result)</h4>'+exp+'</details></div>';
 }
 if(f){
  const runs=f.firstRun&&f.lastRun&&f.firstRun.id!==f.lastRun.id?' (first in Run #'+esc(f.firstRun.number)+', last in Run #'+esc(f.lastRun.number)+')':'';
  html+='<div class="tn-task-section tn-task-failure"><h3>Failure</h3><div class="tn-task-grid">'
   +'<span>Latest result</span><span>'+(f.latest?resultTag(f.latest.passed)+' <span class="tn-muted">Run #'+esc(f.latest.run)+'</span>':'—')+'</span>'
   +'<span>Last failed</span><span>'+(f.lastRun?'Run #'+esc(f.lastRun.number):'—')+(f.environment?' · '+esc(f.environment):'')+'</span>'
   +'<span>Times failed</span><span>'+Number(f.count||0)+runs+'</span>'
   +'<span>Error</span><span>'+(f.error?'<span title="'+esc(String(f.error).slice(0,600))+'">'+esc(failReason(f.error))+'</span>':'—')+'</span>'
   +'<span>AI reason</span><span>'+(f.ai?esc(f.aiReasonLabel||'—')+(f.ai.confidence!=null?' ('+Math.round(Number(f.ai.confidence)*(Number(f.ai.confidence)<=1?100:1))+'%)':'')+(f.ai.summary?'<div class="tn-muted">'+esc(f.ai.summary)+'</div>':''):'<span class="tn-muted">Not analysed yet</span>')+'</span>'
   +'<span>Assigned</span><span>'+esc([f.team||'No team',f.roleLabel].filter(Boolean).join(' · '))+(f.bySystem?' <span class="tn-muted">(by system)</span>':'')+'</span></div>'
   +(f.runId?'<button type="button" class="btn btn-outline-secondary tn-btn mt-2" data-task-case="'+esc(c?.id||t.external_case_id)+'" data-task-run="'+esc(f.runId)+'">Evidence, reports and run history ↗</button>':'')+'</div>';
 }
 box.innerHTML=html;
}
document.addEventListener('click',e=>{
 const b=e.target.closest('[data-task-case]');if(!b)return;
 ['taskDrawer','taskShade'].forEach(x=>$(x)?.classList.add('tn-hidden-behind'));
 state.runId=b.dataset.taskRun;
 openCase(b.dataset.taskCase).then(()=>showCaseTab('History')).catch(err=>notice(err.message));
});
// One box at a time: a box hidden behind a newer one comes back when the newer one is closed.
$('caseViewer')?.addEventListener('close',()=>['taskDrawer','taskShade'].forEach(x=>$(x)?.classList.remove('tn-hidden-behind')));
$('shotViewer')?.addEventListener('close',()=>$('caseViewer')?.classList.remove('tn-hidden-behind'));
// A task chip inside the test case popup: close the popup so the task opens in front.
document.addEventListener('click',e=>{if(e.target.closest('.tn-task-chip')&&$('caseViewer')?.open)$('caseViewer').close();},true);
document.addEventListener('click',e=>{if(e.target.closest('#cancelTaskEdit'))$('closeTask')?.click();});
// Click "Activity history" to show or hide it.
document.addEventListener('click',e=>{const h=e.target.closest('#taskDrawer h3');if(!h||h.nextElementSibling?.id!=='drawerHistory')return;const d=$('taskDrawer');d.classList.toggle('tn-history-open');h.setAttribute('aria-expanded',String(d.classList.contains('tn-history-open')));});
// ✏ Edit: one Save for assignee, status, progress / time spent and the comment. Only what changed is sent.
document.addEventListener('click',async e=>{
 const btn=e.target.closest('#saveTaskEdit');if(!btn)return;
 const id=state.taskId,base='/api/work-items/'+encodeURIComponent(id);
 const assignee=$('taskAssignee'),status=$('taskStatusChange').value,progress=Number($('taskProgress').value),hours=Number($('taskAddHours').value||0),comment=$('taskEditComment').value.trim();
 if(hours<0||hours>24){notice('Add between 0 and 24 hours at a time.','warning');return;}
 const steps=[];
 const assigneeId=window.TNPick.value(assignee);if(assigneeId===null){notice('Choose the person from the list, or clear it.','warning');return;}
 if(assignee&&!assignee.disabled&&assigneeId!==btn.dataset.origAssignee)steps.push(()=>api(base+'/assign',{method:'PATCH',body:JSON.stringify({assignedTo:assigneeId||null})}));
 if(status!==btn.dataset.origStatus)steps.push(()=>api(base+'/status',{method:'PATCH',body:JSON.stringify({status,comment})}));
 if(progress!==Number(btn.dataset.origProgress)||hours>0)steps.push(()=>api(base+'/progress',{method:'PATCH',body:JSON.stringify({progress,addMinutes:Math.round(hours*60)})}));
 {const pick=inputId=>window.TNPick.value($(inputId));
  const parentId=pick('taskParentSearch'),storyId=pick('taskStorySearch');
  if(parentId===null){notice('Choose the parent task from the list, or leave it empty.','warning');return;}
  if(storyId===null){notice('Choose the story from the list, or leave it empty.','warning');return;}
  const links={};if($('taskParentSearch')&&!$('taskParentSearch').disabled&&parentId!==btn.dataset.origParent)links.parentId=parentId||null;
  {const st=$('taskStartDate')?.value||'',due=$('taskDueDate')?.value||'';if(st&&due&&due<st){notice('The start date cannot be after the due date.','warning');return;}
   if(st!==(btn.dataset.origStart||''))links.startAt=st?new Date(st+'T12:00:00').toISOString():null;if(due!==btn.dataset.origDue)links.dueAt=due?new Date(due+'T12:00:00').toISOString():null;}
  {const pts=($('taskPoints')?.value||'').trim();if(pts&&!/^(10|[1-9])$/.test(pts)){notice('Story points must be a whole number from 1 to 10.','warning');return;}if(pts!==btn.dataset.origPoints)links.storyPoints=pts?Number(pts):null;}if($('taskStorySearch')&&!$('taskStorySearch').disabled&&storyId!==btn.dataset.origStory)links.storyId=storyId||null;
  if(Object.keys(links).length)steps.push(()=>api(base+'/links',{method:'PATCH',body:JSON.stringify(links)}));}
 if(comment)steps.push(()=>api(base+'/comments',{method:'POST',body:JSON.stringify({comment})}));
 if(!steps.length){notice('Nothing changed.','warning');return;}
 btn.disabled=true;
 try{
  for(const step of steps)await step();
  notice('Task saved.','success');
  try{state.tasks=(await api('/api/projects/'+encodeURIComponent(requireProject())+'/work-items')).workItems||state.tasks;}catch{}
  renderTasks();await openTask(id);
 }catch(err){notice(err.message);btn.disabled=false;}
});

// Teams → Assign project: which failed tests this team handles on that project (when a project has several teams).
const HANDLE_OPTIONS=[['','All'],['FUNCTIONAL','Functional'],['UI','UI'],['API','API'],['SECURITY','Security'],['ACCESSIBILITY','Accessibility'],['PERFORMANCE','Performance'],['INTEGRATION','Integration']];
document.addEventListener('change',async e=>{
 const s=e.target.closest('[data-handles-project]');if(!s)return;
 const t=detailTeam();if(!t)return;
 try{
  await api('/api/company-teams/'+encodeURIComponent(t.id)+'/projects/'+encodeURIComponent(s.dataset.handlesProject)+'/handles',{method:'PATCH',body:JSON.stringify({handles:s.value?[s.value]:[]})});
  const p=t.projects.find(x=>String(x.id)===String(s.dataset.handlesProject));if(p)p.handles=s.value?[s.value]:[];
  notice(t.name+' now handles '+(s.value?catLabel(s.value)+' failed tests':'all failed tests')+' on this project.','success');
 }catch(err){notice(err.message);}
});
initialize();
})();

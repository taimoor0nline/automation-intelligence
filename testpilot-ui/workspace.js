(function(){
'use strict';
const $=id=>document.getElementById(id), esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state={user:null,projects:[],projectId:'',context:null,tasks:[],deletedTasks:[],evidence:[],taskId:null,view:'overview'};
const token=()=>sessionStorage.getItem('aiTestPilotToken')||'';

const iconPaths={
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
window.addEventListener('message',e=>{if(e.origin===location.origin&&e.data?.type==='tn-popup-size'){const d=$('createDialog');if(Date.now()-Number(d.dataset.openedAt||0)<1500)d.style.height=Math.min(e.data.height+4,innerHeight-48,680)+'px';}});
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
// Source code card (project page): GitHub repositories linked to this project.
async function loadRepos(){
 const d=await api('/api/projects/'+encodeURIComponent(state.projectId)+'/repositories');
 const list=d.repositories||[];
 $('detailRepos').innerHTML=list.map(r=>'<div class="tn-repo"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9"/></svg><a href="'+esc(r.repository_url||'#')+'" target="_blank" rel="noopener">'+esc(r.repo_full_name)+'</a><span class="tn-muted">· '+esc(r.default_branch||'main')+'</span></div>').join('')||'<div class="tn-muted">No repository linked. Testing works without one.</div>';
 const canAdd=['PROJECT_MANAGER','QA'].includes(state.context?.projectRole);
 $('repoForm').hidden=!canAdd;
}
document.addEventListener('submit',async e=>{
 if(e.target.id!=='repoForm')return;e.preventDefault();
 try{const v=formPayload(e.target);await api('/api/projects/'+encodeURIComponent(requireProject())+'/repositories',{method:'POST',body:JSON.stringify({repoFullName:v.repoFullName.trim(),defaultBranch:(v.defaultBranch||'main').trim()})});e.target.reset();await loadRepos();notice('Repository linked.','success');}
 catch(err){notice(err.message);}
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
function personCell(name,when){
 return '<span class="tn-who">'+(name?esc(name):'<span class="tn-muted">Not recorded</span>')+'</span><div class="tn-when">'+esc(dateTime(when))+'</div>';
}
function statusTag(s){const x=String(s||'PENDING');const c=x==='COMPLETED'?'success':x==='ON_HOLD'?'warn':x==='PENDING'?'':'danger';return '<span class="tn-tag '+c+'">'+esc(x.replaceAll('_',' '))+'</span>';}
const detailViews=new Set(['details','stories','inventory','audit','learning','executions','tasks','team','attachments','environments','run']);
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
  const active=el.dataset.view===view||(view==='run'&&el.dataset.view==='executions')||(!tab&&inDetails&&el.dataset.view==='projects'&&!!el.closest('.tn-top'));
  el.classList.toggle('active',active);
  if(tab){el.setAttribute('aria-selected',String(active));el.tabIndex=active?0:-1;}
  else if(active)el.setAttribute('aria-current','page');
  else el.removeAttribute('aria-current');
 });
 const labels={teams:'Teams',run:'Run details',environments:'Project environments',overview:'Home',projects:'Projects',users:'Administration',details:'Project context & scope',stories:'Project stories',tasks:'Project tasks',reports:'Test reports & evidence',executions:'Project runs & reports',inventory:'Project test cases',audit:'Project audit',learning:'Project AI learning',team:'Project team',attachments:'Project attachments'};
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
 if(view==='details'&&state.projectId)loadRepos().catch(()=>{});
 if(view==='team'&&state.projectId)loadTeams().catch(e=>notice(e.message));
 if(view==='teams')loadCompanyTeams().catch(e=>notice(e.message));
 if(view==='environments'&&state.projectId)loadEnvironments().catch(e=>notice(e.message));
 if(view==='run'&&state.projectId)loadRunPage().catch(e=>notice(e.message));
 const startCardShown=view==='details'&&$('projectStartCard')&&!$('projectStartCard').hidden;
 // Start Testing lives only on Context & scope (its card there); the header button is a fallback for when that card is hidden.
 for(const el of document.querySelectorAll('.tn-page-actions [data-start-project]'))el.hidden=view!=='details'||startCardShown;
 const path=inDetails?(view==='run'&&state.runId?'/workspace.html?projectId='+encodeURIComponent(state.projectId)+'&runId='+encodeURIComponent(state.runId)+'#run':projectRoute(state.projectId,view)):'/workspace.html#'+view;
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
 $('storyList').innerHTML=c.stories.map(x=>'<tr><td><strong>'+esc(x.title)+'</strong><div class="tn-muted">'+esc(x.reference_no||'')+'</div></td><td>'+priorityTag(x.priority||'MEDIUM')+'</td>'+createdCell(x.created_by_name,x.created_at)+updatedCell(x.updated_by_name,x.updated_at,x.created_by_name,x.created_at)+'<td><span class="tn-icon-actions">'+actionIcon('edit','data-story="'+esc(x.id)+'"','Edit story '+x.title)+actionIcon('play','data-start-story="'+esc(x.id)+'"','Start testing story '+x.title)+(state.context?.projectRole==='PROJECT_MANAGER'?actionIcon('remove','data-delete-story="'+esc(x.id)+'"','Delete story '+x.title):'')+'</span></td></tr>').join('')||'<tr><td colspan="5" class="tn-empty">No stories yet. Use + Create to add one.</td></tr>';
 $('storyEnvironment').innerHTML='<option value="">Select environment</option>'+c.environments.filter(e=>e.is_active!==false).map(e=>'<option value="'+esc(e.id)+'">'+esc(e.name)+(e.is_default?' (default)':'')+'</option>').join('');
}

function clearStory(){
 $('storyForm').reset();$('storyId').value='';$('storyFormTitle').textContent='Write business story';
 const chosen=state.context?.environments.find(e=>e.is_active!==false&&e.is_default)||state.context?.environments.find(e=>e.is_active!==false);
 if(chosen)$('storyEnvironment').value=chosen.id;
}
function selectStory(id){
 const story=state.context?.stories.find(x=>String(x.id)===String(id));if(!story)return;
 const form=$('storyForm');$('storyId').value=story.id;
 for(const [key,val] of Object.entries({title:story.title,referenceNo:story.reference_no,story:story.story,acceptanceCriteria:story.acceptance_criteria,pagePaths:story.page_paths,priority:story.priority,environmentId:story.environment_id})){
 if(form.elements.namedItem(key))form.elements.namedItem(key).value=val||'';
 }
 $('storyFormTitle').textContent='Edit story · '+(story.reference_no||'');
 show('stories');
 openStoryModal();
}
// Story form lives in a popup: opened by "+ Create" (new story) or the edit icon (existing story).
function openStoryModal(){storyFormError('');bootstrap.Modal.getOrCreateInstance($('storyModal')).show();}
function storyFormError(message){const el=$('storyFormError');if(!el)return;el.textContent=message;el.classList.toggle('d-none',!message);}
async function saveStory(){
 const p=requireProject(),values=formPayload($('storyForm')),id=$('storyId').value;
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
 let tasks=state.tasks.filter(x=>!x.deleted_at),status=$('taskStatusFilter').value;
 const q=$('taskSearch').value.trim().toLowerCase();
 if(status==='DELETED'){
 const deleted=(state.deletedTasks||[]).filter(x=>!q||String(x.title||'').toLowerCase().includes(q));
 $('tasksBody').innerHTML=deleted.map(x=>'<tr><td></td><td><strong>'+esc(x.title)+'</strong></td><td>—</td><td>'+display(x.deleted_by_name)+'</td><td>'+dateTime(x.deleted_at)+'</td><td>'+statusTag('CANCELLED')+'</td><td>—</td><td>—</td><td><span class="tn-icon-actions">'+actionIcon('restore','data-restore="'+esc(x.id)+'"','Restore task '+x.title)+'</span></td></tr>').join('')||'<tr><td colspan="7" class="tn-empty">No deleted tasks match your search.</td></tr>';
 $('taskVisibleCount').textContent=deleted.length;updateTaskSelection();return;
 }
 if(status)tasks=tasks.filter(t=>t.status===status);
 if(q)tasks=tasks.filter(t=>[t.title,t.work_type,t.external_case_id,t.assigned_to_name].some(v=>String(v||'').toLowerCase().includes(q)));
 if($('taskHierarchy').checked){
  const all=new Map(state.tasks.map(t=>[t.id,t]));
  const depth=t=>{let n=0,p=t.parent_work_item_id,seen=new Set([t.id]);while(p&&all.has(p)&&!seen.has(p)&&n<8){seen.add(p);n++;p=all.get(p).parent_work_item_id;}return n;};
  const order=[];const byParent=new Map();for(const t of tasks){const key=t.parent_work_item_id||'';if(!byParent.has(key))byParent.set(key,[]);byParent.get(key).push(t);}
  const visited=new Set();const walk=t=>{if(visited.has(t.id))return;visited.add(t.id);order.push({...t,_depth:depth(t)});for(const child of byParent.get(t.id)||[])walk(child);};
  for(const t of tasks)if(!t.parent_work_item_id||!tasks.some(x=>x.id===t.parent_work_item_id))walk(t);
  for(const t of tasks)walk(t);tasks=order;
 }
 $('tasksBody').innerHTML=tasks.map(x=>'<tr><td><input type="checkbox" class="task-select" value="'+esc(x.id)+'" aria-label="Select '+esc(x.title)+'"></td><td><div class="tn-task-name" style="--task-depth:'+Math.min(x._depth||0,8)+'">'+(x._depth?' <span class="tn-tree-mark" aria-hidden="true">↳</span>':'')+'<div><button class="tn-link tn-task-title" data-task="'+esc(x.id)+'">'+esc(x.title)+'</button><div class="tn-muted">'+esc(x.work_type)+'</div></div></div></td><td>'+display(x.external_case_id)+'</td><td>'+display(x.assigned_to_name)+'</td><td>'+dateTime(x.eta_at||x.due_at)+'</td><td>'+statusTag(x.status)+'</td>'+createdCell(x.created_by_name,x.created_at)+updatedCell(x.updated_by_name,x.updated_at,x.created_by_name,x.created_at)+'<td><span class="tn-icon-actions">'+actionIcon('edit','data-edit-task="'+esc(x.id)+'"','View / edit task '+x.title)+actionIcon('play','data-start-task="'+esc(x.id)+'"','Start testing task '+x.title)+(state.context?.projectRole==='PROJECT_MANAGER'?actionIcon('remove','data-delete-task="'+esc(x.id)+'"','Delete task '+x.title):'')+'</span></td></tr>').join('')||'<tr><td colspan="9" class="tn-empty">No tasks match your filters. Clear the search or select another status.</td></tr>';
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
async function loadInventory(){const project=requireProject();const [inventory,audit,repairMemory]=await Promise.all([api('/api/projects/'+encodeURIComponent(project)+'/test-inventory'),api('/api/projects/'+encodeURIComponent(project)+'/audit'),api('/api/projects/'+encodeURIComponent(project)+'/repair-memory?scope='+(state.learningView||'project'))]);$('inventoryCases').innerHTML=inventory.cases.map(x=>'<tr><td>'+(x.story_reference?'<span class="tn-chip-ref">'+esc(x.story_reference)+'</span>':'<span class="tn-chip-none">Unlinked</span>')+'</td><td><span class="tn-case-title">'+esc(x.title)+'</span><div><span class="tn-case-id">'+esc(x.external_case_id)+'</span></div></td><td data-sort="'+esc({CRITICAL:4,HIGH:3,MEDIUM:2,LOW:1}[String(x.priority||'').toUpperCase()]||0)+'">'+priorityTag(x.priority)+'</td><td data-sort="'+esc(x.created_at||'')+'">'+personCell(x.created_by_name,x.created_at)+'</td><td data-sort="'+esc(x.updated_at||x.created_at||'')+'">'+personCell(x.updated_by_name,x.updated_at||x.created_at)+'</td><td><span class="tn-session-id" title="'+esc(x.session_id)+'">'+esc(x.session_id)+'</span></td></tr>').join('')||'<tr><td colspan="6" class="tn-empty">No cases yet.</td></tr>';if($('inventoryStories'))$('inventoryStories').innerHTML=inventory.stories.map(x=>'<tr><td>'+esc(x.reference_no||'')+' · '+esc(x.title)+'</td><td>'+x.generation_count+'</td><td>'+x.case_count+'</td><td>'+x.execution_count+'</td></tr>').join('')||'<tr><td colspan="4">No stories yet.</td></tr>';renderLearning(repairMemory.repairs||[]);$('inventoryAudit').innerHTML=audit.events.map(x=>'<tr><td><span class="tn-event">'+esc(auditLabel(x.event_type))+'</span></td><td>'+esc(auditDetails(x))+'</td><td>'+(x.actor_name?'<span class="tn-who">'+esc(x.actor_name)+'</span>':'<span class="tn-muted" title="No user was recorded for this event">System</span>')+'</td><td data-sort="'+esc(x.created_at||'')+'">'+dateTime(x.created_at)+'</td></tr>').join('')||'<tr><td colspan="4" class="tn-empty">No recorded audit events yet.</td></tr>';}
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
 const more=document.createElement('details');more.className='tn-task-more';
 more.innerHTML='<summary>More<span>Dates &amp; status actions · subtasks · attachments · comments · history</span></summary><div class="tn-task-more-body"></div>';
 const moreBody=more.querySelector('.tn-task-more-body');
 for(const k of kids)if(!keep.has(k))moreBody.appendChild(k);
 body.appendChild(more);
 // "Retest this task" next to "Start test"; "retest with child tasks" stays under More.
 const retest=$('retestOne');if(retest)$('taskStartTest').parentElement.appendChild(retest);
 const eyebrow=drawer.querySelector('.tn-card-head .tn-eyebrow');if(eyebrow)eyebrow.remove();
 const close=$('closeTask');if(close){close.textContent='×';close.className='tn-dialog-close';close.setAttribute('aria-label','Close task');}
}
async function openTask(id){
 arrangeTaskPopup();
 const serial=++taskOpenSerial;
 const d=await api('/api/work-items/'+encodeURIComponent(id)+'/details');if(serial!==taskOpenSerial)return;state.taskId=id;state.taskRole=d.projectRole;const t=d.task;
 const canReview=['PROJECT_MANAGER','QA'].includes(d.projectRole),isManager=d.projectRole==='PROJECT_MANAGER',isDeveloper=d.projectRole==='DEVELOPER';
 $('taskStartTest').disabled=!canReview;
 $('retestOne').disabled=!canReview;$('retestWithChildren').disabled=!canReview;
 $('subtaskForm').querySelectorAll('input,button').forEach(el=>el.disabled=!canReview);
 $('taskDrop').setAttribute('aria-disabled',String(d.projectRole==='VIEWER'));
 $('taskDrop').tabIndex=d.projectRole==='VIEWER'?-1:0;
 $('taskFiles').disabled=d.projectRole==='VIEWER';
 for(const btn of document.querySelectorAll('[data-task-action]'))btn.disabled=!(canReview||(btn.dataset.taskAction==='ETA'&&isDeveloper))||(btn.dataset.taskAction==='DELETE'&&!isManager);
 $('drawerTitle').textContent=t.title;
 $('drawerInfo').innerHTML=(d.parent?'<div class="tn-kv"><span>Parent task</span><button class="tn-link" data-task="'+esc(d.parent.id)+'">'+esc(d.parent.title)+'</button></div>':'')+'<div class="tn-kv"><span>Type / Priority</span><span>'+esc(t.work_type)+' / '+priorityTag(t.priority)+'</span></div><div class="tn-kv"><span>Test case</span><span>'+display(t.external_case_id)+'</span></div><div class="tn-kv"><span>Status</span><span>'+statusTag(t.status)+'</span></div><div class="tn-kv"><span>Due date</span><span>'+dateTime(t.due_at)+'</span></div>'+(t.closed_at?'<div class="tn-kv"><span>Closed</span><span>'+dateTime(t.closed_at)+(t.closed_by_name?' · by '+esc(t.closed_by_name):'')+'</span></div>':'')+'<p class="tn-info mt-3">'+display(t.description)+'</p><label class="form-label" for="taskStatusChange">Update status</label><div class="d-flex gap-2"><select id="taskStatusChange" class="form-select">'+['PENDING','IN_PROGRESS','ON_HOLD','READY_FOR_RETEST','COMPLETED','CANCELLED'].map(v=>'<option '+(v===t.status?'selected':'')+'>'+v+'</option>').join('')+'</select><button class="btn btn-outline-secondary tn-btn" id="saveTaskStatus">Save</button></div>'+((t.deferred_until)?'<p class="tn-muted mt-2">Deferred until '+dateTime(t.deferred_until)+' · '+esc(t.deferred_reason||'')+'</p>':'');
 $('linkSession').value=t.session_id||'';$('linkCase').value=t.external_case_id||'';
 let availableCases=[];try{availableCases=(await api('/api/projects/'+encodeURIComponent(requireProject())+'/test-cases')).cases||[];}catch(err){console.warn('Case catalog unavailable:',err.message);}
 const choices=[...new Set([t.session_id,...availableCases.map(x=>x.session_id)].filter(Boolean))];
 $('sessionChoices').innerHTML=choices.map(v=>'<option value="'+esc(v)+'"></option>').join('');
 function populateCases(){const sid=$('linkSession').value;const filtered=availableCases.filter(x=>x.session_id===sid);$('caseChoices').innerHTML=filtered.map(x=>'<option value="'+esc(x.external_case_id)+'" label="'+esc(x.title||x.external_case_id)+'"></option>').join('');}
 $('linkSession').oninput=populateCases;populateCases();
 const canLink=['PROJECT_MANAGER','QA'].includes(d.projectRole);$('testLinkForm').querySelectorAll('input,button').forEach(el=>el.disabled=!canLink);await loadTaskLinks(id);
 $('saveTaskStatus').disabled=d.projectRole==='VIEWER';if(isDeveloper){const complete=$('taskStatusChange').querySelector('option[value="COMPLETED"]');if(complete)complete.disabled=true;}
 $('taskEta').value=t.eta_at?new Date(t.eta_at).toISOString().slice(0,16):'';
 $('taskDeferDate').value=t.deferred_until?new Date(t.deferred_until).toISOString().slice(0,16):'';
 $('taskReason').value='';
 $('drawerSubtasks').innerHTML=d.subtasks.map(x=>'<div class="tn-sub"><button class="tn-link" data-task="'+esc(x.id)+'">'+esc(x.title)+'</button><div>'+statusTag(x.status)+'</div></div>').join('')||'<p class="tn-muted">No subtasks yet.</p>';
 $('drawerAttachments').innerHTML=d.attachments.map(x=>'<div class="tn-kv"><span>'+date(x.created_at)+'</span><button class="tn-link" data-task-file="'+esc(x.id)+'">'+esc(x.filename)+'</button></div>').join('')||'<p class="tn-muted">No attachments yet.</p>';
 $('drawerComments').innerHTML=d.comments.map(x=>'<div class="tn-comment"><strong>'+esc(x.user_name||'User')+'</strong> <span class="tn-muted">'+dateTime(x.created_at)+'</span><p>'+esc(x.comment)+'</p></div>').join('')||'<p class="tn-muted mt-2">No comments.</p>';
 const history=await api('/api/projects/'+encodeURIComponent(requireProject())+'/task-test-history?taskId='+encodeURIComponent(id));if(serial!==taskOpenSerial)return;
 $('drawerInfo').innerHTML+='<h3 class="mt-3">Task test history</h3>'+(history.results.length?history.results.map(r=>'<div class="tn-sub">Run #'+esc(r.run_number)+' · '+esc(r.tester||'Unknown tester')+' · '+dateTime(r.completed_at)+' · '+(r.passed?'Passed':'Failed')+'<div>'+evidenceButtons(r.evidence_json)+'</div></div>').join(''):'<p class="tn-muted">No linked execution history yet.</p>');
 $('drawerHistory').innerHTML=d.history.map(h=>'<div class="mb-2">'+esc(h.event_type)+' · '+dateTime(h.created_at)+' · '+esc(h.by_name||'')+(h.comment?' — '+esc(h.comment):'')+'</div>').join('')||'No activity';
 const related=state.evidence.filter(x=>String(x.session_id)===String(t.session_id)&&String(x.external_case_id)===String(t.external_case_id)).slice(0,2);
 if(related.length)$('drawerInfo').innerHTML+='<h3 class="mt-3">Run evidence</h3>'+related.map(x=>'<div class="tn-sub">'+(x.passed?'Passed':'Failed')+' · '+dateTime(x.completed_at)+'<div>'+evidenceButtons(x.evidence_json)+'</div></div>').join('');
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
 $('storyForm').onsubmit=async e=>{e.preventDefault();storyFormError('');try{await saveStory();bootstrap.Modal.getOrCreateInstance($('storyModal')).hide();}catch(err){storyFormError(err.message);}};
 document.addEventListener('click',e=>{if(e.target.closest('#storyCreate')){clearStory();openStoryModal();}});
 $('storyLaunch').onclick=async()=>{storyFormError('');try{await launchStory();}catch(err){storyFormError(err.message);}};
 $('workflowForm').onsubmit=async e=>{e.preventDefault();try{
 const f=e.target;await api('/api/projects/'+encodeURIComponent(requireProject())+'/workflow',{method:'PUT',body:JSON.stringify({autoCreateFailedTasks:f.elements.namedItem('autoCreateFailedTasks').checked,autoCloseVerifiedRetests:f.elements.namedItem('autoCloseVerifiedRetests').checked,defaultDeveloper:$('workflowDeveloper').value||null})});
 await loadWorkflow();notice('Project workflow configuration saved.','success');
 }catch(err){notice(err.message);}};
 $('taskStatusFilter').onchange=async()=>{if($('taskStatusFilter').value==='DELETED'){try{state.deletedTasks=(await api('/api/projects/'+encodeURIComponent(requireProject())+'/deleted-tasks')).tasks||[];}catch(err){notice(err.message);state.deletedTasks=[];}}renderTasks();};
 $('evidenceModal').addEventListener('hidden.bs.modal',()=>{const v=$('evidencePreview');v.replaceChildren();if(evidenceObjectUrl)URL.revokeObjectURL(evidenceObjectUrl);evidenceObjectUrl='';});
 $('allTasks').onchange=e=>{document.querySelectorAll('.task-select').forEach(x=>x.checked=e.target.checked);updateTaskSelection();};
 $('tasksBody').addEventListener('change',e=>{if(e.target.matches('.task-select'))updateTaskSelection();});
 $('taskSearch').addEventListener('input',renderTasks);
 $('taskHierarchy').addEventListener('change',renderTasks);
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
 const editTask=e.target.closest('[data-edit-task]');if(editTask){lastTaskTrigger=editTask;try{await openTask(editTask.dataset.editTask);}catch(err){notice(err.message);}return;}
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
 $('runResultsBody').innerHTML='<tr><td colspan="9" class="tn-empty">Loading run…</td></tr>';
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
 $('runResultsBody').innerHTML=g.cases.map(r=>'<tr><td><span class="tn-case-id">'+esc(r.external_case_id||'—')+'</span> '+esc(caseTitle(r.title))+'</td><td>'+esc((x=>x?String(x).charAt(0).toUpperCase()+String(x).slice(1).toLowerCase():'—')(r.test_category))+'</td><td>'+esc((x=>x?String(x).charAt(0).toUpperCase()+String(x).slice(1).toLowerCase():'—')(r.scenario_type))+'</td><td>'+(r.priority?priorityTag(r.priority):'—')+'</td><td data-sort="'+(r.passed?1:0)+'">'+resultTag(r.passed)+'</td><td data-sort="'+Number(r.times_run||1)+'">'+Number(r.times_run||1)+'</td>'+createdCell(r.case_created_by_name,r.case_created_at)+updatedCell(r.latest_by_name,r.latest_completed_at,r.case_created_by_name,r.case_created_at)+'<td><span class="tn-icon-actions">'+actionIcon('eye','data-open-case="'+esc(r.external_case_id||'')+'"','Details and run history of '+(r.external_case_id||'this test case'))+(canRerun()?actionIcon('play','data-rerun-case="'+esc(r.external_case_id||'')+'"','Re-run '+(r.external_case_id||'this test case')):'')+'</span></td></tr>').join('')||'<tr><td colspan="9" class="tn-empty">No test cases were recorded for this run.</td></tr>';
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
 $('caseViewerMeta').textContent=[tc?.category?titleCase(tc.category):'',tc?.type?titleCase(tc.type):'',tc?.priority?titleCase(tc.priority)+' priority':'',tc?.review?.status==='CONFIRMED'?'Approved'+(tc.review.confirmedAt?' on '+dateTime(tc.review.confirmedAt):''):tc?.review?.status?titleCase(tc.review.status):'',tc?.review?.revision?'Revision '+tc.review.revision:''].filter(Boolean).join(' · ');
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
  return '<tr><td data-sort="'+esc(x.completed_at||'')+'"><strong>'+esc(name)+'</strong></td><td>'+display(x.environment)+'</td><td>'+resultTag(x.passed)+why+'</td><td>'+pic+'</td><td>'+reports+'</td>'+createdCell(x.executed_by_name,x.completed_at)+'</tr>';
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
  const bar='<a href="'+data+'" download="'+esc(aiReport.name)+'" style="position:fixed;bottom:18px;right:18px;z-index:99;padding:8px 14px;border-radius:9px;background:#0f1f5c;color:#fff;font:600 13px system-ui,sans-serif;text-decoration:none;box-shadow:0 4px 14px rgba(15,23,42,.25)">Download</a>';
  const page=html.replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="script-src \'none\'"><title>'+esc('AI report · '+(label||''))+'</title>').replace('</head>','<style>#exportAnalysisExcel{display:none!important}</style></head>').replace(/<body([^>]*)>/,'<body$1>'+bar);
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
  +'<h4>Results</h4><table class="tn-report-table"><thead><tr><th>ID</th><th>Test case</th><th>Priority</th><th>Result</th></tr></thead><tbody>'+d.results.map(r=>'<tr><td>'+esc(r.external_case_id||'')+'</td><td>'+esc(caseTitle(r.title))+'</td><td>'+esc(r.priority?String(r.priority).charAt(0).toUpperCase()+String(r.priority).slice(1):'—')+'</td><td class="'+(r.passed?'ok':'bad')+'">'+(r.passed?'Passed':'Failed')+'</td></tr>').join('')+'</tbody></table>'
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
 $('ctProjectsBody').innerHTML=shown.map(p=>'<tr data-search="'+esc(((p.name||'')+' '+(p.reference_no||'')).toLowerCase())+'"><td><strong>'+esc(p.name)+'</strong></td><td>'+esc(p.reference_no||'—')+'</td><td>'+(p.is_active===false?'<span class="tn-tag">Inactive</span>':'<span class="tn-tag success">Active</span>')+'</td>'+createdCell(p.assigned_by_name,p.assigned_at)+updatedCell(p.status_updated_by_name||p.assigned_by_name,p.status_updated_at||p.assigned_at,p.assigned_by_name,p.assigned_at)
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
initialize();
})();

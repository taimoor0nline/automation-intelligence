(function(){
'use strict';
const $=id=>document.getElementById(id),page=document.body.dataset.managementPage;
const qs=new URLSearchParams(location.search),tokenKey='aiTestPilotToken',token=()=>sessionStorage.getItem(tokenKey)||'';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const selectedProject=()=>qs.get('projectId')||localStorage.getItem('testnexus:currentProject')||'';
let projectId='',environments=[],canManage=false,envPage=1,user=null;
function feedback(msg,kind='error'){const b=$('mgFeedback');b.textContent=msg;b.className='mg-feedback '+kind;b.hidden=false;b.scrollIntoView({block:'nearest'});}
function clearFeedback(){$('mgFeedback').hidden=true;}
async function api(url,init={}){
 const response=await fetch(url,{...init,headers:{...(init.body?{'Content-Type':'application/json'}:{}),Authorization:'Bearer '+token(),...(init.headers||{})}});
 const data=await response.json().catch(()=>({}));
 if(!response.ok){const error=new Error(data.reply||'Request failed ('+response.status+').');error.status=response.status;throw error;}
 return data;
}
function projectUrl(path){return path+'?projectId='+encodeURIComponent(projectId);}
function projectWorkspaceUrl(section='details'){return '/workspace.html?projectId='+encodeURIComponent(projectId)+'#'+section;}
function linkedNavigation(){
 // Highlight the current section in the top bar.
 const current=$('navProjects'); // every management page belongs to a project
 current?.setAttribute('aria-current','page');
 renderBreadcrumb();
 const cancel=$('mgEnvCancel');if(cancel)cancel.href=projectUrl('/environment-config.html');
 if(cancel&&embedded)cancel.onclick=e=>{e.preventDefault();doneEnvForm(false);};
 const taskCancel=$('mgTaskCancel');if(taskCancel)taskCancel.href=projectWorkspaceUrl('tasks');
}
function icon(name,description,urlOrFn,kind=''){
 const paths={eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
 edit:'<path d="m16 4 4 4M4 20l4-.7L20 7a2 2 0 0 0-3-3L5 16z"/>',
 trash:'<path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7M10 11v5m4-5v5"/>',
 pause:'<circle cx="12" cy="12" r="9"/><path d="M9 8v8M15 8v8"/>',play:'<path d="m8 5 11 7-11 7z"/>'};
 const attrs='class="mg-icon '+kind+'" title="'+esc(description)+'" aria-label="'+esc(description)+'"';
 const svg='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+paths[name]+'</svg>';
 // Page addresses become links; anything else (an environment id) becomes an action button.
 return typeof urlOrFn==='string'&&urlOrFn.startsWith('/')?'<a '+attrs+' href="'+esc(urlOrFn)+'">'+svg+'</a>':'<button type="button" '+attrs+' data-env-action="'+name+'" data-env-id="'+esc(urlOrFn)+'">'+svg+'</button>';
}
// "Created" / "Last updated" cell: person + date (same as the project pages).
function mgDateTime(v){return v?new Date(v).toLocaleString('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true}):'—';}
function mgPersonCell(name,at){return '<td><span class="mg-who">'+(name?esc(name):'<span class="mg-muted">Not recorded</span>')+'</span><div class="mg-when">'+esc(mgDateTime(at))+'</div></td>';}
function lock(form,value){const submit=$('mgSubmit');if(submit)submit.disabled=value;}
function nameOfProject(d){return d.project?.name||'Selected project';}
// Breadcrumb like the project pages: Projects › <project> › <this page>.
const PAGE_LABELS={'environment-list':'Environments','environment-form':'Environment','project-create':'Create project','task-create':'Create task'};
function renderBreadcrumb(projectName){
 const nav=$('mgBreadcrumb');if(!nav)return;
 const parts=['<a href="/workspace.html#projects">Projects</a>'];
 if(projectId&&page!=='project-create')parts.push('<a href="'+projectWorkspaceUrl()+'">'+(projectName?escapeHtml(projectName):'Project')+'</a>');
 if(page==='environment-form'&&projectId)parts.push('<a href="'+projectUrl('/environment-config.html')+'">Environments</a>');
 parts.push('<span aria-current="page">'+(PAGE_LABELS[page]||'')+'</span>');
 nav.innerHTML=parts.join('<span aria-hidden="true">›</span>');
}
function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function loadProject(){
 if(page==='project-create')return;
 if(!projectId)throw Error('Open a project from the Projects list first.');
 const projects=await api('/api/projects');
 if(!(projects.projects||[]).some(p=>String(p.id)===String(projectId)))throw Error('You do not have access to this project.');
 localStorage.setItem('testnexus:currentProject',projectId);
 const workspace=await api('/api/projects/'+encodeURIComponent(projectId)+'/workspace');
 if($('mgSelectedProject'))$('mgSelectedProject').textContent=nameOfProject(workspace);
 renderBreadcrumb(workspace.project?.name);
 if(page==='task-create'&&!['QA','PROJECT_MANAGER'].includes(workspace.projectRole))throw Error('Only QA and Project Managers can create tasks.');
 return workspace;
}
const mime={
 pdf:'application/pdf',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
 xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
 pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',
 png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',txt:'text/plain',csv:'text/csv',zip:'application/zip'
};
function file64(file){return file.arrayBuffer().then(data=>{let binary='',bytes=new Uint8Array(data);for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode.apply(null,bytes.subarray(i,i+32768));return btoa(binary);});}
async function upload(project,files){
 for(const file of files){
  const ext=(file.name.split('.').pop()||'').toLowerCase();
  if(!mime[ext]||file.size<1||file.size>5*1024*1024)throw Error('Invalid document: '+file.name+' (allowed types, maximum 5 MB per file).');
  await api('/api/projects/'+encodeURIComponent(project)+'/documents',{method:'POST',body:JSON.stringify({filename:file.name,mimeType:mime[ext],base64:await file64(file),category:'OTHER'})});
 }
}
async function initProjectCreate(){
 if(String(user.role).toUpperCase()!=='MANAGER')throw Error('Platform manager permission required to create projects.');
 const input=$('mgProjectFiles'),drop=$('mgProjectDrop');
 const describe=()=>$('mgProjectFileNames').textContent=[...input.files].map(x=>x.name).join(', ')||'No files selected';
 drop.onclick=()=>input.click();
 drop.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();input.click();}};
 for(const name of ['dragenter','dragover'])drop.addEventListener(name,e=>{e.preventDefault();drop.classList.add('drag');});
 drop.addEventListener('dragleave',()=>drop.classList.remove('drag'));
 drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('drag');const dt=new DataTransfer();for(const f of e.dataTransfer.files)dt.items.add(f);input.files=dt.files;describe();});
 input.addEventListener('change',describe);
 $('mgProjectForm').onsubmit=async e=>{
  e.preventDefault();clearFeedback();lock(null,true);
  let project=null;
  try{
   const v=Object.fromEntries(new FormData(e.currentTarget).entries());
   if(v.startDate&&v.endDate&&v.endDate<v.startDate)throw Error('End date cannot be before start date.');
   const result=await api('/api/projects',{method:'POST',body:JSON.stringify({name:v.name,description:v.description})});
   project=result.project;projectId=project.id;
   localStorage.setItem('testnexus:currentProject',projectId);
   await api('/api/projects/'+encodeURIComponent(projectId)+'/profile',{method:'PATCH',body:JSON.stringify({referenceNo:v.referenceNo||'',startDate:v.startDate||null,endDate:v.endDate||null})});
   const files=[...input.files];await upload(projectId,files);
   if(!embedDone({changed:true,kind:'project',projectId}))location.assign(projectWorkspaceUrl('details'));
  }catch(err){
   feedback(project?'Project was created, but setup was not fully completed: '+err.message+' Open Project Details to finish.':err.message);
   lock(null,false);
  }
 };
}
// Searchable dropdown: type in the box, pick from the list; the chosen record's id is kept in the hidden field.
function searchable(inputId,listId,hiddenId,items){
 const input=$(inputId),hidden=$(hiddenId);if(!input||!hidden)return;
 window.TNPick.attach(input,items,{onChange:item=>{hidden.value=item?item.id:'';}});
 input.addEventListener('input',()=>{hidden.value='';});
}
const ROLE_NAMES={PROJECT_MANAGER:'Project Manager',QA:'QA',DEVELOPER:'Developer'};
const taskNo=n=>'T-'+String(n).padStart(4,'0');
async function initTaskCreate(workspace){
 // Assigned to: team members first (with their role); a subtask with no one chosen goes to the parent's assignee.
 const roles=new Map((workspace.members||[]).map(m=>[String(m.user_id),m.project_role]));
 let people=[];
 try{people=((await api('/api/projects/'+encodeURIComponent(projectId)+'/team-assignees')).users||[]).map(x=>({id:x.id,name:x.display_name}));}
 catch{people=(workspace.members||[]).filter(x=>x.project_role!=='VIEWER').map(x=>({id:x.user_id,name:x.display_name}));}
 searchable('mgTaskAssigneeSearch','mgAssigneeList','mgTaskAssignee',people.map(p=>({id:p.id,label:p.name+(roles.get(String(p.id))?' · '+(ROLE_NAMES[roles.get(String(p.id))]||roles.get(String(p.id))):'')})));
 // Parent task: search by task number or title.
 let tasks=[];try{tasks=(await api('/api/projects/'+encodeURIComponent(projectId)+'/work-items')).workItems||[];}catch{}
 searchable('mgTaskParentSearch','mgParentList','mgTaskParent',tasks.filter(t=>t.task_number).sort((a,b)=>a.task_number-b.task_number).map(t=>({id:t.id,label:taskNo(t.task_number)+' · '+t.title})));
 // Story: search by story number or title.
 searchable('mgTaskStorySearch','mgStoryList','mgTaskStory',(workspace.stories||[]).map(s=>({id:s.id,label:(s.reference_no?s.reference_no+' · ':'')+s.title})));
 $('mgTaskForm').onsubmit=async e=>{
  e.preventDefault();clearFeedback();
  if(!e.currentTarget.reportValidity())return;
  lock(null,true);
  try{
   const v=Object.fromEntries(new FormData(e.currentTarget).entries());
   v.parentId=v.parentId||null;v.storyId=v.storyId||null;
   v.dueAt=v.dueAt?new Date(v.dueAt).toISOString():null;
   v.startAt=v.startAt?new Date(v.startAt).toISOString():null;
   if(v.startAt&&v.dueAt&&v.dueAt<v.startAt){feedback('The start date cannot be after the due date.');lock(null,false);return;}
   v.assignedTo=v.assignedTo||null;
   await api('/api/projects/'+encodeURIComponent(projectId)+'/work-items',{method:'POST',body:JSON.stringify(v)});
   if(!embedDone({changed:true,kind:'task'}))location.assign(projectWorkspaceUrl('tasks'));
  }catch(err){feedback(err.message);lock(null,false);}
 };
}
async function loadEnvironments(){
 const data=await api('/api/projects/'+encodeURIComponent(projectId)+'/environments');
 environments=data.environments||[];canManage=!!data.canManage;
 return data;
}
function envFilter(){const q=($('mgEnvSearch')?.value||'').trim().toLowerCase();return environments.filter(e=>(!q||(e.name+' '+e.base_url+' '+e.stage_type).toLowerCase().includes(q))&&(!$('mgStageFilter').value||e.stage_type===$('mgStageFilter').value)&&(!$('mgStatusFilter').value||(e.is_active?'active':'disabled')===$('mgStatusFilter').value));}
function renderEnvironments(){
 const filtered=envFilter(),pageSize=Number($('mgPageSize').value)||5,pages=Math.max(1,Math.ceil(filtered.length/pageSize));
 envPage=Math.max(1,Math.min(envPage,pages));const current=filtered.slice((envPage-1)*pageSize,envPage*pageSize);
 $('mgEnvironmentRows').innerHTML=current.map(e=>{
 const base=projectUrl('/environment-form.html')+'&id='+encodeURIComponent(e.id);
 const view=icon('eye','View environment '+e.name,base+'&mode=view');
 const edit=canManage?icon('edit','Edit environment '+e.name,base):'';
 const toggle=canManage?icon(e.is_active?'pause':'play',e.is_active?'Disable environment':'Enable environment',e.id):'';
 const remove=canManage?icon('trash',e.canDelete?'Review deletion of unused environment':'Review deletion restriction',base+'&mode=delete','danger'):'';
 return '<tr><td><strong>'+esc(e.name)+'</strong></td><td>'+esc(e.stage_type)+'</td><td>'+esc(e.base_url)+'</td><td><span class="mg-status '+(e.is_active?'':'inactive')+'">'+(e.is_active?'Active':'Disabled')+'</span></td><td>'+Number(e.usage?.total||0)+' reference(s)</td><td>'+(e.is_default?'Yes':'—')+'</td>'+mgPersonCell(e.created_by_name,e.created_at)+mgPersonCell(e.updated_by_name||(Math.abs(new Date(e.updated_at)-new Date(e.created_at))<2000?e.created_by_name:''),e.updated_at||e.created_at)+'<td><div class="mg-icon-actions">'+view+edit+toggle+remove+'</div></td></tr>';
 }).join('')||'<tr><td colspan="7" class="mg-note">No environments match the filters.</td></tr>';
 $('mgEnvironmentCount').textContent=filtered.length+' environment(s)';
 $('mgPageLabel').textContent='Page '+envPage+' of '+pages;
 $('mgPrev').disabled=envPage===1;
 $('mgNext').disabled=envPage===pages;
 $('mgCreateEnvironment').hidden=!canManage;
}
async function toggleEnvironment(env){
 const activate=!env.is_active,action=activate?'enable':'disable';
 if(!await window.TestNexusConfirm({title:(activate?'Enable':'Disable')+' environment?',message:'Do you want to '+action+' '+env.name+'?',note:activate?'It becomes available for new testing again.':'It will not be offered for new testing. Past runs are kept.',confirmLabel:activate?'Enable':'Disable',tone:'warning'}))return;
 await api('/api/projects/'+encodeURIComponent(projectId)+'/environments/'+encodeURIComponent(env.id),{method:'PATCH',body:JSON.stringify({isActive:activate,isDefault:false})});
 await loadEnvironments();renderEnvironments();feedback('Environment '+(activate?'enabled':'disabled')+'.','success');
}
async function deleteEnvironment(env){
 if(!env.canDelete){feedback('This environment has associated stories or test transactions. Delete is not allowed; disable it instead.');return;}
 if(!await window.TestNexusConfirm({title:'Delete environment?',message:'Do you want to permanently delete '+env.name+'?',note:'This environment has never been used. This cannot be undone.',confirmLabel:'Delete environment'}))return;
 await api('/api/projects/'+encodeURIComponent(projectId)+'/environments/'+encodeURIComponent(env.id),{method:'DELETE'});
 await loadEnvironments();renderEnvironments();feedback('Unused environment deleted.','success');
}
async function initEnvironmentList(){
 const workspace=await loadProject();
 $('mgEnvironmentHeading').textContent=nameOfProject(workspace)+' · Environments';
 $('mgCreateEnvironment').href=projectUrl('/environment-form.html');
 await loadEnvironments();renderEnvironments();
 for(const id of ['mgStageFilter','mgStatusFilter','mgPageSize'])$(id).addEventListener('change',()=>{envPage=1;renderEnvironments();});
 $('mgEnvSearch')?.addEventListener('input',()=>{envPage=1;renderEnvironments();});
 // Create / view / edit / delete open the environment form in a popup instead of a new page.
 document.addEventListener('click',e=>{const a=e.target.closest('a[href^="/environment-form.html"]');if(!a||e.ctrlKey||e.metaKey||e.shiftKey)return;e.preventDefault();openEnvDialog(a.getAttribute('href'));});
 window.addEventListener('message',e=>{if(e.origin===location.origin&&e.data?.type==='tn-popup-size'){const d=$('mgEnvDialog');if(Date.now()-Number(d.dataset.openedAt||0)<1500)d.style.height=Math.min(e.data.height+4,innerHeight-48,680)+'px';}});
 window.addEventListener('message',async e=>{if(e.origin!==location.origin||e.data?.type!=='tn-env-form')return;$('mgEnvDialog').close();if(e.data.changed){await loadEnvironments();renderEnvironments();if(e.data.message)feedback(e.data.message,'success');}});
 $('mgPrev').onclick=()=>{envPage--;renderEnvironments();};
 $('mgNext').onclick=()=>{envPage++;renderEnvironments();};
 $('mgEnvironmentRows').addEventListener('click',async event=>{
  const b=event.target.closest('[data-env-action]');if(!b)return;
  const env=environments.find(e=>String(e.id)===String(b.dataset.envId));if(!env)return;
  b.disabled=true;clearFeedback();
  try{await(b.dataset.envAction==='trash'?deleteEnvironment(env):toggleEnvironment(env));}
  catch(err){feedback(err.message);}finally{b.disabled=false;}
 });
}
// The environment form can run inside the popup on the Environments list (?embed=1).
const embedded=qs.get('embed')==='1'&&window.parent!==window;
if(embedded)document.documentElement.classList.add('mg-embedded');
// Create pages in a popup: tell the opening page what happened instead of navigating away.
function embedDone(data){if(embedded)window.parent.postMessage({type:'tn-popup-done',...data},location.origin);return embedded;}
// In a popup: title the form after the page ("Create task") and let the popup fit the form's height.
if(embedded){
 const fit=()=>{const m=document.querySelector('.mg-main'),b=getComputedStyle(document.body);const h=m?m.getBoundingClientRect().bottom+scrollY+parseFloat(getComputedStyle(m).marginBottom||0)+parseFloat(b.paddingBottom||0)+parseFloat(b.marginBottom||0):document.body.scrollHeight;window.parent.postMessage({type:'tn-popup-size',height:Math.ceil(h)},location.origin);}; // whole form incl. the space around it, so no scrollbar when it fits
 window.addEventListener('load',()=>{const h=document.querySelector('.mg-card-head h2');if(h&&PAGE_LABELS[page]&&page!=='environment-form')h.textContent=PAGE_LABELS[page];fit();});
 new ResizeObserver(fit).observe(document.querySelector('.mg-main')||document.body);
}
if(embedded)document.addEventListener('click',e=>{const a=e.target.closest('a.mg-btn');if(a&&['Cancel','Back'].includes(a.textContent.trim())){e.preventDefault();embedDone({changed:false});}});
function doneEnvForm(changed,message){
 if(embedded)window.parent.postMessage({type:'tn-env-form',changed,message},location.origin);
 else location.assign(projectUrl('/environment-config.html'));
}
function openEnvDialog(href){
 const url=new URL(href,location.origin);url.searchParams.set('projectId',projectId);url.searchParams.set('embed','1');
 const frame=$('mgEnvFrame');frame.src=url.pathname+url.search;
 $('mgEnvDialog').dataset.openedAt=Date.now();$('mgEnvDialog').style.height='';$('mgEnvDialog').showModal();
}
async function initEnvironmentForm(){
 const workspace=await loadProject();
 await loadEnvironments();
 if(!canManage&&qs.get('mode')!=='view')throw Error('Only Project Managers may edit environment configuration.');
 const id=qs.get('id'),mode=qs.get('mode')||'edit';
 const env=id?environments.find(e=>String(e.id)===String(id)):null;
 if(id&&!env)throw Error('Environment not found.');
 const form=$('mgEnvironmentForm');
 $('mgFormHeading').textContent=mode==='delete'?'Delete environment':mode==='view'?'Environment details':env?'Edit environment':'Create environment';
 $('mgSubmit').textContent=env?'Save changes':'Create environment';
 $('mgEnvCancel').textContent=mode==='view'?'Back':'Cancel';
 if(env){
  form.elements.namedItem('name').value=env.name;
  form.elements.namedItem('baseUrl').value=env.base_url;
  form.elements.namedItem('stageType').value=env.stage_type;
  $('mgEnvDefault').checked=env.is_default;
  $('mgUsage').textContent=(env.usage?.total||0)+' historical reference(s)';
  $('mgEnvLoginRequired').checked=Boolean(env.login_required);
 }
 const users=env?.test_users||[];
 if(users.length)users.forEach(addEnvUserRow);else addEnvUserRow({role:'Default User'});
 $('mgEnvAddUser').onclick=()=>{addEnvUserRow({});$('mgEnvUsers').lastElementChild?.querySelector('[data-role]')?.focus();};
 if(mode==='view'||mode==='delete'||!canManage){
  form.querySelectorAll('input,select').forEach(n=>n.disabled=true);
  form.querySelectorAll('#mgEnvAddUser,[data-remove-user]').forEach(n=>n.hidden=true);
  $('mgSubmit').hidden=true;
  if(mode==='delete'&&env&&canManage){
   $('mgEnvDelete').hidden=false;
   $('mgEnvDelete').disabled=!env.canDelete;
   $('mgEnvDelete').textContent=env.canDelete?'Confirm permanent deletion':'Cannot delete: existing transactions';
   $('mgEnvDisable').hidden=false;
   $('mgEnvDisable').textContent=env.is_active?'Disable for new transactions':'Enable for new transactions';
  }
 }else if(env){
  $('mgEnvDisable').hidden=false;
  $('mgEnvDisable').textContent=env.is_active?'Disable for new transactions':'Enable for new transactions';
  $('mgEnvDelete').hidden=false;
  $('mgEnvDelete').textContent=env.canDelete?'Delete unused environment':'Delete blocked (has history)';
  $('mgEnvDelete').disabled=!env.canDelete;
 }
 $('mgEnvDisable').onclick=async()=>{if(!await window.TestNexusConfirm({title:(env.is_active?'Disable':'Enable')+' environment?',message:'Do you want to '+(env.is_active?'disable':'enable')+' '+env.name+'?',note:env.is_active?'It will not be offered for new testing. Past runs are kept.':'It becomes available for new testing again.',confirmLabel:env.is_active?'Disable':'Enable',tone:'warning'}))return;try{lock(null,true);await api('/api/projects/'+encodeURIComponent(projectId)+'/environments/'+encodeURIComponent(env.id),{method:'PATCH',body:JSON.stringify({isActive:!env.is_active,isDefault:false})});doneEnvForm(true,'Environment '+(env.is_active?'disabled':'enabled')+'.');}catch(err){feedback(err.message);lock(null,false);}};
 $('mgEnvDelete').onclick=async()=>{
  if(!env.canDelete)return feedback('Deletion is blocked by existing transactions. Disable the environment instead.');
  if(!await window.TestNexusConfirm({title:'Delete environment?',message:'Do you want to permanently delete '+env.name+'?',note:'This cannot be undone.',confirmLabel:'Delete environment'}))return;
  try{await api('/api/projects/'+encodeURIComponent(projectId)+'/environments/'+encodeURIComponent(env.id),{method:'DELETE'});doneEnvForm(true,'Environment deleted.');}
  catch(err){feedback(err.message);}
 };
 form.onsubmit=async event=>{
  event.preventDefault();clearFeedback();lock(null,true);
  try{
   const v=Object.fromEntries(new FormData(form).entries());
   const body={name:v.name,baseUrl:v.baseUrl,stageType:v.stageType,isDefault:$('mgEnvDefault').checked,
    loginRequired:$('mgEnvLoginRequired').checked,testUsers:collectEnvUsers()};
   await api('/api/projects/'+encodeURIComponent(projectId)+'/environments'+(env?'/'+encodeURIComponent(env.id):''),{method:env?'PATCH':'POST',body:JSON.stringify(body)});
   doneEnvForm(true,env?'Environment saved.':'Environment created.');
  }catch(err){feedback(err.message);lock(null,false);}
 };
}
// Test users of the environment: one row per account (role, username, password).
const MAX_ENV_USERS=12;
function updateEnvUserCount(){
 const n=$('mgEnvUsers').children.length;
 $('mgEnvUsersCount').textContent=n+' test user'+(n===1?'':'s');
 $('mgEnvAddUser').disabled=n>=MAX_ENV_USERS;
}
function addEnvUserRow(user={}){
 const row=document.createElement('div');
 row.className='mg-env-user';
 row.dataset.userId=user.id||'';
 row.innerHTML='<input data-role maxlength="60" placeholder="Role, e.g. Admin" aria-label="Role">'
  +'<input data-username maxlength="200" autocomplete="off" placeholder="Username or email" aria-label="Username">'
  +'<input data-password type="password" maxlength="500" autocomplete="new-password" aria-label="Password">'
  +'<button type="button" class="mg-btn" data-remove-user title="Remove user" aria-label="Remove user">×</button>';
 row.querySelector('[data-role]').value=user.role||'';
 row.querySelector('[data-username]').value=user.username||'';
 row.querySelector('[data-password]').placeholder=user.hasPassword?'••••••••':'Password';
 row.querySelector('[data-remove-user]').onclick=()=>{row.remove();updateEnvUserCount();};
 $('mgEnvUsers').append(row);
 updateEnvUserCount();
}
// A new row left empty (only the "Default User" placeholder role) is ignored.
function collectEnvUsers(){
 return [...$('mgEnvUsers').children].map(row=>({
  id:row.dataset.userId||undefined,
  role:row.querySelector('[data-role]').value.trim(),
  username:row.querySelector('[data-username]').value.trim(),
  password:row.querySelector('[data-password]').value,
 })).filter(user=>user.id||user.username||user.password||(user.role&&user.role!=='Default User'));
}
async function init(){
 $('mgSignOut').onclick=()=>{sessionStorage.removeItem(tokenKey);sessionStorage.removeItem('testnexus:runnerSelection');sessionStorage.removeItem('testnexus:runnerHandoff');location.replace('/login.html');};
 if(!token()){location.replace('/login.html');return;}
 try{
  const me=await api('/api/auth/me');user=me.user;
  if($('navUsers'))$('navUsers').hidden=String(user?.role||'').toUpperCase()!=='MANAGER'; // Users: managers only
  if($('navTeams'))$('navTeams').hidden=String(user?.role||'').toUpperCase()!=='MANAGER'; // Teams: managers only
  // Same profile menu (avatar ▾ → name, role, Sign out) as the other pages, at the right end of the top bar.
  const signOut=$('mgSignOut');
  if(signOut&&window.TestNexusProfileMenu){const slot=document.createElement('span');signOut.closest('header').append(slot);signOut.remove();window.TestNexusProfileMenu.mount(slot,user||{});}
  projectId=selectedProject();linkedNavigation();
  if(page==='project-create')await initProjectCreate();
  else if(page==='task-create')await initTaskCreate(await loadProject());
  else if(page==='environment-list')await initEnvironmentList();
  else if(page==='environment-form')await initEnvironmentForm();
 }catch(err){if(err.status===401){sessionStorage.removeItem(tokenKey);location.replace('/login.html');return;}feedback(err.message);}
}
init();
})();

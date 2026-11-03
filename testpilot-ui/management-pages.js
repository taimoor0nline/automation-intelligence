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
function linkedNavigation(){
 $('navProject').href='/workspace.html#details';
 $('navTasks').href='/workspace.html#tasks';
 $('navEnvironment').href=projectUrl('/environment-config.html');
 if($('mgBack'))$('mgBack').href=page==='project-create'?'/workspace.html#projects':page==='environment-form'?projectUrl('/environment-config.html'):'/workspace.html#'+(page==='task-create'?'tasks':'details');
 const cancel=$('mgEnvCancel');if(cancel)cancel.href=projectUrl('/environment-config.html');
 const taskCancel=$('mgTaskCancel');if(taskCancel)taskCancel.href='/workspace.html#tasks';
}
function icon(name,description,urlOrFn,kind=''){
 const paths={eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
 edit:'<path d="m16 4 4 4M4 20l4-.7L20 7a2 2 0 0 0-3-3L5 16z"/>',
 trash:'<path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7M10 11v5m4-5v5"/>',
 pause:'<circle cx="12" cy="12" r="9"/><path d="M9 8v8M15 8v8"/>',play:'<path d="m8 5 11 7-11 7z"/>'};
 const attrs='class="mg-icon '+kind+'" title="'+esc(description)+'" aria-label="'+esc(description)+'"';
 const svg='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+paths[name]+'</svg>';
 return typeof urlOrFn==='string'?'<a '+attrs+' href="'+esc(urlOrFn)+'">'+svg+'</a>':'<button type="button" '+attrs+' data-env-action="'+name+'" data-env-id="'+esc(urlOrFn)+'">'+svg+'</button>';
}
function lock(form,value){const submit=$('mgSubmit');if(submit)submit.disabled=value;}
function nameOfProject(d){return d.project?.name||'Selected project';}
async function loadProject(){
 if(page==='project-create')return;
 if(!projectId)throw Error('Open a project from the Projects list first.');
 const projects=await api('/api/projects');
 if(!(projects.projects||[]).some(p=>String(p.id)===String(projectId)))throw Error('You do not have access to this project.');
 const workspace=await api('/api/projects/'+encodeURIComponent(projectId)+'/workspace');
 if($('mgSelectedProject'))$('mgSelectedProject').textContent=nameOfProject(workspace);
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
   location.assign('/workspace.html#details');
  }catch(err){
   feedback(project?'Project was created, but setup was not fully completed: '+err.message+' Open Project Details to finish.':err.message);
   lock(null,false);
  }
 };
}
async function initTaskCreate(workspace){
 const assign=$('mgTaskAssignee');
 try{
  const d=await api('/api/projects/'+encodeURIComponent(projectId)+'/team-assignees');
  assign.innerHTML='<option value="">Unassigned</option>'+(d.users||[]).map(x=>'<option value="'+esc(x.id)+'">'+esc(x.display_name)+'</option>').join('');
 }catch{
  assign.innerHTML='<option value="">Unassigned</option>'+(workspace.members||[]).filter(x=>x.project_role!=='VIEWER').map(x=>'<option value="'+esc(x.user_id)+'">'+esc(x.display_name)+'</option>').join('');
 }
 $('mgTaskForm').onsubmit=async e=>{
  e.preventDefault();clearFeedback();lock(null,true);
  try{
   const v=Object.fromEntries(new FormData(e.currentTarget).entries());
   v.dueAt=v.dueAt?new Date(v.dueAt).toISOString():null;
   v.assignedTo=v.assignedTo||null;
   await api('/api/projects/'+encodeURIComponent(projectId)+'/work-items',{method:'POST',body:JSON.stringify(v)});
   location.assign('/workspace.html#tasks');
  }catch(err){feedback(err.message);lock(null,false);}
 };
}
async function loadEnvironments(){
 const data=await api('/api/projects/'+encodeURIComponent(projectId)+'/environments');
 environments=data.environments||[];canManage=!!data.canManage;
 return data;
}
function envFilter(){return environments.filter(e=>(!$('mgStageFilter').value||e.stage_type===$('mgStageFilter').value)&&(!$('mgStatusFilter').value||(e.is_active?'active':'disabled')===$('mgStatusFilter').value));}
function renderEnvironments(){
 const filtered=envFilter(),pageSize=Number($('mgPageSize').value)||10,pages=Math.max(1,Math.ceil(filtered.length/pageSize));
 envPage=Math.max(1,Math.min(envPage,pages));const current=filtered.slice((envPage-1)*pageSize,envPage*pageSize);
 $('mgEnvironmentRows').innerHTML=current.map(e=>{
 const base=projectUrl('/environment-form.html')+'&id='+encodeURIComponent(e.id);
 const view=icon('eye','View environment '+e.name,base+'&mode=view');
 const edit=canManage?icon('edit','Edit environment '+e.name,base):'';
 const toggle=canManage?icon(e.is_active?'pause':'play',e.is_active?'Disable environment':'Enable environment',e.id):'';
 const remove=canManage?icon('trash',e.canDelete?'Delete environment':'Deletion unavailable: transaction history exists',e.id,'danger'):'';
 return '<tr><td><strong>'+esc(e.name)+'</strong></td><td>'+esc(e.stage_type)+'</td><td>'+esc(e.base_url)+'</td><td><span class="mg-status '+(e.is_active?'':'inactive')+'">'+(e.is_active?'Active':'Disabled')+'</span></td><td>'+Number(e.usage?.total||0)+' reference(s)</td><td>'+(e.is_default?'Yes':'—')+'</td><td><div class="mg-icon-actions">'+view+edit+toggle+remove+'</div></td></tr>';
 }).join('')||'<tr><td colspan="7" class="mg-note">No environments match the filters.</td></tr>';
 $('mgEnvironmentCount').textContent=filtered.length+' environment(s)';
 $('mgPageLabel').textContent='Page '+envPage+' of '+pages;
 $('mgPrev').disabled=envPage===1;
 $('mgNext').disabled=envPage===pages;
 $('mgCreateEnvironment').hidden=!canManage;
}
async function toggleEnvironment(env){
 const activate=!env.is_active,action=activate?'enable':'disable';
 if(!confirm('Do you want to '+action+' '+env.name+' for new testing activity?'))return;
 await api('/api/projects/'+encodeURIComponent(projectId)+'/environments/'+encodeURIComponent(env.id),{method:'PATCH',body:JSON.stringify({isActive:activate,isDefault:false})});
 await loadEnvironments();renderEnvironments();feedback('Environment '+(activate?'enabled':'disabled')+'.','success');
}
async function deleteEnvironment(env){
 if(!env.canDelete){feedback('This environment has associated stories or test transactions. Delete is not allowed; disable it instead.');return;}
 if(!confirm('Permanently delete the unused environment '+env.name+'? This cannot be undone.'))return;
 await api('/api/projects/'+encodeURIComponent(projectId)+'/environments/'+encodeURIComponent(env.id),{method:'DELETE'});
 await loadEnvironments();renderEnvironments();feedback('Unused environment deleted.','success');
}
async function initEnvironmentList(){
 const workspace=await loadProject();
 $('mgEnvironmentHeading').textContent=nameOfProject(workspace)+' · Environments';
 $('mgCreateEnvironment').href=projectUrl('/environment-form.html');
 await loadEnvironments();renderEnvironments();
 for(const id of ['mgStageFilter','mgStatusFilter','mgPageSize'])$(id).addEventListener('change',()=>{envPage=1;renderEnvironments();});
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
async function initEnvironmentForm(){
 const workspace=await loadProject();
 await loadEnvironments();
 if(!canManage&&qs.get('mode')!=='view')throw Error('Only Project Managers may edit environment configuration.');
 const id=qs.get('id'),mode=qs.get('mode')||'edit';
 const env=id?environments.find(e=>String(e.id)===String(id)):null;
 if(id&&!env)throw Error('Environment not found.');
 const form=$('mgEnvironmentForm');
 $('mgFormHeading').textContent=mode==='view'?'Environment details':env?'Edit environment':'Create environment';
 $('mgSubmit').textContent=env?'Save changes':'Create environment';
 $('mgEnvCancel').textContent=mode==='view'?'Back':'Cancel';
 if(env){
  form.elements.namedItem('name').value=env.name;
  form.elements.namedItem('baseUrl').value=env.base_url;
  form.elements.namedItem('stageType').value=env.stage_type;
  $('mgEnvDefault').checked=env.is_default;
  $('mgUsage').textContent=(env.usage?.total||0)+' historical reference(s)';
 }
 if(mode==='view'||!canManage){
  form.querySelectorAll('input,select').forEach(n=>n.disabled=true);
  $('mgSubmit').hidden=true;
 }else if(env){
  $('mgEnvDisable').hidden=false;
  $('mgEnvDisable').textContent=env.is_active?'Disable for new transactions':'Enable for new transactions';
  $('mgEnvDelete').hidden=false;
  $('mgEnvDelete').textContent=env.canDelete?'Delete unused environment':'Delete blocked (has history)';
  $('mgEnvDelete').disabled=!env.canDelete;
 }
 $('mgEnvDisable').onclick=async()=>{try{lock(null,true);await api('/api/projects/'+encodeURIComponent(projectId)+'/environments/'+encodeURIComponent(env.id),{method:'PATCH',body:JSON.stringify({isActive:!env.is_active,isDefault:false})});location.assign(projectUrl('/environment-config.html'));}catch(err){feedback(err.message);lock(null,false);}};
 $('mgEnvDelete').onclick=async()=>{
  if(!env.canDelete)return feedback('Deletion is blocked by existing transactions. Disable the environment instead.');
  if(!confirm('Permanently delete '+env.name+'?'))return;
  try{await api('/api/projects/'+encodeURIComponent(projectId)+'/environments/'+encodeURIComponent(env.id),{method:'DELETE'});location.assign(projectUrl('/environment-config.html'));}
  catch(err){feedback(err.message);}
 };
 form.onsubmit=async event=>{
  event.preventDefault();clearFeedback();lock(null,true);
  try{
   const v=Object.fromEntries(new FormData(form).entries());
   const body={name:v.name,baseUrl:v.baseUrl,stageType:v.stageType,isDefault:$('mgEnvDefault').checked};
   await api('/api/projects/'+encodeURIComponent(projectId)+'/environments'+(env?'/'+encodeURIComponent(env.id):''),{method:env?'PATCH':'POST',body:JSON.stringify(body)});
   location.assign(projectUrl('/environment-config.html'));
  }catch(err){feedback(err.message);lock(null,false);}
 };
}
async function init(){
 $('mgSignOut').onclick=()=>{sessionStorage.removeItem(tokenKey);sessionStorage.removeItem('testnexus:runnerSelection');sessionStorage.removeItem('testnexus:runnerHandoff');location.replace('/login.html');};
 if(!token()){location.replace('/login.html');return;}
 try{
  const me=await api('/api/auth/me');user=me.user;
  projectId=selectedProject();linkedNavigation();
  if(page==='project-create')await initProjectCreate();
  else if(page==='task-create')await initTaskCreate(await loadProject());
  else if(page==='environment-list')await initEnvironmentList();
  else if(page==='environment-form')await initEnvironmentForm();
 }catch(err){if(err.status===401){sessionStorage.removeItem(tokenKey);location.replace('/login.html');return;}feedback(err.message);}
}
init();
})();

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
 download:'<path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/>'
};
function actionIcon(name,attributes,label){
 return '<button type="button" class="tn-icon-action" '+attributes+' aria-label="'+esc(label)+'" title="'+esc(label)+'"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'+(iconPaths[name]||iconPaths.eye)+'</svg></button>';
}


function actionLink(name,href,label){
 return '<a class="tn-icon-action" href="'+esc(href)+'" aria-label="'+esc(label)+'" title="'+esc(label)+'"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'+(iconPaths[name]||iconPaths.eye)+'</svg></a>';
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
function date(v){return v?new Date(v).toLocaleDateString():'—';}
function dateTime(v){return v?new Date(v).toLocaleString():'—';}
function display(v){return v?esc(v):'<span class="tn-muted">Not set</span>';}
function statusTag(s){const x=String(s||'PENDING');const c=x==='COMPLETED'?'success':x==='ON_HOLD'?'warn':x==='PENDING'?'':'danger';return '<span class="tn-tag '+c+'">'+esc(x.replaceAll('_',' '))+'</span>';}
const detailViews=new Set(['details','stories','inventory','executions','tasks','team','attachments']);
const regularViews=new Set(['overview','projects','reports']);
function show(view,historyMode='push'){
 if(!regularViews.has(view)&&!detailViews.has(view))view='projects';
 if(detailViews.has(view)&&(!state.projectId||!state.context))view='projects';
 state.view=view;
 const inDetails=detailViews.has(view);
 document.querySelectorAll('.tn-view').forEach(el=>el.classList.toggle('active',el.id==='view-'+(view==='executions'?'reports':view)));
 $('projectDetailTabs').classList.toggle('d-none',!inDetails);
 document.querySelectorAll('[data-view]').forEach(el=>{
  const tab=!!el.closest('#projectDetailTabs');
  const active=el.dataset.view===view;
  el.classList.toggle('active',active);
  if(tab){el.setAttribute('aria-selected',String(active));el.tabIndex=active?0:-1;}
  else if(active)el.setAttribute('aria-current','page');
  else el.removeAttribute('aria-current');
 });
 const labels={overview:'Home',projects:'Projects',details:'Project details',stories:'Project stories',tasks:'Project tasks & retesting',reports:'Test reports & evidence',executions:'Project runs & reports',inventory:'Project test cases & audit',team:'Project team',attachments:'Project attachments'};
 $('pageTitle').textContent=labels[view]||'TestNexus';
 $('pageSubtitle').textContent=inDetails?(state.context?.project?.name||'Selected project')+' · Scope, stories, tests, tasks, team and attachments':view==='overview'?'Open a project and continue where your team left off':view==='projects'?'Open a project using the View icon':'Execution results and reports';
 $('breadcrumb').textContent=inDetails?'PROJECTS / '+(state.context?.project?.reference_no||state.context?.project?.name||'PROJECT'):'PROJECT WORKSPACE';
 clearNotice();
 if((view==='reports'||view==='executions')&&state.projectId)loadSavedReports().catch(e=>notice(e.message));
 if(view==='inventory'&&state.projectId)loadInventory().catch(e=>notice(e.message));
 if(view==='team'&&state.projectId)loadTeams().catch(e=>notice(e.message));
 for(const el of document.querySelectorAll('.tn-page-actions [data-start-project],#backToProjects'))el.hidden=!inDetails;
 const configLink=$('navEnvironmentConfig');if(configLink)configLink.hidden=!inDetails;
 const path=inDetails?projectRoute(state.projectId,view):'/workspace.html#'+view;
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
 $('projectsBody').innerHTML=state.projects.map(p=>'<tr><td>'+display(p.reference_no)+'</td><td><strong>'+esc(p.name)+'</strong><div class="tn-muted">'+esc(p.description||'')+'</div></td><td>'+date(p.created_at)+'</td><td><span class="tn-icon-actions">'+actionLink('eye',projectRoute(p.id),'View project details: '+p.name)+actionIcon('edit','data-edit-project="'+esc(p.id)+'"','Edit project '+p.name)+actionIcon('play','data-start-project="'+esc(p.id)+'"','Start testing project '+p.name)+'</span></td></tr>').join('')||'<tr><td colspan="4" class="tn-empty">No projects yet. Create your first project.</td></tr>';
 $('homeProjectsCount').textContent=state.projects.length;
 $('homeProjects').innerHTML=state.projects.slice(0,6).map(p=>'<div class="tn-home-project"><div><strong>'+esc(p.name)+'</strong><div class="tn-muted">'+esc(p.reference_no||'Project')+' · '+date(p.created_at)+'</div></div><span class="tn-icon-actions">'+actionIcon('folder','data-open-project="'+esc(p.id)+'"','Open project '+p.name)+actionIcon('play','data-start-project="'+esc(p.id)+'"','Start testing project '+p.name)+'</span></div>').join('')||'<div class="tn-empty">No projects yet. Create your first project from Projects.</div>';
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
 for(const [id,allowed] of toggles){const form=$(id);if(!form)continue;form.querySelectorAll('input,select,textarea,button').forEach(el=>{el.disabled=!allowed;});if(['newProjectForm','memberForm','userForm'].includes(id))form.hidden=!allowed;}
 $('editProfile').disabled=!projectManager;
 $('attachmentsEditProfile').disabled=!projectManager;
 for(const [zoneId,inputId] of [['detailDrop','detailFiles'],['projectDrop','projectFiles']]){
  $(zoneId).setAttribute('aria-disabled',String(!canReview));
  $(zoneId).tabIndex=canReview?0:-1;
  $(inputId).disabled=!canReview;
 }
 $('projectRunAll').disabled=!canReview;
 if(!canReview)$('batchRetest').disabled=true;
 if($('navEnvironmentConfig')){$('navEnvironmentConfig').href=state.projectId?'/environment-config.html?projectId='+encodeURIComponent(state.projectId):'/workspace.html#projects';$('navEnvironmentConfig').hidden=!state.projectId||!detailViews.has(state.view);}
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
 $('profileMeta').innerHTML='<strong>Dates:</strong> '+date(p.start_date)+' – '+date(p.end_date)+'<br><strong>Target:</strong> '+display(p.target_url)+'<br><strong>Technology:</strong> '+display(p.technology_stack);
 const latest=c.runs[0]||null;const pending=state.tasks.filter(t=>!t.deleted_at&&t.status==='READY_FOR_RETEST').length;const successes=c.runs.reduce((n,r)=>n+Number(r.passed||0),0),failures=c.runs.reduce((n,r)=>n+Number(r.failed||0),0);const rate=successes+failures?Math.round(100*successes/(successes+failures))+'%':'—';$('overviewHealth').innerHTML='<div class="tn-health-chip"><strong>'+rate+'</strong>Recorded pass rate</div><div class="tn-health-chip"><strong>'+pending+'</strong>Ready for retest</div><div class="tn-health-chip"><strong>'+(latest?'#'+esc(latest.run_number):'—')+'</strong>Latest run</div><div class="tn-health-chip"><strong>'+c.environments.length+'</strong>Environments</div>';
 $('environmentList').innerHTML=c.environments.map(e=>'<div class="tn-kv"><span>'+esc(e.name)+(e.is_default?' ★':'')+'</span><span>'+esc(e.base_url)+'</span></div>').join('')||'<div class="tn-muted">No environment configured yet.</div>';
 $('profileDocumentList').innerHTML=c.documents.map(d=>'<div class="tn-kv"><span>'+esc(d.category)+'</span><span><button class="tn-link" data-doc="'+esc(d.id)+'">'+esc(d.filename)+'</button> <small class="tn-muted">'+Math.ceil(d.file_size/1024)+' KB</small></span></div>').join('')||'<div class="tn-muted">No documents attached yet.</div>';
 $('detailDocumentsList').innerHTML=c.documents.map(d=>'<tr><td><strong>'+esc(d.filename)+'</strong></td><td>'+esc(d.category||'OTHER')+'</td><td>'+Math.ceil(d.file_size/1024)+' KB</td><td>'+date(d.created_at)+'</td><td><span class="tn-icon-actions">'+actionIcon('download','data-doc="'+esc(d.id)+'"','Download '+d.filename)+'</span></td></tr>').join('')||'<tr><td colspan="5" class="tn-empty">No project attachments. Upload documents above.</td></tr>';
}
function renderStoryList(){
 const c=state.context;
 $('storyList').innerHTML=c.stories.map(x=>'<tr><td><strong>'+esc(x.title)+'</strong><div class="tn-muted">'+esc(x.reference_no||'')+' · '+date(x.updated_at)+'</div></td><td>'+statusTag(x.priority||'MEDIUM')+'</td><td><span class="tn-icon-actions">'+actionIcon('edit','data-story="'+esc(x.id)+'"','Edit story '+x.title)+actionIcon('play','data-start-story="'+esc(x.id)+'"','Start testing story '+x.title)+'</span></td></tr>').join('')||'<tr><td colspan="3" class="tn-empty">No stories. Write one using the story form.</td></tr>';
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
}
async function saveStory(){
 const p=requireProject(),values=formPayload($('storyForm')),id=$('storyId').value;
 const path='/api/projects/'+encodeURIComponent(p)+'/stories'+(id?'/'+encodeURIComponent(id):'');
 const d=await api(path,{method:id?'PATCH':'POST',body:JSON.stringify(values)});
 await loadWorkspace();selectStory(d.story.id);notice('Story saved to this project.','success');
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
 $('tasksBody').innerHTML=deleted.map(x=>'<tr><td></td><td><strong>'+esc(x.title)+'</strong></td><td>—</td><td>'+display(x.deleted_by_name)+'</td><td>'+dateTime(x.deleted_at)+'</td><td>'+statusTag('CANCELLED')+'</td><td><span class="tn-icon-actions">'+actionIcon('restore','data-restore="'+esc(x.id)+'"','Restore task '+x.title)+'</span></td></tr>').join('')||'<tr><td colspan="7" class="tn-empty">No deleted tasks match your search.</td></tr>';
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
 $('tasksBody').innerHTML=tasks.map(x=>'<tr><td><input type="checkbox" class="task-select" value="'+esc(x.id)+'" aria-label="Select '+esc(x.title)+'"></td><td><div class="tn-task-name" style="--task-depth:'+Math.min(x._depth||0,8)+'">'+(x._depth?' <span class="tn-tree-mark" aria-hidden="true">↳</span>':'')+'<div><button class="tn-link tn-task-title" data-task="'+esc(x.id)+'">'+esc(x.title)+'</button><div class="tn-muted">'+esc(x.work_type)+'</div></div></div></td><td>'+display(x.external_case_id)+'</td><td>'+display(x.assigned_to_name)+'</td><td>'+dateTime(x.eta_at||x.due_at)+'</td><td>'+statusTag(x.status)+'</td><td><span class="tn-icon-actions">'+actionIcon('eye','data-task="'+esc(x.id)+'"','View task '+x.title)+(state.context?.projectRole!=='VIEWER'?actionIcon('edit','data-edit-task="'+esc(x.id)+'"','Edit task '+x.title):'')+actionIcon('play','data-start-task="'+esc(x.id)+'"','Start testing task '+x.title)+(state.context?.projectRole==='PROJECT_MANAGER'?actionIcon('remove','data-delete-task="'+esc(x.id)+'"','Delete task '+x.title):'')+'</span></td></tr>').join('')||'<tr><td colspan="7" class="tn-empty">No tasks match your filters. Clear the search or select another status.</td></tr>';
 $('taskVisibleCount').textContent=tasks.length;updateTaskSelection();
}
async function loadSavedReports(){const project=requireProject(),kind=$('savedReportKind').value;const data=await api('/api/projects/'+encodeURIComponent(project)+'/report-snapshots'+(kind?'?kind='+encodeURIComponent(kind):''));$('savedReportsBody').innerHTML=data.reports.map(r=>'<tr><td>'+esc(r.report_kind.replaceAll('_',' '))+'</td><td>'+esc(r.external_case_id||r.run_id||r.session_id)+'</td><td>'+esc(r.revision)+'</td><td>'+dateTime(r.created_at)+'</td><td><span class="tn-icon-actions">'+actionIcon('eye','data-saved-report="'+esc(r.id)+'"','View saved report')+'</span></td></tr>').join('')||'<tr><td colspan="5" class="tn-empty">No saved reports for this selection.</td></tr>';}
async function openSavedReport(id){const project=requireProject(),data=await api('/api/projects/'+encodeURIComponent(project)+'/report-snapshots/'+encodeURIComponent(id));const detail=$('savedReportDetail');detail.replaceChildren();const title=document.createElement('h3');title.className='h6';title.textContent=data.report.report_kind.replaceAll('_',' ')+' · revision '+data.report.revision;const pre=document.createElement('pre');pre.className='p-3 rounded border';pre.style.cssText='white-space:pre-wrap;max-height:400px;overflow:auto';pre.textContent=JSON.stringify(data.report.report_json,null,2);detail.append(title,pre);if(data.hasHtml){const link=document.createElement('button');link.className='btn btn-outline-primary btn-sm';link.textContent='Open stored HTML report';link.onclick=async()=>{const authToken=token();const url='/api/projects/'+encodeURIComponent(project)+'/report-snapshots/'+encodeURIComponent(id)+'?format=html';const response=await fetch(url,{headers:{Authorization:'Bearer '+authToken}});if(!response.ok)throw new Error('Report unavailable');const html=await response.text();const frame=document.createElement('iframe');frame.setAttribute('sandbox','');frame.title='Stored execution report';frame.style.cssText='width:100%;height:650px;border:1px solid #ccd5e3;border-radius:8px';frame.srcdoc=html;detail.append(frame);};detail.append(link);}}
function renderReports(){
 const runs=state.context.runs,passed=runs.reduce((n,r)=>n+Number(r.passed||0),0),failed=runs.reduce((n,r)=>n+Number(r.failed||0),0);
 $('reportPass').textContent=passed;$('reportFail').textContent=failed;
 const total=passed+failed,rate=total?Math.round(passed/total*100):0;
 $('qualitySummary').innerHTML=total?'<div class="tn-row mb-2"><strong>'+rate+'% pass rate</strong><span class="tn-muted">'+total+' recorded results across '+runs.length+' runs</span></div><div class="tn-quality-track" role="img" aria-label="'+rate+' percent passed"><div class="tn-quality-pass" style="width:'+rate+'%"></div><div class="tn-quality-fail" style="width:'+(100-rate)+'%"></div></div>':'<div class="tn-empty">No recorded test outcomes. Run approved tests to build your quality baseline.</div>';
 $('runTimeline').innerHTML=runs.slice(0,12).map(x=>{const media=state.evidence.filter(y=>String(y.session_id)===String(x.session_id)&&String(y.run_number)===String(x.run_number)).slice(0,2).map(y=>evidenceButtons(y.evidence_json)).filter(y=>!y.includes('No retained')&&!y.includes('No evidence')).join('');return '<div class="tn-timeline-item"><div><strong>Run #'+esc(x.run_number)+'</strong><div class="tn-timeline-meta">'+dateTime(x.completed_at)+' · '+esc(x.executed_by_name||'Unknown tester')+' · '+esc(x.environment||'Default environment')+'</div><div class="tn-inline-actions mt-1">'+media+'</div></div><span>'+esc(x.passed)+' passed · '+esc(x.failed)+' failed</span></div>';}).join('');
 $('runsBody').innerHTML=runs.map(r=>'<tr><td>#'+esc(r.run_number)+'<div class="tn-muted">'+esc(r.session_id||'')+'</div></td><td>'+display(r.environment)+'</td><td>'+display(r.executed_by_name)+'</td><td>'+dateTime(r.completed_at)+'</td><td>'+esc(r.passed)+'</td><td>'+esc(r.failed)+'</td><td><span class="tn-icon-actions">'+actionIcon('eye','data-report="'+esc(r.session_id)+'"','View execution report')+'</span></td></tr>').join('')||'<tr><td colspan="7" class="tn-empty">No saved execution history.</td></tr>';
 $('evidenceBody').innerHTML=state.evidence.map(x=>'<tr><td>'+esc(x.external_case_id||x.title||'Test')+'<div class="tn-muted">Run #'+esc(x.run_number)+'</div></td><td>'+statusTag(x.passed?'COMPLETED':'FAILED')+'</td><td>'+evidenceButtons(x.evidence_json)+'</td></tr>').join('')||'<tr><td colspan="3" class="tn-empty">No stored execution evidence yet.</td></tr>';
}
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
async function loadInventory(){const project=requireProject();const [inventory,audit,repairMemory]=await Promise.all([api('/api/projects/'+encodeURIComponent(project)+'/test-inventory'),api('/api/projects/'+encodeURIComponent(project)+'/audit'),api('/api/projects/'+encodeURIComponent(project)+'/repair-memory')]);$('inventoryCases').innerHTML=inventory.cases.map(x=>'<tr><td>'+esc(x.story_reference||'Unlinked')+'</td><td>'+esc(x.title)+'<div class="tn-muted">'+esc(x.external_case_id)+'</div></td><td>'+esc(x.priority||'—')+'</td><td>'+esc(x.session_id)+'</td></tr>').join('')||'<tr><td colspan="4">No cases yet.</td></tr>';$('inventoryStories').innerHTML=inventory.stories.map(x=>'<tr><td>'+esc(x.reference_no||'')+' · '+esc(x.title)+'</td><td>'+x.generation_count+'</td><td>'+x.case_count+'</td><td>'+x.execution_count+'</td></tr>').join('')||'<tr><td colspan="4">No stories yet.</td></tr>';$('repairMemoryList').innerHTML=repairMemory.repairs.length?repairMemory.repairs.map(r=>'<div class="border-bottom py-2"><strong>'+esc(r.recommendation?.title||'Recommended improvement')+'</strong><div class="tn-muted">'+esc(r.recommendation?.summary||'Review this improvement before use.')+'</div><div class="tn-muted">Page: '+esc(r.page_path)+'</div><small>Verified '+esc(dateTime(r.verified_at))+' · Successful reuses '+esc(r.success_count)+'</small></div>').join(''):'No verified repair suggestions yet.';$('inventoryAudit').innerHTML=audit.events.map(x=>'<tr><td>'+esc(x.event_type)+'</td><td>'+esc(x.actor_name||'System')+'</td><td>'+dateTime(x.created_at)+'</td></tr>').join('')||'<tr><td colspan="3">No recorded audit events yet.</td></tr>';}
async function loadTeams(){
 const project=requireProject();
 const [all,attached,assignees,teamMembers]=await Promise.all([
  api('/api/teams'),api('/api/projects/'+encodeURIComponent(project)+'/teams'),
  api('/api/projects/'+encodeURIComponent(project)+'/team-assignees'),
  api('/api/projects/'+encodeURIComponent(project)+'/team-members')
 ]);
 const teams=attached.teams||[],members=teamMembers.members||[];
 $('teamDirectory').innerHTML='<option value="">Select team</option>'+(all.teams||[]).map(t=>'<option value="'+esc(t.id)+'">'+esc(t.name)+'</option>').join('');
 $('teamMemberTeam').innerHTML='<option value="">Select team</option>'+teams.map(t=>'<option value="'+esc(t.id)+'">'+esc(t.name)+'</option>').join('');
 $('teamMemberUser').innerHTML='<option value="">Select user</option>'+state.context.members.map(m=>'<option value="'+esc(m.user_id)+'">'+esc(m.display_name)+'</option>').join('');
 $('projectTeams').innerHTML=teams.map(t=>'<tr><td><strong>'+esc(t.name)+'</strong></td><td><span class="tn-icon-actions">'+actionIcon('remove','data-detach-team="'+esc(t.id)+'"','Detach team '+t.name)+'</span></td></tr>').join('')||'<tr><td colspan="2" class="tn-empty">No teams attached.</td></tr>';
 $('projectTeamMembers').innerHTML=members.map(m=>'<tr><td>'+esc(m.display_name)+'</td><td>'+esc(teams.find(t=>t.id===m.team_id)?.name||'Team')+'</td><td><span class="tn-icon-actions">'+actionIcon('remove','data-remove-team-member="'+esc(m.team_id)+'" data-member-id="'+esc(m.user_id)+'"','Remove member '+m.display_name)+'</span></td></tr>').join('')||'<tr><td colspan="3" class="tn-empty">No members assigned.</td></tr>';
 if($('newTaskAssignee'))$('newTaskAssignee').innerHTML='<option value="">Unassigned</option>'+(assignees.users||[]).map(u=>'<option value="'+esc(u.id)+'">'+esc(u.display_name)+'</option>').join('');
}
function renderTeam(){
 $('teamBody').innerHTML=state.context.members.map(m=>'<tr><td>'+esc(m.display_name)+'</td><td>'+esc(m.email)+'</td><td>'+statusTag(m.project_role)+'</td><td><span class="tn-icon-actions">'+(state.context?.projectRole==='PROJECT_MANAGER'?actionIcon('remove','data-remove-project-member="'+esc(m.user_id)+'"','Remove project member '+m.display_name):'')+'</span></td></tr>').join('')||'<tr><td colspan="4" class="tn-empty">No members.</td></tr>';
 const list=state.users||state.context.members;
 $('memberUser').innerHTML='<option value="">Select user</option>'+list.map(x=>'<option value="'+esc(x.id||x.user_id)+'">'+esc(x.displayName||x.display_name||x.email)+'</option>').join('');
 if($('newTaskAssignee'))$('newTaskAssignee').innerHTML='<option value="">Unassigned</option>'+state.context.members.map(m=>'<option value="'+esc(m.user_id)+'">'+esc(m.display_name)+'</option>').join('');
 $('workflowDeveloper').innerHTML='<option value="">Manual assignment</option>'+state.context.members.filter(m=>m.project_role==='DEVELOPER').map(m=>'<option value="'+esc(m.user_id)+'">'+esc(m.display_name)+'</option>').join('');
}
async function fetchDirectory(){
 try{const r=await api('/api/projects/'+encodeURIComponent(requireProject())+'/user-directory');state.users=r.users||[];renderTeam();}catch{state.users=null;renderTeam();}
}
let taskOpenSerial=0;
async function openTask(id){
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
 $('drawerInfo').innerHTML=(d.parent?'<div class="tn-kv"><span>Parent task</span><button class="tn-link" data-task="'+esc(d.parent.id)+'">'+esc(d.parent.title)+'</button></div>':'')+'<div class="tn-kv"><span>Type / Priority</span><span>'+esc(t.work_type)+' / '+esc(t.priority)+'</span></div><div class="tn-kv"><span>Test case</span><span>'+display(t.external_case_id)+'</span></div><div class="tn-kv"><span>Status</span><span>'+statusTag(t.status)+'</span></div><div class="tn-kv"><span>Due date</span><span>'+dateTime(t.due_at)+'</span></div><div class="tn-kv"><span>Closed</span><span>'+dateTime(t.closed_at)+' · '+(t.closed_by_name?'By '+esc(t.closed_by_name):'')+'</span></div><p class="tn-info mt-3">'+display(t.description)+'</p><label class="form-label" for="taskStatusChange">Update status</label><div class="d-flex gap-2"><select id="taskStatusChange" class="form-select">'+['PENDING','IN_PROGRESS','ON_HOLD','READY_FOR_RETEST','COMPLETED','CANCELLED'].map(v=>'<option '+(v===t.status?'selected':'')+'>'+v+'</option>').join('')+'</select><button class="btn btn-outline-secondary tn-btn" id="saveTaskStatus">Save</button></div>'+((t.deferred_until)?'<p class="tn-muted mt-2">Deferred until '+dateTime(t.deferred_until)+' · '+esc(t.deferred_reason||'')+'</p>':'');
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
 if(action==='DELETE'&&!confirm('Soft-delete this task? It will remain in the audit history.'))return;
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
async function fileUpload(file,kind){
 if(file.size>5*1024*1024 || !file.size)throw Error(file.name+' must be between 1 byte and 5 MB.');
 const allowed=['pdf','doc','docx','xls','xlsx','pptx','png','jpg','jpeg','webp','txt','csv','zip'];
 const ext=(file.name.split('.').pop()||'').toLowerCase();
 if(!allowed.includes(ext))throw Error('Unsupported file type: '+file.name);
 const mime={'pdf':'application/pdf','doc':'application/msword','docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','xls':'application/vnd.ms-excel','xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation','png':'image/png','jpg':'image/jpeg','jpeg':'image/jpeg','webp':'image/webp','txt':'text/plain','csv':'text/csv','zip':'application/zip'}[ext];
 const data=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<data.length;i+=32768)binary+=String.fromCharCode.apply(null,data.subarray(i,i+32768));
 const body={filename:file.name,mimeType:mime,base64:btoa(binary)};
 if(kind==='project'){body.category='OTHER';}
 const path=kind==='project'?'/api/projects/'+encodeURIComponent(requireProject())+'/documents':'/api/work-items/'+encodeURIComponent(state.taskId)+'/attachments';
 await api(path,{method:'POST',body:JSON.stringify(body)});
}
async function uploadMany(files,kind){
 if(!files.length)return true;
 try{
  if(kind==='task'&&!state.taskId)throw Error('Open a task first.');
  for(const file of files)await fileUpload(file,kind);
  await loadWorkspace();
  if(kind==='task'&&state.taskId)await openTask(state.taskId);
  notice(files.length+' file(s) uploaded.','success');
  return true;
 }catch(e){notice(e.message);return false;}
}
function dropZone(zoneId,inputId,kind){
 const zone=$(zoneId),input=$(inputId);
 zone.onclick=()=>{if(zone.getAttribute('aria-disabled')!=='true')input.click();};zone.onkeydown=e=>{if((e.key==='Enter'||e.key===' ')&&zone.getAttribute('aria-disabled')!=='true'){e.preventDefault();input.click();}};
 for(const event of ['dragenter','dragover'])zone.addEventListener(event,e=>{e.preventDefault();if(zone.getAttribute('aria-disabled')!=='true')zone.classList.add('drag');});
 for(const event of ['dragleave','drop'])zone.addEventListener(event,e=>{e.preventDefault();zone.classList.remove('drag');});
 zone.addEventListener('drop',e=>{if(zone.getAttribute('aria-disabled')!=='true')uploadMany([...e.dataTransfer.files],kind);});
 input.onchange=e=>{uploadMany([...e.target.files],kind);input.value='';};
}
let evidenceObjectUrl='';
async function previewEvidence(url){
 const r=await fetch(url,{headers:{Authorization:'Bearer '+token()}});
 if(!r.ok)throw Error('Evidence is unavailable ('+r.status+').');
 const blob=await r.blob();const view=$('evidencePreview');view.replaceChildren();
 if(evidenceObjectUrl)URL.revokeObjectURL(evidenceObjectUrl);
 evidenceObjectUrl=URL.createObjectURL(blob);
 const node=document.createElement(blob.type.startsWith('video/')?'video':'img');
 node.src=evidenceObjectUrl;node.style.maxWidth='100%';node.style.maxHeight='75vh';
 if(node.tagName==='VIDEO'){node.controls=true;node.preload='metadata';}
 view.appendChild(node);bootstrap.Modal.getOrCreateInstance($('evidenceModal')).show();
}
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
 $('savedReportsRefresh').onclick=()=>loadSavedReports().catch(e=>notice(e.message));$('savedReportKind').onchange=()=>loadSavedReports().catch(e=>notice(e.message));$('savedReportsBody').onclick=e=>{const button=e.target.closest('[data-saved-report]');if(button)openSavedReport(button.dataset.savedReport).catch(err=>notice(err.message));};
 $('inventoryRefresh').onclick=()=>loadInventory().catch(e=>notice(e.message));
 $('teamCreateForm').onsubmit=async e=>{e.preventDefault();try{await api('/api/teams',{method:'POST',body:JSON.stringify(formPayload(e.target))});e.target.reset();await loadTeams();notice('Team created.','success');}catch(err){notice(err.message);}};
 $('projectTeamMembers').onclick=async e=>{const button=e.target.closest('[data-remove-team-member]');if(!button)return;try{await api('/api/projects/'+encodeURIComponent(requireProject())+'/teams/'+encodeURIComponent(button.dataset.removeTeamMember)+'/members/'+encodeURIComponent(button.dataset.memberId),{method:'DELETE'});await loadTeams();notice('Team member removed.','success');}catch(err){notice(err.message);}};
 $('teamMemberForm').onsubmit=async e=>{e.preventDefault();try{const data=formPayload(e.target);await api('/api/teams/'+encodeURIComponent(data.teamId)+'/members',{method:'POST',body:JSON.stringify({userId:data.userId,projectId:requireProject()})});await loadTeams();notice('Team member added.','success');}catch(err){notice(err.message);}};
 $('teamAttachForm').onsubmit=async e=>{e.preventDefault();try{await api('/api/projects/'+encodeURIComponent(requireProject())+'/teams',{method:'POST',body:JSON.stringify(formPayload(e.target))});await loadTeams();notice('Team attached.','success');}catch(err){notice(err.message);}};
 $('projectTeams').onclick=async e=>{const btn=e.target.closest('[data-detach-team]');if(!btn)return;try{await api('/api/projects/'+encodeURIComponent(requireProject())+'/teams/'+encodeURIComponent(btn.dataset.detachTeam),{method:'DELETE'});await loadTeams();}catch(err){notice(err.message);}};

 $('testLinkForm').onsubmit=async e=>{e.preventDefault();try{const id=state.taskId;if(!id)throw Error('Open a task first.');await api('/api/work-items/'+encodeURIComponent(id)+'/test-links',{method:'POST',body:JSON.stringify(formPayload(e.target))});await loadTaskLinks(id);notice('Test case linked to task.','success');}catch(err){notice(err.message);}};
 $('drawerTestLinks').addEventListener('click',async e=>{const b=e.target.closest('[data-unlink-test]');if(!b)return;try{const id=state.taskId;await api('/api/work-items/'+encodeURIComponent(id)+'/test-links/'+encodeURIComponent(b.dataset.unlinkTest),{method:'DELETE'});await loadTaskLinks(id);notice('Test case unlinked.','success');}catch(err){notice(err.message);}});

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
 $('projectPicker').onchange=async e=>{closeTask();state.projectId=e.target.value;localStorage.setItem('testnexus:currentProject',state.projectId);try{await loadWorkspace();show(state.projectId?'details':'projects');}catch(err){notice(err.message);}};
 $('environmentForm').onsubmit=async e=>{e.preventDefault();try{const vals=formPayload(e.target);await api('/api/projects/'+encodeURIComponent(requireProject())+'/environments',{method:'POST',body:JSON.stringify({...vals,isDefault:!!e.target.elements.namedItem('isDefault').checked})});e.target.reset();await loadWorkspace();notice('Environment saved.','success');}catch(err){notice(err.message);}};
 $('storyForm').onsubmit=async e=>{e.preventDefault();try{await saveStory();}catch(err){notice(err.message);}};
 $('storyClear').onclick=clearStory;
 $('storyLaunch').onclick=async()=>{try{await launchStory();}catch(err){notice(err.message);}};
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
 $('memberForm').onsubmit=async e=>{e.preventDefault();try{await api('/api/projects/'+encodeURIComponent(requireProject())+'/members',{method:'POST',body:JSON.stringify(formPayload(e.target))});await loadWorkspace();notice('User assigned to project.','success');}catch(err){notice(err.message);}};
 $('userForm').onsubmit=async e=>{e.preventDefault();try{await api('/api/users',{method:'POST',body:JSON.stringify(formPayload(e.target))});e.target.reset();await fetchDirectory();notice('User created.','success');}catch(err){notice(err.message);}};
 $('editProfile').onclick=()=>{
 const p=state.context?.project;if(!p)return;const f=$('profileForm');
 for(const [k,v] of Object.entries({name:p.name,referenceNo:p.reference_no,startDate:p.start_date?.slice(0,10),endDate:p.end_date?.slice(0,10),description:p.description,objectives:p.objectives,scopeIn:p.scope_in,scopeOut:p.scope_out,businessRules:p.business_rules,acceptanceCriteria:p.acceptance_criteria,targetUrl:p.target_url,technologyStack:p.technology_stack})){const el=f.elements.namedItem(k);if(el)el.value=v||'';}
 $('profileDocumentList').innerHTML=(state.context?.documents||[]).map(d=>'<div class="tn-kv"><span>'+esc(d.category)+'</span><button class="tn-link" data-doc="'+esc(d.id)+'">'+esc(d.filename)+'</button></div>').join('')||'<span class="tn-muted">No documents attached.</span>';
 bootstrap.Modal.getOrCreateInstance($('profileModal')).show();
 };
 $('profileForm').onsubmit=async e=>{e.preventDefault();try{await api('/api/projects/'+encodeURIComponent(requireProject())+'/profile',{method:'PATCH',body:JSON.stringify(formPayload(e.target))});bootstrap.Modal.getOrCreateInstance($('profileModal')).hide();await loadWorkspace();notice('Project profile saved.','success');}catch(err){notice(err.message);}};
 $('attachmentsEditProfile').onclick=()=> $('editProfile').click();
 dropZone('projectDrop','projectFiles','project');dropZone('detailDrop','detailFiles','project');dropZone('taskDrop','taskFiles','task');
 document.body.addEventListener('click',async e=>{
 const removeMember=e.target.closest('[data-remove-project-member]');if(removeMember){if(!confirm('Remove this member from the project?'))return;try{await api('/api/projects/'+encodeURIComponent(requireProject())+'/members/'+encodeURIComponent(removeMember.dataset.removeProjectMember),{method:'DELETE'});await loadWorkspace();notice('Member removed.','success');}catch(err){notice(err.message);}return;}
 const editProject=e.target.closest('[data-edit-project]');if(editProject){
  try{await openProject(editProject.dataset.editProject);if($('editProfile').disabled)throw Error('Project manager permission required to edit this project.');$('editProfile').click();}catch(err){notice(err.message);}
  return;
 }
 const editTask=e.target.closest('[data-edit-task]');if(editTask){lastTaskTrigger=editTask;try{await openTask(editTask.dataset.editTask);}catch(err){notice(err.message);}return;}
 const deleteTask=e.target.closest('[data-delete-task]');if(deleteTask){
  if(!confirm('Move this task to deleted items? Linked history will be preserved.'))return;
  try{await api('/api/work-items/'+encodeURIComponent(deleteTask.dataset.deleteTask)+'/lifecycle',{method:'PATCH',body:JSON.stringify({action:'DELETE',reason:'Deleted from task table'})});await loadWorkspace();notice('Task moved to deleted items.','success');}catch(err){notice(err.message);}
  return;
 }
 const st=e.target.closest('[data-story]');if(st){selectStory(st.dataset.story);return;}
 const t=e.target.closest('[data-task]');if(t){lastTaskTrigger=t;try{await openTask(t.dataset.task);}catch(err){notice(err.message);}return;}
 const doc=e.target.closest('[data-doc]');if(doc){try{await download('/api/projects/'+encodeURIComponent(requireProject())+'/documents/'+encodeURIComponent(doc.dataset.doc)+'/download');}catch(err){notice(err.message);}return;}
 const file=e.target.closest('[data-task-file]');if(file){try{await download('/api/work-items/'+encodeURIComponent(state.taskId)+'/attachments/'+encodeURIComponent(file.dataset.taskFile)+'/download');}catch(err){notice(err.message);}return;}
 const evidence=e.target.closest('[data-evidence]');if(evidence){try{await previewEvidence(evidence.dataset.evidence);}catch(err){notice(err.message);}return;}
 const restore=e.target.closest('[data-restore]');if(restore){try{await api('/api/work-items/'+encodeURIComponent(restore.dataset.restore)+'/lifecycle',{method:'PATCH',body:JSON.stringify({action:'RESTORE'})});state.deletedTasks=(await api('/api/projects/'+encodeURIComponent(requireProject())+'/deleted-tasks')).tasks||[];renderTasks();notice('Task restored.','success');}catch(err){notice(err.message);}return;}
 const report=e.target.closest('[data-report]');if(report){try{await download('/api/reports/'+encodeURIComponent(report.dataset.report));}catch(err){notice(err.message);}}
 });
}
function enableSearchableSelects(){
 const setup=select=>{
  if(select.multiple||select.dataset.searchEnhanced==='true'||!['memberUser','newTaskAssignee','teamDirectory','teamMemberUser','workflowDeveloper'].includes(select.id))return;
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
 document.querySelectorAll('select:is(#memberUser,#newTaskAssignee,#teamDirectory,#teamMemberUser,#workflowDeveloper)').forEach(setup);
 new MutationObserver(()=>document.querySelectorAll('select:is(#memberUser,#newTaskAssignee,#teamDirectory,#teamMemberUser,#workflowDeveloper):not([data-search-enhanced])').forEach(setup)).observe(document.body,{childList:true,subtree:true});
}
async function initialize(){
 bind();enableSearchableSelects();try{
 if(!token()){location.replace('/login.html');return;}
 const me=await api('/api/auth/me');state.user=me.user;$('currentUser').textContent=me.user?.name||me.user?.email||'';
 await loadProjects();await fetchDirectory();clearStory();
 await routeFromUrl();
 }catch(e){if(/auth|token|unauthoriz|sign.in/i.test(e.message))location.replace('/login.html');else notice(e.message);}
}
window.addEventListener('popstate',()=>routeFromUrl().catch(e=>notice(e.message)));
initialize();
})();
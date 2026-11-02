(function(){
'use strict';
const $=id=>document.getElementById(id), esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state={user:null,projects:[],projectId:'',context:null,tasks:[],deletedTasks:[],evidence:[],taskId:null,view:'overview'};
const token=()=>sessionStorage.getItem('aiTestPilotToken')||'';
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
function formPayload(form){return Object.fromEntries(new FormData(form).entries());}
function date(v){return v?new Date(v).toLocaleDateString():'—';}
function dateTime(v){return v?new Date(v).toLocaleString():'—';}
function display(v){return v?esc(v):'<span class="tn-muted">Not set</span>';}
function statusTag(s){const x=String(s||'PENDING');const c=x==='COMPLETED'?'success':x==='ON_HOLD'?'warn':x==='PENDING'?'':'danger';return '<span class="tn-tag '+c+'">'+esc(x.replaceAll('_',' '))+'</span>';}
function show(view){
 state.view=view;
 document.querySelectorAll('.tn-view').forEach(el=>el.classList.toggle('active',el.id==='view-'+view));
 document.querySelectorAll('[data-view]').forEach(el=>el.classList.toggle('active',el.dataset.view===view));
 const labels={overview:'Project overview',projects:'Projects',stories:'Stories & test generation',tasks:'Tasks & retesting',reports:'Test reports & evidence',team:'Team & roles'};
 $('pageTitle').textContent=labels[view]||'TestNexus';
 $('pageSubtitle').textContent=view==='stories'?'Write or reuse a project story; generation/review/execution stays in the existing Test Studio':view==='tasks'?'Attach evidence, collaborate, close/defer tasks and retest one or many using the existing runner':'Scope, documents, assignments and quality history in one place';
 clearNotice();
 window.history.replaceState(null,'','#'+view);
}
function requireProject(){if(!state.projectId)throw Error('Select or create a project first.');return state.projectId;}
async function loadProjects(){
 const d=await api('/api/projects');state.projects=d.projects||[];
 const picker=$('projectPicker'),prior=state.projectId||localStorage.getItem('testnexus:currentProject')||'';
 if(!state.projects.some(p=>p.id===prior))state.projectId=state.projects[0]?.id||'';else state.projectId=prior;
 picker.innerHTML='<option value="">Select project</option>'+state.projects.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>').join('');
 picker.value=state.projectId;
 localStorage.setItem('testnexus:currentProject',state.projectId);
 $('projectsBody').innerHTML=state.projects.map(p=>'<tr><td>'+display(p.reference_no)+'</td><td><strong>'+esc(p.name)+'</strong><div class="tn-muted">'+esc(p.description||'')+'</div></td><td>'+date(p.created_at)+'</td><td><button class="tn-link" data-open-project="'+esc(p.id)+'">Open →</button></td></tr>').join('')||'<tr><td colspan="4" class="tn-empty">No projects yet. Create your first project.</td></tr>';
 let loaded=false,lastError=null;
 const ordered=[state.projectId,...state.projects.map(p=>p.id)].filter((v,i,a)=>v&&a.indexOf(v)===i);
 for(const candidate of ordered){state.projectId=candidate;try{await loadWorkspace();loaded=true;break;}catch(e){lastError=e;}}
 if(!loaded&&lastError)throw lastError;
 picker.value=state.projectId;
 localStorage.setItem('testnexus:currentProject',state.projectId);
}
async function loadWorkspace(){
 const pid=state.projectId; state.context=null;state.tasks=[];state.evidence=[];
 if(!pid){['statStories','statRuns','statTasks','statDocs'].forEach(id=>$(id).textContent='0');return;}
 const results=await Promise.allSettled([api('/api/projects/'+encodeURIComponent(pid)+'/workspace'),api('/api/projects/'+encodeURIComponent(pid)+'/work-items'),api('/api/projects/'+encodeURIComponent(pid)+'/evidence')]);
 if(results[0].status!=='fulfilled')throw results[0].reason;
 state.context=results[0].value;
 state.tasks=results[1].status==='fulfilled'?results[1].value.workItems||[]:[];
 state.evidence=results[2].status==='fulfilled'?results[2].value.results||[]:[];
 renderAll();
 try{await loadWorkflow();}catch(err){console.warn('Project workflow settings unavailable:',err.message);}
 if(results[1].status!=='fulfilled'||results[2].status!=='fulfilled')notice('Some project data could not be loaded. Check your access and database configuration.','warning');
}
function renderAll(){renderOverview();renderStoryList();renderTasks();renderReports();renderTeam();}
function renderOverview(){
 const c=state.context,p=c.project;
 $('statStories').textContent=c.stories.length;$('statRuns').textContent=c.runs.length;
 $('statTasks').textContent=state.tasks.filter(t=>!t.deleted_at&&!['COMPLETED','CANCELLED'].includes(t.status)).length;
 $('statDocs').textContent=c.documents.length;$('profileName').textContent=p.name;$('profileReference').textContent='Reference No. '+(p.reference_no||'—');
 $('profileScope').innerHTML='<strong>Objectives</strong><div>'+display(p.objectives)+'</div><strong class="d-block mt-2">In scope</strong><div>'+display(p.scope_in)+'</div>';
 $('profileAcceptance').innerHTML='<strong>Excluded</strong><div>'+display(p.scope_out)+'</div><strong class="d-block mt-2">Acceptance</strong><div>'+display(p.acceptance_criteria)+'</div>';
 $('profileRules').innerHTML=display(p.business_rules);
 $('profileMeta').innerHTML='<strong>Dates:</strong> '+date(p.start_date)+' – '+date(p.end_date)+'<br><strong>Target:</strong> '+display(p.target_url)+'<br><strong>Technology:</strong> '+display(p.technology_stack);
 $('environmentList').innerHTML=c.environments.map(e=>'<div class="tn-kv"><span>'+esc(e.name)+(e.is_default?' ★':'')+'</span><span>'+esc(e.base_url)+'</span></div>').join('')||'<div class="tn-muted">No environment configured yet.</div>';
 $('projectFilesList').innerHTML=c.documents.map(d=>'<div class="tn-kv"><span>'+esc(d.category)+'</span><span><button class="tn-link" data-doc="'+esc(d.id)+'">'+esc(d.filename)+'</button> <small class="tn-muted">v'+esc(d.version)+' · '+Math.ceil(d.file_size/1024)+' KB</small></span></div>').join('')||'<div class="tn-muted">No documents attached yet.</div>';
}
function renderStoryList(){
 const c=state.context;
 $('storyList').innerHTML=c.stories.map(x=>'<div class="px-3 py-3 border-bottom d-flex justify-content-between gap-2"><div><strong>'+esc(x.title)+'</strong><div class="tn-muted">'+esc(x.reference_no||'')+' · '+esc(x.priority||'MEDIUM')+' · '+date(x.updated_at)+'</div></div><button class="btn btn-outline-secondary tn-btn align-self-start" data-story="'+esc(x.id)+'">Open</button></div>').join('')||'<div class="tn-empty">No stories yet. Start with a user journey and acceptance criteria.</div>';
 $('storyEnvironment').innerHTML='<option value="">Select environment</option>'+c.environments.map(e=>'<option value="'+esc(e.id)+'">'+esc(e.name)+(e.is_default?' (default)':'')+'</option>').join('');
}
function clearStory(){
 $('storyForm').reset();$('storyId').value='';$('storyFormTitle').textContent='Write business story';
 const chosen=state.context?.environments.find(e=>e.is_default)||state.context?.environments[0];
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
 const env=state.context.environments.find(e=>e.id===form.elements.namedItem('environmentId').value)||state.context.environments.find(e=>e.is_default)||state.context.environments[0];
 const project=state.context.project;
 const storyContext=[saved.story,saved.acceptance_criteria?'Acceptance criteria:\n'+saved.acceptance_criteria:'',project.scope_in?'Project scope:\n'+project.scope_in:'',project.scope_out?'Out of scope (do not test):\n'+project.scope_out:'',project.business_rules?'Business rules:\n'+project.business_rules:''].filter(Boolean).join('\n\n');
 const handoff={projectId:state.projectId,storyId:saved.id,story:storyContext,pagePaths:saved.page_paths||'',targetUrl:env?.base_url||project.target_url||'',environmentName:env?.name||'Test'};
 if(!handoff.targetUrl)throw Error('Configure a project environment or target URL before testing.');
 sessionStorage.setItem('testnexus:runnerHandoff',JSON.stringify(handoff));
 window.location.href='/';
}
function renderTasks(){
 let tasks=state.tasks.filter(x=>!x.deleted_at),status=$('taskStatusFilter').value;
 if(status==='DELETED'){$('tasksBody').innerHTML=(state.deletedTasks||[]).map(x=>'<tr><td></td><td><strong>'+esc(x.title)+'</strong></td><td>—</td><td>'+display(x.deleted_by_name)+'</td><td>'+dateTime(x.deleted_at)+'</td><td>'+statusTag('CANCELLED')+'</td><td><button class="tn-link" data-restore="'+esc(x.id)+'">Restore ↗</button></td></tr>').join('')||'<tr><td colspan="7" class="tn-empty">No deleted tasks.</td></tr>';return;}
 if(status)tasks=tasks.filter(t=>t.status===status);
 $('tasksBody').innerHTML=tasks.map(x=>'<tr><td><input type="checkbox" class="task-select" value="'+esc(x.id)+'" aria-label="Select '+esc(x.title)+'"></td><td><strong>'+esc(x.title)+'</strong><div class="tn-muted">'+esc(x.work_type)+'</div></td><td>'+display(x.external_case_id)+'</td><td>'+display(x.assigned_to_name)+'</td><td>'+dateTime(x.eta_at||x.due_at)+'</td><td>'+statusTag(x.status)+'</td><td><button class="tn-link" data-task="'+esc(x.id)+'">Details →</button></td></tr>').join('')||'<tr><td colspan="7" class="tn-empty">No tasks match this filter.</td></tr>';
 $('allTasks').checked=false;
}
function renderReports(){
 const runs=state.context.runs,passed=runs.reduce((n,r)=>n+Number(r.passed||0),0),failed=runs.reduce((n,r)=>n+Number(r.failed||0),0);
 $('reportPass').textContent=passed;$('reportFail').textContent=failed;
 $('runsBody').innerHTML=runs.map(r=>'<tr><td>#'+esc(r.run_number)+'<div class="tn-muted">'+esc(r.session_id||'')+'</div></td><td>'+display(r.environment)+'</td><td>'+display(r.executed_by_name)+'</td><td>'+dateTime(r.completed_at)+'</td><td>'+esc(r.passed)+'</td><td>'+esc(r.failed)+'</td><td><button class="tn-link" data-report="'+esc(r.session_id)+'">Open ↗</button></td></tr>').join('')||'<tr><td colspan="7" class="tn-empty">No saved execution history.</td></tr>';
 $('evidenceBody').innerHTML=state.evidence.map(x=>'<tr><td>'+esc(x.external_case_id||x.title||'Test')+'<div class="tn-muted">Run #'+esc(x.run_number)+'</div></td><td>'+statusTag(x.passed?'COMPLETED':'FAILED')+'</td><td>'+evidenceButtons(x.evidence_json)+'</td></tr>').join('')||'<tr><td colspan="3" class="tn-empty">No stored execution evidence yet.</td></tr>';
}
function evidenceButtons(meta){
 if(!meta||typeof meta!=='object')return '<span class="tn-muted">No evidence stored</span>';
 const e=meta.evidence||meta;
 return ['screenshotUrl','videoUrl'].filter(k=>typeof e[k]==='string'&&(e[k].startsWith('/api/artifacts/')||(/^\/api\/projects\/[^/]+\/run-evidence\//.test(e[k])))).map(k=>'<button class="tn-link me-3" data-evidence="'+esc(e[k])+'">'+(k==='videoUrl'?'▶ Video':'▧ Screenshot')+'</button>').join('')||'<span class="tn-muted">No retained media URL</span>';
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
function renderTeam(){
 $('teamBody').innerHTML=state.context.members.map(m=>'<tr><td>'+esc(m.display_name)+'</td><td>'+esc(m.email)+'</td><td>'+statusTag(m.project_role)+'</td></tr>').join('')||'<tr><td colspan="3" class="tn-empty">No members.</td></tr>';
 const list=state.users||state.context.members;
 $('memberUser').innerHTML='<option value="">Select user</option>'+list.map(x=>'<option value="'+esc(x.id||x.user_id)+'">'+esc(x.displayName||x.display_name||x.email)+'</option>').join('');
 $('newTaskAssignee').innerHTML='<option value="">Unassigned</option>'+state.context.members.map(m=>'<option value="'+esc(m.user_id)+'">'+esc(m.display_name)+'</option>').join('');
 $('workflowDeveloper').innerHTML='<option value="">Manual assignment</option>'+state.context.members.filter(m=>m.project_role==='DEVELOPER').map(m=>'<option value="'+esc(m.user_id)+'">'+esc(m.display_name)+'</option>').join('');
}
async function fetchDirectory(){
 try{const r=await api('/api/projects/'+encodeURIComponent(requireProject())+'/user-directory');state.users=r.users||[];renderTeam();}catch{state.users=null;renderTeam();}
}
async function openTask(id){
 const d=await api('/api/work-items/'+encodeURIComponent(id)+'/details');state.taskId=id;const t=d.task;
 $('drawerTitle').textContent=t.title;
 $('drawerInfo').innerHTML=(d.parent?'<div class="tn-kv"><span>Parent task</span><button class="tn-link" data-task="'+esc(d.parent.id)+'">'+esc(d.parent.title)+'</button></div>':'')+'<div class="tn-kv"><span>Type / Priority</span><span>'+esc(t.work_type)+' / '+esc(t.priority)+'</span></div><div class="tn-kv"><span>Test case</span><span>'+display(t.external_case_id)+'</span></div><div class="tn-kv"><span>Status</span><span>'+statusTag(t.status)+'</span></div><div class="tn-kv"><span>Due date</span><span>'+dateTime(t.due_at)+'</span></div><div class="tn-kv"><span>Closed</span><span>'+dateTime(t.closed_at)+' · '+(t.closed_by_name?'By '+esc(t.closed_by_name):'')+'</span></div><p class="tn-info mt-3">'+display(t.description)+'</p><label class="form-label" for="taskStatusChange">Update status</label><div class="d-flex gap-2"><select id="taskStatusChange" class="form-select">'+['PENDING','IN_PROGRESS','ON_HOLD','READY_FOR_RETEST','COMPLETED','CANCELLED'].map(v=>'<option '+(v===t.status?'selected':'')+'>'+v+'</option>').join('')+'</select><button class="btn btn-outline-secondary tn-btn" id="saveTaskStatus">Save</button></div>'+((t.deferred_until)?'<p class="tn-muted mt-2">Deferred until '+dateTime(t.deferred_until)+' · '+esc(t.deferred_reason||'')+'</p>':'');
 $('taskEta').value=t.eta_at?new Date(t.eta_at).toISOString().slice(0,16):'';
 $('taskDeferDate').value=t.deferred_until?new Date(t.deferred_until).toISOString().slice(0,16):'';
 $('taskReason').value='';
 $('drawerSubtasks').innerHTML=d.subtasks.map(x=>'<div class="tn-sub"><button class="tn-link" data-task="'+esc(x.id)+'">'+esc(x.title)+'</button><div>'+statusTag(x.status)+'</div></div>').join('')||'<p class="tn-muted">No subtasks yet.</p>';
 $('drawerAttachments').innerHTML=d.attachments.map(x=>'<div class="tn-kv"><span>'+date(x.created_at)+'</span><button class="tn-link" data-task-file="'+esc(x.id)+'">'+esc(x.filename)+'</button></div>').join('')||'<p class="tn-muted">No attachments yet.</p>';
 $('drawerComments').innerHTML=d.comments.map(x=>'<div class="tn-comment"><strong>'+esc(x.user_name||'User')+'</strong> <span class="tn-muted">'+dateTime(x.created_at)+'</span><p>'+esc(x.comment)+'</p></div>').join('')||'<p class="tn-muted mt-2">No comments.</p>';
 const history=await api('/api/projects/'+encodeURIComponent(requireProject())+'/task-test-history?taskId='+encodeURIComponent(id));
 $('drawerInfo').innerHTML+='<h3 class="mt-3">Task test history</h3>'+(history.results.length?history.results.map(r=>'<div class="tn-sub">Run #'+esc(r.run_number)+' · '+esc(r.tester||'Unknown tester')+' · '+dateTime(r.completed_at)+' · '+(r.passed?'Passed':'Failed')+'<div>'+evidenceButtons(r.evidence_json)+'</div></div>').join(''):'<p class="tn-muted">No linked execution history yet.</p>');
 $('drawerHistory').innerHTML=d.history.map(h=>'<div class="mb-2">'+esc(h.event_type)+' · '+dateTime(h.created_at)+' · '+esc(h.by_name||'')+(h.comment?' — '+esc(h.comment):'')+'</div>').join('')||'No activity';
 const related=state.evidence.filter(x=>String(x.session_id)===String(t.session_id)&&String(x.external_case_id)===String(t.external_case_id)).slice(0,2);
 if(related.length)$('drawerInfo').innerHTML+='<h3 class="mt-3">Run evidence</h3>'+related.map(x=>'<div class="tn-sub">'+(x.passed?'Passed':'Failed')+' · '+dateTime(x.completed_at)+'<div>'+evidenceButtons(x.evidence_json)+'</div></div>').join('');
 $('taskShade').classList.add('open');$('taskDrawer').classList.add('open');
}
function closeTask(){$('taskDrawer').classList.remove('open');$('taskShade').classList.remove('open');state.taskId=null;}
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
 if(kind==='project'){body.category=$('documentCategory').value;body.version=$('documentVersion').value;}
 const path=kind==='project'?'/api/projects/'+encodeURIComponent(requireProject())+'/documents':'/api/work-items/'+encodeURIComponent(state.taskId)+'/attachments';
 await api(path,{method:'POST',body:JSON.stringify(body)});
}
async function uploadMany(files,kind){
 try{if(kind==='task'&&!state.taskId)throw Error('Open a task first.');for(const file of files)await fileUpload(file,kind);await loadWorkspace();if(kind==='task'&&state.taskId)await openTask(state.taskId);notice(files.length+' file(s) uploaded to the project database.','success');}catch(e){notice(e.message);}
}
function dropZone(zoneId,inputId,kind){
 const zone=$(zoneId),input=$(inputId);
 zone.onclick=()=>input.click();zone.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();input.click();}};
 for(const event of ['dragenter','dragover'])zone.addEventListener(event,e=>{e.preventDefault();zone.classList.add('drag');});
 for(const event of ['dragleave','drop'])zone.addEventListener(event,e=>{e.preventDefault();zone.classList.remove('drag');});
 zone.addEventListener('drop',e=>uploadMany([...e.dataTransfer.files],kind));
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
function bind(){
 document.querySelectorAll('[data-view]').forEach(el=>el.onclick=()=>show(el.dataset.view));
 document.querySelectorAll('[data-go]').forEach(el=>el.onclick=()=>{show(el.dataset.go);if(el.dataset.go==='stories')clearStory();});
 $('projectPicker').onchange=async e=>{closeTask();state.projectId=e.target.value;localStorage.setItem('testnexus:currentProject',state.projectId);try{await loadWorkspace();}catch(err){notice(err.message);}};
 $('newProjectForm').onsubmit=async e=>{e.preventDefault();try{const vals=formPayload(e.target),d=await api('/api/projects',{method:'POST',body:JSON.stringify({name:vals.name,description:vals.description})});await api('/api/projects/'+encodeURIComponent(d.project.id)+'/profile',{method:'PATCH',body:JSON.stringify({referenceNo:vals.referenceNo,startDate:vals.startDate,endDate:vals.endDate})});state.projectId=d.project.id;e.target.reset();await loadProjects();show('overview');notice('Project created successfully.','success');}catch(err){notice(err.message);}};
 $('environmentForm').onsubmit=async e=>{e.preventDefault();try{const vals=formPayload(e.target);await api('/api/projects/'+encodeURIComponent(requireProject())+'/environments',{method:'POST',body:JSON.stringify({...vals,isDefault:!!e.target.elements.namedItem('isDefault').checked})});e.target.reset();await loadWorkspace();notice('Environment saved.','success');}catch(err){notice(err.message);}};
 $('storyForm').onsubmit=async e=>{e.preventDefault();try{await saveStory();}catch(err){notice(err.message);}};
 $('storyClear').onclick=clearStory;
 $('storyLaunch').onclick=async()=>{try{await launchStory();}catch(err){notice(err.message);}};
 $('workflowForm').onsubmit=async e=>{e.preventDefault();try{
 const f=e.target;await api('/api/projects/'+encodeURIComponent(requireProject())+'/workflow',{method:'PUT',body:JSON.stringify({autoCreateFailedTasks:f.elements.namedItem('autoCreateFailedTasks').checked,autoCloseVerifiedRetests:f.elements.namedItem('autoCloseVerifiedRetests').checked,defaultDeveloper:$('workflowDeveloper').value||null})});
 await loadWorkflow();notice('Project workflow configuration saved.','success');
 }catch(err){notice(err.message);}};
 $('newTaskForm').onsubmit=async e=>{e.preventDefault();try{
 const v=formPayload(e.target);v.dueAt=v.dueAt?new Date(v.dueAt).toISOString():null;v.assignedTo=v.assignedTo||null;
 await api('/api/projects/'+encodeURIComponent(requireProject())+'/work-items',{method:'POST',body:JSON.stringify(v)});
 e.target.reset();await loadWorkspace();notice('Task created.','success');
 }catch(err){notice(err.message);}};
 $('taskStatusFilter').onchange=async()=>{if($('taskStatusFilter').value==='DELETED'){try{state.deletedTasks=(await api('/api/projects/'+encodeURIComponent(requireProject())+'/deleted-tasks')).tasks||[];}catch(err){notice(err.message);state.deletedTasks=[];}}renderTasks();};
 $('evidenceModal').addEventListener('hidden.bs.modal',()=>{const v=$('evidencePreview');v.replaceChildren();if(evidenceObjectUrl)URL.revokeObjectURL(evidenceObjectUrl);evidenceObjectUrl='';});
 $('allTasks').onchange=e=>document.querySelectorAll('.task-select').forEach(x=>x.checked=e.target.checked);
 $('batchRetest').onclick=async()=>{const ids=[...document.querySelectorAll('.task-select:checked')].map(x=>x.value);if(!ids.length){notice('Select one or more tasks to retest.','warning');return;}try{await retest(ids);}catch(e){notice(e.message);}};
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
 bootstrap.Modal.getOrCreateInstance($('profileModal')).show();
 };
 $('profileForm').onsubmit=async e=>{e.preventDefault();try{await api('/api/projects/'+encodeURIComponent(requireProject())+'/profile',{method:'PATCH',body:JSON.stringify(formPayload(e.target))});bootstrap.Modal.getOrCreateInstance($('profileModal')).hide();await loadWorkspace();notice('Project profile saved.','success');}catch(err){notice(err.message);}};
 dropZone('projectDrop','projectFiles','project');dropZone('taskDrop','taskFiles','task');
 document.body.addEventListener('click',async e=>{
 const p=e.target.closest('[data-open-project]');if(p){state.projectId=p.dataset.openProject;$('projectPicker').value=state.projectId;localStorage.setItem('testnexus:currentProject',state.projectId);try{await loadWorkspace();show('overview');}catch(err){notice(err.message);}return;}
 const st=e.target.closest('[data-story]');if(st){selectStory(st.dataset.story);return;}
 const t=e.target.closest('[data-task]');if(t){try{await openTask(t.dataset.task);}catch(err){notice(err.message);}return;}
 const doc=e.target.closest('[data-doc]');if(doc){try{await download('/api/projects/'+encodeURIComponent(requireProject())+'/documents/'+encodeURIComponent(doc.dataset.doc)+'/download');}catch(err){notice(err.message);}return;}
 const file=e.target.closest('[data-task-file]');if(file){try{await download('/api/work-items/'+encodeURIComponent(state.taskId)+'/attachments/'+encodeURIComponent(file.dataset.taskFile)+'/download');}catch(err){notice(err.message);}return;}
 const evidence=e.target.closest('[data-evidence]');if(evidence){try{await previewEvidence(evidence.dataset.evidence);}catch(err){notice(err.message);}return;}
 const restore=e.target.closest('[data-restore]');if(restore){try{await api('/api/work-items/'+encodeURIComponent(restore.dataset.restore)+'/lifecycle',{method:'PATCH',body:JSON.stringify({action:'RESTORE'})});state.deletedTasks=(await api('/api/projects/'+encodeURIComponent(requireProject())+'/deleted-tasks')).tasks||[];renderTasks();notice('Task restored.','success');}catch(err){notice(err.message);}return;}
 const report=e.target.closest('[data-report]');if(report){try{await download('/api/reports/'+encodeURIComponent(report.dataset.report));}catch(err){notice(err.message);}}
 });
}
async function initialize(){
 bind();try{
 if(!token()){notice('Sign in through Run Tests first, then return Home. Project data is served from your TestNexus database.','warning');return;}
 const me=await api('/api/auth/me');state.user=me.user;$('currentUser').textContent=me.user?.name||me.user?.email||'';
 await loadProjects();await fetchDirectory();clearStory();
 const hash=window.location.hash.replace('#','');if(['overview','projects','stories','tasks','reports','team'].includes(hash))show(hash);
 }catch(e){notice(e.message+' · Use the existing TestNexus sign-in screen to authenticate.');}
}
initialize();
})();
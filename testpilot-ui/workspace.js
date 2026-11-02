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
const UI_KEY='testnexus:ui-preferences';
function prefsRead(){try{return JSON.parse(localStorage.getItem(UI_KEY)||'{}')}catch{return {}}}
function applyPreferences(){const p=prefsRead();const mode=['light','dark','system'].includes(p.theme)?p.theme:'light';const actual=mode==='system'&&window.matchMedia?.('(prefers-color-scheme: dark)').matches?'dark':mode==='system'?'light':mode;document.body.dataset.theme=actual;document.body.dataset.density=p.density==='compact'?'compact':'comfortable';$('themePreference').value=mode;$('densityPreference').value=document.body.dataset.density;}
function savePreferences(){localStorage.setItem(UI_KEY,JSON.stringify({theme:$('themePreference').value,density:$('densityPreference').value}));applyPreferences();}
async function loadTaskLinks(id){const box=$('drawerTestLinks');box.textContent='Loading linked cases…';try{const d=await api('/api/work-items/'+encodeURIComponent(id)+'/test-links');if(state.taskId!==id)return;const canEdit=['PROJECT_MANAGER','QA'].includes(state.taskRole);box.innerHTML=d.links.length?d.links.map(x=>'<div class="tn-sub tn-row"><span><strong>'+esc(x.external_case_id)+'</strong><span class="tn-muted d-block">Session '+esc(x.session_id)+'</span></span><button class="tn-link" data-unlink-test="'+esc(x.id)+'" aria-label="Unlink case '+esc(x.external_case_id)+'">Unlink</button></div>').join(''):'<p class="tn-muted">No reusable test cases linked. Use the form below to add one.</p>'; }catch(err){box.textContent='Unable to load linked cases: '+err.message;}}
function formPayload(form){return Object.fromEntries(new FormData(form).entries());}
function date(v){return v?new Date(v).toLocaleDateString():'—';}
function dateTime(v){return v?new Date(v).toLocaleString():'—';}
function display(v){return v?esc(v):'<span class="tn-muted">Not set</span>';}
function statusTag(s){const x=String(s||'PENDING');const c=x==='COMPLETED'?'success':x==='ON_HOLD'?'warn':x==='PENDING'?'':'danger';return '<span class="tn-tag '+c+'">'+esc(x.replaceAll('_',' '))+'</span>';}
function show(view){
 state.view=view;
 document.querySelectorAll('.tn-view').forEach(el=>el.classList.toggle('active',el.id==='view-'+view));
 document.querySelectorAll('[data-view]').forEach(el=>{const active=el.dataset.view===view;el.classList.toggle('active',active);if(active)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});
 const labels={overview:'Project overview',projects:'Projects',stories:'Stories & test generation',tasks:'Tasks & retesting',reports:'Test reports & evidence',inventory:'Test inventory & audit',team:'Team & roles'};
 $('pageTitle').textContent=labels[view]||'TestNexus';
 $('pageSubtitle').textContent=view==='stories'?'Write or reuse a project story; generation/review/execution stays in the existing Test Studio':view==='tasks'?'Attach evidence, collaborate, close/defer tasks and retest one or many using the existing runner':'Scope, documents, assignments and quality history in one place';
 clearNotice();
 if(view==='reports'&&state.projectId)loadSavedReports().catch(e=>notice(e.message));
 if(view==='inventory'&&state.projectId)loadInventory().catch(e=>notice(e.message));
 if(view==='team'&&state.projectId)loadTeams().catch(e=>notice(e.message));
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
 const toggles=[['newProjectForm',globalManager],['memberForm',projectManager],['userForm',globalManager],['environmentForm',projectManager],['newTaskForm',canReview],['storyForm',canReview]];
 for(const [id,allowed] of toggles){const form=$(id);if(!form)continue;form.querySelectorAll('input,select,textarea,button').forEach(el=>{el.disabled=!allowed;});if(['newProjectForm','memberForm','userForm'].includes(id))form.hidden=!allowed;}
 $('editProfile').disabled=!projectManager;
 $('projectRunAll').disabled=!canReview;
 if(!canReview)$('batchRetest').disabled=true;
 document.querySelectorAll('[data-go="projects"]').forEach(el=>{if(el.textContent.includes('New project'))el.hidden=!globalManager;});
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
async function launchTaskTest(){const project=requireProject(),taskId=state.taskId;if(!taskId)throw Error('Select a task first.');const detail=await api('/api/work-items/'+encodeURIComponent(taskId)+'/details');const task=detail.task;if(!['QA','PROJECT_MANAGER'].includes(detail.projectRole))throw Error('QA or project manager role required.');const env=state.context.environments.find(e=>e.is_default)||state.context.environments[0];const profile=state.context.project;const targetUrl=env?.base_url||profile.target_url;if(!targetUrl)throw Error('Set a project target URL or environment before testing.');const story=['Test task: '+task.title,task.description||'',task.external_case_id?'Linked test case: '+task.external_case_id:'',profile.business_rules?'Project business rules: '+profile.business_rules:'',profile.scope_in?'In scope: '+profile.scope_in:''].filter(Boolean).join('\n\n');sessionStorage.setItem('testnexus:runnerHandoff',JSON.stringify({projectId:project,taskId,story,targetUrl,environmentName:env?.name||'Test'}));window.location.href='/';}
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
 $('tasksBody').innerHTML=deleted.map(x=>'<tr><td></td><td><strong>'+esc(x.title)+'</strong></td><td>—</td><td>'+display(x.deleted_by_name)+'</td><td>'+dateTime(x.deleted_at)+'</td><td>'+statusTag('CANCELLED')+'</td><td><button class="tn-link" data-restore="'+esc(x.id)+'">Restore</button></td></tr>').join('')||'<tr><td colspan="7" class="tn-empty">No deleted tasks match your search.</td></tr>';
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
 $('tasksBody').innerHTML=tasks.map(x=>'<tr><td><input type="checkbox" class="task-select" value="'+esc(x.id)+'" aria-label="Select '+esc(x.title)+'"></td><td><div class="tn-task-name" style="--task-depth:'+Math.min(x._depth||0,8)+'">'+(x._depth?' <span class="tn-tree-mark" aria-hidden="true">↳</span>':'')+'<div><button class="tn-link tn-task-title" data-task="'+esc(x.id)+'">'+esc(x.title)+'</button><div class="tn-muted">'+esc(x.work_type)+'</div></div></div></td><td>'+display(x.external_case_id)+'</td><td>'+display(x.assigned_to_name)+'</td><td>'+dateTime(x.eta_at||x.due_at)+'</td><td>'+statusTag(x.status)+'</td><td><button class="tn-link" data-task="'+esc(x.id)+'">Details</button></td></tr>').join('')||'<tr><td colspan="7" class="tn-empty">No tasks match your filters. Clear the search or select another status.</td></tr>';
 $('taskVisibleCount').textContent=tasks.length;updateTaskSelection();
}
async function loadSavedReports(){const project=requireProject(),kind=$('savedReportKind').value;const data=await api('/api/projects/'+encodeURIComponent(project)+'/report-snapshots'+(kind?'?kind='+encodeURIComponent(kind):''));$('savedReportsBody').innerHTML=data.reports.map(r=>'<tr><td>'+esc(r.report_kind.replaceAll('_',' '))+'</td><td>'+esc(r.external_case_id||r.run_id||r.session_id)+'</td><td>'+esc(r.revision)+'</td><td>'+dateTime(r.created_at)+'</td><td><button type="button" class="tn-link" data-saved-report="'+esc(r.id)+'">View</button></td></tr>').join('')||'<tr><td colspan="5" class="tn-empty">No saved reports for this selection.</td></tr>';}
async function openSavedReport(id){const project=requireProject(),data=await api('/api/projects/'+encodeURIComponent(project)+'/report-snapshots/'+encodeURIComponent(id));const detail=$('savedReportDetail');detail.replaceChildren();const title=document.createElement('h3');title.className='h6';title.textContent=data.report.report_kind.replaceAll('_',' ')+' · revision '+data.report.revision;const pre=document.createElement('pre');pre.className='p-3 rounded border';pre.style.cssText='white-space:pre-wrap;max-height:400px;overflow:auto';pre.textContent=JSON.stringify(data.report.report_json,null,2);detail.append(title,pre);if(data.hasHtml){const link=document.createElement('button');link.className='btn btn-outline-primary btn-sm';link.textContent='Open stored HTML report';link.onclick=async()=>{const authToken=token();const url='/api/projects/'+encodeURIComponent(project)+'/report-snapshots/'+encodeURIComponent(id)+'?format=html';const response=await fetch(url,{headers:{Authorization:'Bearer '+authToken}});if(!response.ok)throw new Error('Report unavailable');const html=await response.text();const frame=document.createElement('iframe');frame.setAttribute('sandbox','');frame.title='Stored execution report';frame.style.cssText='width:100%;height:650px;border:1px solid #ccd5e3;border-radius:8px';frame.srcdoc=html;detail.append(frame);};detail.append(link);}}
function renderReports(){
 const runs=state.context.runs,passed=runs.reduce((n,r)=>n+Number(r.passed||0),0),failed=runs.reduce((n,r)=>n+Number(r.failed||0),0);
 $('reportPass').textContent=passed;$('reportFail').textContent=failed;
 const total=passed+failed,rate=total?Math.round(passed/total*100):0;
 $('qualitySummary').innerHTML=total?'<div class="tn-row mb-2"><strong>'+rate+'% pass rate</strong><span class="tn-muted">'+total+' recorded results across '+runs.length+' runs</span></div><div class="tn-quality-track" role="img" aria-label="'+rate+' percent passed"><div class="tn-quality-pass" style="width:'+rate+'%"></div><div class="tn-quality-fail" style="width:'+(100-rate)+'%"></div></div>':'<div class="tn-empty">No recorded test outcomes. Run approved tests to build your quality baseline.</div>';
 $('runTimeline').innerHTML=runs.slice(0,12).map(x=>{const media=state.evidence.filter(y=>String(y.session_id)===String(x.session_id)&&String(y.run_number)===String(x.run_number)).slice(0,2).map(y=>evidenceButtons(y.evidence_json)).filter(y=>!y.includes('No retained')&&!y.includes('No evidence')).join('');return '<div class="tn-timeline-item"><div><strong>Run #'+esc(x.run_number)+'</strong><div class="tn-timeline-meta">'+dateTime(x.completed_at)+' · '+esc(x.executed_by_name||'Unknown tester')+' · '+esc(x.environment||'Default environment')+'</div><div class="tn-inline-actions mt-1">'+media+'</div></div><span>'+esc(x.passed)+' passed · '+esc(x.failed)+' failed</span></div>';}).join('');
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
async function loadInventory(){const project=requireProject();const [inventory,audit]=await Promise.all([api('/api/projects/'+encodeURIComponent(project)+'/test-inventory'),api('/api/projects/'+encodeURIComponent(project)+'/audit')]);$('inventoryCases').innerHTML=inventory.cases.map(x=>'<tr><td>'+esc(x.story_reference||'Unlinked')+'</td><td>'+esc(x.title)+'<div class="tn-muted">'+esc(x.external_case_id)+'</div></td><td>'+esc(x.priority||'—')+'</td><td>'+esc(x.session_id)+'</td></tr>').join('')||'<tr><td colspan="4">No cases yet.</td></tr>';$('inventoryStories').innerHTML=inventory.stories.map(x=>'<tr><td>'+esc(x.reference_no||'')+' · '+esc(x.title)+'</td><td>'+x.generation_count+'</td><td>'+x.case_count+'</td><td>'+x.execution_count+'</td></tr>').join('')||'<tr><td colspan="4">No stories yet.</td></tr>';$('inventoryAudit').innerHTML=audit.events.map(x=>'<tr><td>'+esc(x.event_type)+'</td><td>'+esc(x.actor_name||'System')+'</td><td>'+dateTime(x.created_at)+'</td></tr>').join('')||'<tr><td colspan="3">No recorded audit events yet.</td></tr>';}
async function loadTeams(){const project=requireProject();const [all,attached,assignees,teamMembers]=await Promise.all([api('/api/teams'),api('/api/projects/'+encodeURIComponent(project)+'/teams'),api('/api/projects/'+encodeURIComponent(project)+'/team-assignees'),api('/api/projects/'+encodeURIComponent(project)+'/team-members')]);$('teamDirectory').innerHTML='<option value="">Select team</option>'+all.teams.map(t=>'<option value="'+esc(t.id)+'">'+esc(t.name)+'</option>').join('');$('teamMemberTeam').innerHTML='<option value="">Select team</option>'+attached.teams.map(t=>'<option value="'+esc(t.id)+'">'+esc(t.name)+'</option>').join('');$('teamMemberUser').innerHTML='<option value="">Select user</option>'+state.context.members.map(m=>'<option value="'+esc(m.user_id)+'">'+esc(m.display_name)+'</option>').join('');$('projectTeams').innerHTML=attached.teams.map(t=>'<div class="d-flex align-items-center justify-content-between py-2 border-bottom"><strong>'+esc(t.name)+'</strong><button class="btn btn-sm btn-outline-danger" data-detach-team="'+esc(t.id)+'">Detach</button></div>').join('')||'<p class="tn-muted">No teams attached.</p>';$('projectTeamMembers').textContent=teamMembers.members.length?teamMembers.members.map(m=>m.display_name+' ('+(attached.teams.find(t=>t.id===m.team_id)?.name||'Team')+')').join(' · '):'No members assigned to these teams yet.';$('newTaskAssignee').innerHTML='<option value="">Unassigned</option>'+assignees.users.map(u=>'<option value="'+esc(u.id)+'">'+esc(u.display_name)+'</option>').join('');}
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
 $('teamMemberForm').onsubmit=async e=>{e.preventDefault();try{const data=formPayload(e.target);await api('/api/teams/'+encodeURIComponent(data.teamId)+'/members',{method:'POST',body:JSON.stringify({userId:data.userId,projectId:requireProject()})});await loadTeams();notice('Team member added.','success');}catch(err){notice(err.message);}};
 $('teamAttachForm').onsubmit=async e=>{e.preventDefault();try{await api('/api/projects/'+encodeURIComponent(requireProject())+'/teams',{method:'POST',body:JSON.stringify(formPayload(e.target))});await loadTeams();notice('Team attached.','success');}catch(err){notice(err.message);}};
 $('projectTeams').onclick=async e=>{const btn=e.target.closest('[data-detach-team]');if(!btn)return;try{await api('/api/projects/'+encodeURIComponent(requireProject())+'/teams/'+encodeURIComponent(btn.dataset.detachTeam),{method:'DELETE'});await loadTeams();}catch(err){notice(err.message);}};

 applyPreferences();
 $('uiPreferences').onclick=()=>{const panel=$('preferencesPanel');panel.hidden=!panel.hidden;$('uiPreferences').setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden)$('themePreference').focus();};
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('preferencesPanel').hidden){$('preferencesPanel').hidden=true;$('uiPreferences').setAttribute('aria-expanded','false');$('uiPreferences').focus();}});
 document.addEventListener('click',e=>{if(!$('preferencesPanel').hidden&&!e.target.closest('#preferencesPanel,#uiPreferences')){$('preferencesPanel').hidden=true;$('uiPreferences').setAttribute('aria-expanded','false');}});
 $('themePreference').onchange=savePreferences;$('densityPreference').onchange=savePreferences;
 window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change',()=>{if(prefsRead().theme==='system')applyPreferences()});
 $('testLinkForm').onsubmit=async e=>{e.preventDefault();try{const id=state.taskId;if(!id)throw Error('Open a task first.');await api('/api/work-items/'+encodeURIComponent(id)+'/test-links',{method:'POST',body:JSON.stringify(formPayload(e.target))});await loadTaskLinks(id);notice('Test case linked to task.','success');}catch(err){notice(err.message);}};
 $('drawerTestLinks').addEventListener('click',async e=>{const b=e.target.closest('[data-unlink-test]');if(!b)return;try{const id=state.taskId;await api('/api/work-items/'+encodeURIComponent(id)+'/test-links/'+encodeURIComponent(b.dataset.unlinkTest),{method:'DELETE'});await loadTaskLinks(id);notice('Test case unlinked.','success');}catch(err){notice(err.message);}});

 document.addEventListener('keydown',e=>{if(!$('taskDrawer').classList.contains('open'))return;if(e.key==='Escape'){e.preventDefault();closeTask();}else if(e.key==='Tab'){const items=[...$('taskDrawer').querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]')].filter(x=>x.getClientRects().length);if(!items.length)return;const first=items[0],last=items[items.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
 document.querySelectorAll('[data-view]').forEach(el=>el.onclick=()=>show(el.dataset.view));
 document.querySelectorAll('[data-go]').forEach(el=>el.onclick=()=>{show(el.dataset.go);if(el.dataset.go==='stories')clearStory();});
 $('projectPicker').onchange=async e=>{closeTask();state.projectId=e.target.value;localStorage.setItem('testnexus:currentProject',state.projectId);try{await loadWorkspace();}catch(err){notice(err.message);}};
 const projectFileInput=$('newProjectFiles'),projectDrop=$('newProjectDrop');
 projectDrop.onclick=()=>projectFileInput.click();projectDrop.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();projectFileInput.click();}};
 for(const event of ['dragenter','dragover'])projectDrop.addEventListener(event,e=>{e.preventDefault();projectDrop.classList.add('drag');});
 for(const event of ['dragleave','drop'])projectDrop.addEventListener(event,e=>{e.preventDefault();projectDrop.classList.remove('drag');});
 projectDrop.addEventListener('drop',e=>{const dt=new DataTransfer();for(const file of e.dataTransfer.files)dt.items.add(file);projectFileInput.files=dt.files;projectFileInput.dispatchEvent(new Event('change'));});
 projectFileInput.onchange=()=>{$('newProjectFileNames').textContent=[...projectFileInput.files].map(f=>f.name).join(', ');};
 $('newProjectForm').onsubmit=async e=>{e.preventDefault();try{const vals=formPayload(e.target),d=await api('/api/projects',{method:'POST',body:JSON.stringify({name:vals.name,description:vals.description})});await api('/api/projects/'+encodeURIComponent(d.project.id)+'/profile',{method:'PATCH',body:JSON.stringify({referenceNo:vals.referenceNo,startDate:vals.startDate,endDate:vals.endDate})});state.projectId=d.project.id;const files=[...projectFileInput.files];e.target.reset();$('newProjectFileNames').textContent='';await loadProjects();show('overview');if(files.length)await uploadMany(files,'project');notice('Project created'+(files.length?' with '+files.length+' attachment(s)':'')+'.','success');}catch(err){notice(err.message);}};
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
 bootstrap.Modal.getOrCreateInstance($('profileModal')).show();
 };
 $('profileForm').onsubmit=async e=>{e.preventDefault();try{await api('/api/projects/'+encodeURIComponent(requireProject())+'/profile',{method:'PATCH',body:JSON.stringify(formPayload(e.target))});bootstrap.Modal.getOrCreateInstance($('profileModal')).hide();await loadWorkspace();notice('Project profile saved.','success');}catch(err){notice(err.message);}};
 dropZone('projectDrop','projectFiles','project');dropZone('taskDrop','taskFiles','task');
 document.body.addEventListener('click',async e=>{
 const p=e.target.closest('[data-open-project]');if(p){state.projectId=p.dataset.openProject;$('projectPicker').value=state.projectId;localStorage.setItem('testnexus:currentProject',state.projectId);try{await loadWorkspace();show('overview');}catch(err){notice(err.message);}return;}
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
  if(select.multiple||select.dataset.searchEnhanced==='true'||select.closest('#preferencesPanel'))return;
  select.dataset.searchEnhanced='true';
  const search=document.createElement('input');
  search.type='search';search.className='form-control form-control-sm mb-1';
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
 document.querySelectorAll('select').forEach(setup);
 new MutationObserver(()=>document.querySelectorAll('select:not([data-search-enhanced])').forEach(setup)).observe(document.body,{childList:true,subtree:true});
}
async function initialize(){
 bind();enableSearchableSelects();try{
 if(!token()){notice('Sign in through Run Tests first, then return Home. Project data is served from your TestNexus database.','warning');return;}
 const me=await api('/api/auth/me');state.user=me.user;$('currentUser').textContent=me.user?.name||me.user?.email||'';
 await loadProjects();await fetchDirectory();clearStory();
 const hash=window.location.hash.replace('#','');if(['overview','projects','stories','tasks','reports','inventory','team'].includes(hash))show(hash);else show('projects');
 }catch(e){notice(e.message+' · Use the existing TestNexus sign-in screen to authenticate.');}
}
initialize();
})();
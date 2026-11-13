/* Context-first entry into Test Studio, from project cards, stories and task rows. */
(function(){
 'use strict';
 const token=()=>sessionStorage.getItem('aiTestPilotToken')||'';
 const $=id=>document.getElementById(id);
 const api=async path=>{
  const response=await fetch(path,{headers:token()?{Authorization:'Bearer '+token()}:{}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.reply||'Unable to load project context ('+response.status+').');
  return data;
 };
 function error(message){
  const n=$('notice');if(!n)return;
  n.textContent=message;n.className='alert alert-danger';n.scrollIntoView({block:'nearest'});
 }
 async function start(projectId,sourceType,recordId,environmentId,existing=false){
  if(!projectId)throw Error('Open a project before starting tests.');
  const detail=await api('/api/projects/'+encodeURIComponent(projectId)+'/workspace');
  if(!['PROJECT_MANAGER','QA'].includes(detail.projectRole))throw Error('QA or project manager access is required to start testing.');
  let record=null;
  if(sourceType==='story'){
   record=(detail.stories||[]).find(x=>String(x.id)===String(recordId));
   if(!record)throw Error('The selected story is not available in this project.');
  }
  if(sourceType==='task'){
   const task=await api('/api/work-items/'+encodeURIComponent(recordId)+'/details');
   record=task.task;
   if(!record||String(record.project_id)!==String(projectId)||record.deleted_at)throw Error('The selected task is not available in this project.');
  }
  // An environment chosen in the project's "Start testing" box wins; otherwise story → default → first active.
  const env=(environmentId&&(detail.environments||[]).find(x=>x.is_active!==false&&String(x.id)===String(environmentId)))
   ||(sourceType==='story'&&(detail.environments||[]).find(x=>x.is_active!==false&&String(x.id)===String(record?.environment_id)))
   ||(detail.environments||[]).find(x=>x.is_active!==false&&x.is_default)||(detail.environments||[]).find(x=>x.is_active!==false);
  if((detail.environments||[]).length&&!env)throw Error('All project environments are disabled. Enable an environment before starting new testing.');
  const targetUrl=env?.base_url||detail.project?.target_url||'';
  if(!targetUrl)throw Error('Set the project application URL or default environment in Project Details before starting testing.');
  const handoff={projectId,sourceType,targetUrl,environmentName:env?.name||'Test',environmentId:env?.id||null};
  if(sourceType==='story')handoff.storyId=record.id;
  if(sourceType==='task')handoff.taskId=record.id;
  sessionStorage.setItem('testnexus:runnerHandoff',JSON.stringify(handoff));
  sessionStorage.setItem('testnexus:runnerOrigin','project');
  sessionStorage.removeItem('testnexus:runnerSelection');
  // A task made from a failed test: ▶ re-runs that same saved test case (no generation).
  if(sourceType==='task'&&record.origin==='FAILED_TEST'&&record.session_id&&record.external_case_id){
   window.location.assign('/runner?mode=existing&projectId='+encodeURIComponent(projectId)+'&sessionId='+encodeURIComponent(record.session_id)+'&caseId='+encodeURIComponent(record.external_case_id));
   return;
  }
  // "Run existing tests": the testing page lists the saved cases instead of generating (existing-tests.js).
  window.location.assign('/runner?mode='+(existing?'existing':'new')+'&projectId='+encodeURIComponent(projectId)+(handoff.storyId?'&storyId='+encodeURIComponent(handoff.storyId):''));
 }
 const post=async(path,body)=>{
  const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json',...(token()?{Authorization:'Bearer '+token()}:{})},body:JSON.stringify(body||{})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.reply||'Request failed ('+response.status+').');
  return data;
 };
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const when=v=>v?new Date(v).toLocaleString('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true}):'';
 // "Run existing tests or generate new ones?" — shown when the project / story already has approved test cases.
 function choiceDialog(){
  let d=$('runChoiceDialog');if(d)return d;
  d=document.createElement('dialog');d.id='runChoiceDialog';d.className='tn-dialog tn-choice-dialog';d.setAttribute('aria-labelledby','runChoiceTitle');
  d.innerHTML='<div class="tn-dialog-head"><div><h2 id="runChoiceTitle">Tests already exist</h2><div class="tn-muted" id="runChoiceSub"></div></div><button type="button" class="tn-dialog-close" data-choice="cancel" aria-label="Close">×</button></div>'+
   '<div class="tn-dialog-body"><p id="runChoiceText" class="tn-choice-text"></p><div id="runChoiceProgress" class="tn-choice-progress" aria-live="polite" hidden></div></div>'+
   '<div class="tn-dialog-foot"><button type="button" class="btn btn-outline-secondary tn-btn" data-choice="cancel">Cancel</button><div class="d-flex gap-2"><button type="button" class="btn btn-outline-primary tn-btn" data-choice="generate">✨ Generate new tests</button><button type="button" class="btn btn-primary tn-btn" data-choice="run">▶ Run existing tests</button></div></div>';
  document.body.appendChild(d);
  return d;
 }
 // Ask first when approved tests exist; otherwise go straight to generation (as before).
 async function chooseAndStart(projectId,sourceType,recordId,environmentId,label){
  if(sourceType==='task')return start(projectId,sourceType,recordId,environmentId);
  let plan=null;
  try{plan=await post('/api/projects/'+encodeURIComponent(projectId)+'/project-test-plan',sourceType==='story'?{storyId:recordId}:{});}catch{plan=null;}
  if(!plan||!plan.groups?.length)return start(projectId,sourceType,recordId,environmentId);
  const d=choiceDialog();
  $('runChoiceSub').textContent=label||(sourceType==='story'?'This story':'This project');
  const last=plan.lastRun?' Last run '+when(plan.lastRun.completed_at)+': '+(plan.lastRun.passed||0)+' passed, '+(plan.lastRun.failed||0)+' failed.':'';
  $('runChoiceText').innerHTML='<strong>'+plan.caseCount+' approved test case'+(plan.caseCount===1?'':'s')+'</strong> already exist'+(plan.caseCount===1?'s':'')+' for '+(sourceType==='story'?'this story':'this project')+'.'+esc(last)+'<br>Run them again as they are, or generate new test cases with AI?';
  return new Promise(resolve=>{
   d.onclick=async e=>{
    const choice=e.target.closest('[data-choice]')?.dataset.choice||(e.target===d?'cancel':null);if(!choice)return;
    if(choice==='cancel'){d.close();resolve();return;}
    if(choice==='generate'){d.close();resolve(start(projectId,sourceType,recordId,environmentId));return;}
    if(choice==='run'){d.close();resolve(start(projectId,sourceType,recordId,environmentId,true));return;}
   };
   d.oncancel=e=>{if(d.querySelector('[data-choice="run"]')?.disabled)e.preventDefault();else resolve();};
   d.showModal();
  });
 }
 document.addEventListener('click',event=>{
  const button=event.target.closest('[data-start-project],[data-start-story],[data-start-task]');
  if(!button)return;
  event.preventDefault();event.stopPropagation();
  const sourceType=button.hasAttribute('data-start-project')?'project':button.hasAttribute('data-start-story')?'story':'task';
  const projectId=sourceType==='project'?(button.dataset.startProject||$('projectPicker')?.value):$('projectPicker')?.value;
  const recordId=sourceType==='story'?button.dataset.startStory:sourceType==='task'?button.dataset.startTask:null;
  button.disabled=true;
  const label=button.closest('tr')?.querySelector('strong,.tn-task-title')?.textContent||button.closest('.tn-home-card')?.querySelector('h3')?.textContent||'';
  chooseAndStart(projectId,sourceType,recordId,button.dataset.environmentId||null,label).then(()=>{button.disabled=false;}).catch(err=>{error(err.message);button.disabled=false;});
 },true);
})();

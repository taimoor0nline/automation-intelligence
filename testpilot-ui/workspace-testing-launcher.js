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
 async function start(projectId,sourceType,recordId){
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
  const env=(sourceType==='story'&&(detail.environments||[]).find(x=>String(x.id)===String(record?.environment_id)))
   ||(detail.environments||[]).find(x=>x.is_default)||(detail.environments||[])[0];
  const targetUrl=env?.base_url||detail.project?.target_url||'';
  if(!targetUrl)throw Error('Set the project application URL or default environment in Project Details before starting testing.');
  const handoff={projectId,sourceType,targetUrl,environmentName:env?.name||'Test'};
  if(sourceType==='story')handoff.storyId=record.id;
  if(sourceType==='task')handoff.taskId=record.id;
  sessionStorage.setItem('testnexus:runnerHandoff',JSON.stringify(handoff));
  sessionStorage.setItem('testnexus:runnerOrigin','project');
  sessionStorage.removeItem('testnexus:runnerSelection');
  window.location.assign('/runner');
 }
 document.addEventListener('click',event=>{
  const button=event.target.closest('[data-start-project],[data-start-story],[data-start-task]');
  if(!button)return;
  event.preventDefault();event.stopPropagation();
  const sourceType=button.hasAttribute('data-start-project')?'project':button.hasAttribute('data-start-story')?'story':'task';
  const projectId=sourceType==='project'?button.dataset.startProject:$('projectPicker')?.value;
  const recordId=sourceType==='story'?button.dataset.startStory:sourceType==='task'?button.dataset.startTask:null;
  button.disabled=true;
  start(projectId,sourceType,recordId).catch(err=>{error(err.message);button.disabled=false;});
 },true);
})();

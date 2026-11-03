/* TestNexus MMP: select existing project, story, or task as the AI testing input.
 * Reuses authenticated project workspace/work-item APIs and the current studio pipeline.
 */
(function () {
  'use strict';
  const $=id=>document.getElementById(id);
  const state={ready:false,project:null,stories:[],tasks:[],environments:[],mode:'manual',manualDraft:'',serial:0,handoff:null,savedHandoff:null};
  const clean=value=>String(value==null?'':value).trim();
  const segment=(title,value)=>clean(value)?title+'\n'+clean(value):'';
  const join=parts=>parts.filter(Boolean).join('\n\n').slice(0,11000);
  const contextFields=project=>[
    segment('Project description',project.description),
    segment('Business objectives',project.objectives),
    segment('In scope',project.scope_in),
    segment('Out of scope — do not generate tests outside this boundary',project.scope_out),
    segment('Acceptance criteria',project.acceptance_criteria),
    segment('Business rules',project.business_rules)
  ].filter(Boolean);
  function updateLink(sourceType,recordId=''){
    const projectId=$('platformProject')?.value||'';
    window.testnexusRunnerContext={
      projectId,
      sourceType:sourceType.toUpperCase(),
      storyId:sourceType==='story'?recordId||null:null,
      taskId:sourceType==='task'?recordId||null:null
    };
  }
  function status(message,error=false){
    const node=$('testContextStatus');
    if(node){node.textContent=message;node.classList.toggle('testing-context-error',error);}
  }
  function setStoryText(text,isManual){
    const story=$('story');
    if(!story)return;
    story.readOnly=!isManual;
    story.setAttribute('aria-readonly',String(!isManual));
    story.value=text;
    story.placeholder=isManual?'Describe the user journey to test':'Select a project, story or task above to populate this automatically';
    const label=story.closest('.field')?.querySelector('label');
    if(label)label.textContent=isManual?'Business user story (manual)':'Testing context preview (loaded automatically)';
  }
  function selectedEnvironment(story){
    // The environment chosen when starting from Project details wins, then the story's, then the default.
    return state.environments.find(e=>e.is_active!==false&&state.environmentId&&String(e.id)===String(state.environmentId))
      ||state.environments.find(e=>e.is_active!==false&&story?.environment_id&&String(e.id)===String(story.environment_id))
      ||state.environments.find(e=>e.is_active!==false&&e.is_default)||state.environments.find(e=>e.is_active!==false)||null;
  }
  function useEnvironment(story){
    const env=selectedEnvironment(story),project=state.project||{};
    const url=state.environments.length&&!env?'':clean(env?.base_url||project.target_url);
    if($('targetUrl'))$('targetUrl').value=url;
    if($('environment'))$('environment').value=env?.name||'Test';
    if($('additionalPaths'))$('additionalPaths').value=clean(story?.page_paths);
    if(env&&String(env.id)!==String(state.loginEnvironmentId)){state.loginEnvironmentId=env.id;applyEnvironmentLogin(env);}
    return url;
  }
  // Fills "Application login" and the test user from the environment's saved test login (project settings).
  async function applyEnvironmentLogin(env){
    const projectId=$('platformProject')?.value;
    if(!projectId||!env?.id)return;
    let login;
    try{login=await request('/api/projects/'+encodeURIComponent(projectId)+'/environments/'+encodeURIComponent(env.id)+'/test-login');}
    catch(error){status('Could not load the test login for '+(env.name||'this environment')+': '+error.message,true);return;}
    if(String(state.loginEnvironmentId)!==String(env.id))return;
    const select=document.getElementById('webAuthMode')||[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>/no\s+login\s+required/i.test(o.textContent||'')));
    if(select){
      const wanted=[...select.options].find(o=>login.loginRequired?!/no\s+login/i.test(o.textContent||''):/no\s+login/i.test(o.textContent||''));
      if(wanted&&select.value!==wanted.value){select.value=wanted.value;select.dispatchEvent(new Event('change',{bubbles:true}));}
    }
    if(login.loginRequired&&typeof window.setTestNexusTestActors==='function'){
      window.setTestNexusTestActors([{role:'Default User',username:login.username,password:login.password}]);
    }
  }
  function selectRecordOptions(){
    const kind=$('testContextMode').value,select=$('testContextRecord'),wrap=$('testContextRecordWrap');
    const records=(kind==='story'||kind==='project')?state.stories:kind==='task'?state.tasks:[];
    // QA selects an existing story when launched from the project; task launches keep their own source.
    wrap.hidden=!['story','project'].includes(kind);
    const prior=select.value;
    select.replaceChildren();
    select.add(new Option('All project requirements (no specific story)',''));
    for(const record of records){
      const title=kind==='story'?record.title:record.title;
      select.add(new Option(clean(record.reference_no||record.external_case_id||'')+(record.reference_no||record.external_case_id?' · ':'')+clean(title),String(record.id)));
    }
    if(records.some(r=>String(r.id)===prior))select.value=prior;
    if(wrap.hidden)select.value='';
  }
  function selectedRecord(){
    const mode=$('testContextMode').value,id=$('testContextRecord').value;
    const records=(mode==='story'||mode==='project')?state.stories:mode==='task'?state.tasks:[];
    return records.find(r=>String(r.id)===id)||null;
  }
  function renderSelection(){
    const mode=$('testContextMode').value,project=state.project;
    state.mode=mode;
    selectRecordOptions();
    const item=selectedRecord();
    if($('testContextProjectName'))$('testContextProjectName').textContent=project?.name||'No project loaded';
    if($('testContextSourceName'))$('testContextSourceName').textContent=mode==='story'?(item?'Story · '+item.title:'Story not found'):mode==='task'?(item?'Task · '+item.title:'Task not found'):mode==='manual'?'Custom story':'Project requirements';
    if($('testContextManualToggle'))$('testContextManualToggle').textContent=mode==='manual'?'Use selected context':'Write a custom story';
    const base=contextFields(project||{});
    const details=$('testContextProjectDetails');
    if(details){
      details.hidden=mode==='task'||mode==='manual'||!project;
      details.textContent=details.hidden?'':base.join('\n\n')||'No project description, objectives, scope, or acceptance criteria recorded.';
    }
    const back=$('testContextReturn');
    if(back&&project){
      back.href='/workspace.html?projectId='+encodeURIComponent($('platformProject').value)+'#'+(mode==='task'?'tasks':'details');
      back.textContent=mode==='task'?'Back to project tasks':'Back to project details';
    }
    const url=useEnvironment(mode==='story'?item:null);
    let text='';
    if(mode==='manual'){
      text=state.manualDraft;
      setStoryText(text,true);
      status(project?'Manual entry enabled; selected project and repository remain attached to the testing session.':'Manual entry enabled. Select a project to load its saved requirements.');
    }else if(!project){
      setStoryText('',false);status('Select a project first.',true);
    }else if(mode==='project'){
      text=join([segment('Generate test scenarios for project',project.name),...base]);
      setStoryText(text,false);
      status(text&&base.length?(state.stories.length?'Project requirements loaded. Select a project story to test a specific journey, or generate project-wide scenarios.':'Project requirements loaded. Add a project story if you want targeted test coverage.'):'Project has no testing requirements yet. Add objectives, scope or acceptance criteria in Project Details.',!base.length);
    }else if(!item){
      setStoryText('',false);
      const noun=mode==='story'?'story':'task';
      const records=mode==='story'?state.stories:state.tasks;
      status(records.length?'Choose a '+noun+' to load its testing context.':'This project has no '+noun+'s. Create one from Project Details or use project context.',!records.length);
    }else if(mode==='story'){
      text=join([segment('Existing project story',item.title),clean(item.story),segment('Story acceptance criteria',item.acceptance_criteria),...base]);
      setStoryText(text,false);
      status('Story and project scope loaded. The generated session will be associated with this story.');
    }else{
      // Do not inject unrelated project requirements or business stories into a task-specific retest.
      text=join([segment('Test scenarios for project task',item.title),segment('Task description',item.description),segment('Linked test case reference',item.external_case_id)]);
      setStoryText(text,false);
      status('Task and project scope loaded. The generated session will retain the task as its source.');
    }
    updateLink(mode,item?.id||'');
    if(mode!=='manual'&&project&&!url)status('No target URL is configured. Set the application URL or default environment in Project Details.',true);
  }
  function modeChange(){
    if(state.mode==='manual')state.manualDraft=$('story').value;
    $('testContextRecord').value='';
    renderSelection();
  }
  function storyChange(){
    // An optional project story becomes the selected source. Clearing it returns to project scope.
    if(!['project','story'].includes($('testContextMode').value))return;
    const selected=$('testContextRecord').value;
    $('testContextMode').value=selected?'story':'project';
    renderSelection();
  }
  function setup(){
    if(state.ready)return true;
    const projectSelect=$('platformProject'),story=$('story');
    if(!projectSelect||!story)return false;
    const box=document.createElement('section');
    box.className='testing-context-card';
    box.setAttribute('aria-label','Testing source');
    box.innerHTML='<strong class="testing-context-heading">Selected testing context</strong>'+
      '<div class="testing-context-grid"><div><label>Project</label><div class="testing-context-fixed" id="testContextProjectName">Loading…</div></div>'+
      '<div><label>Source</label><div class="testing-context-fixed" id="testContextSourceName">Loading…</div></div></div>'+
      '<div id="testContextProjectDetails" class="testing-context-details" hidden></div>'+
      '<select id="testContextMode" hidden aria-label="Testing source mode">'+
      '<option value="project">Project requirements</option><option value="story">Existing story</option>'+
      '<option value="task">Existing task</option><option value="manual">Write manually</option></select>'+
      '<div id="testContextRecordWrap" hidden><label for="testContextRecord">Project story (optional)</label><select id="testContextRecord"></select></div>'+
      '<div class="testing-context-actions"><a id="testContextReturn" href="/workspace.html#projects">Back to project</a>'+
      '<button id="testContextManualToggle" type="button" class="testing-context-link">Write a custom story</button></div>'+
      '<p id="testContextStatus" class="testing-context-note" role="status" aria-live="polite">Loading project context…</p>';
    const projectField=projectSelect.parentElement;
    projectField.hidden=true;
    projectField.style.display='none';
    const aside=story.closest('aside');
    if(!aside)return false;
    aside.querySelector('.section-head')?.after(box);
    $('testContextMode').addEventListener('change',modeChange);
    $('testContextManualToggle').addEventListener('click',()=>{
      if(state.mode==='manual'){
        const source=state.savedHandoff||{};
        const mode=source.storyId?'story':source.taskId?'task':'project';
        $('testContextMode').value=mode;
        selectRecordOptions();
        if(mode!=='project')$('testContextRecord').value=clean(source.storyId||source.taskId);
      }else{
        $('testContextMode').value='manual';
      }
      renderSelection();
    });
    $('testContextRecord').addEventListener('change',storyChange);
    story.addEventListener('input',()=>{if($('testContextMode').value==='manual')state.manualDraft=story.value;});
    const generate=$('generateBtn');
    generate?.addEventListener('click',event=>{
      const mode=$('testContextMode').value,source=window.testnexusRunnerContext;
      const hasProject=!!$('platformProject').value;
      const item=selectedRecord();
      let error='';
      if(!hasProject)error='Open a project from Projects before generating test cases.';
      else if(mode!=='manual'&&!state.project)error='Project context could not be loaded. Return to the project list and start again.';
      else if((mode==='story'||mode==='task')&&!item)error='Select an existing '+mode+' before generating.';
      else if(mode==='project'&&!contextFields(state.project||{}).length)error='Add project objectives, scope or acceptance criteria before generating from project context.';
      else if(mode!=='manual'&&!clean($('targetUrl')?.value))error='Set a project application URL or default environment before generating.';
      else if(source?.projectId!==$('platformProject').value)error='The testing context has changed. Return to the project and reopen testing.';
      if(error){event.preventDefault();event.stopImmediatePropagation();status(error,true);const errorBox=$('errorBox');if(errorBox){errorBox.textContent=error;errorBox.classList.add('show');}}
    },true);
    const css=document.createElement('style');
    css.textContent='.testing-context-card{margin:14px 0;padding:15px;border:1px solid #d9e2f4;border-radius:11px;background:#f8faff}'+
      '.testing-context-heading{display:block;font-size:13px;color:#243c6a;margin-bottom:9px}'+
      '.testing-context-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:start}'+
      '.testing-context-card label{display:block;font-size:11px;font-weight:750;color:#475569;margin-bottom:6px}'+
      '.testing-context-card select{width:100%;max-width:100%;min-width:0;min-height:42px;border:1px solid #cbd6e8;border-radius:8px;background:#fff;padding:9px;font-size:12px}'+
      '.testing-context-card select:focus-visible{outline:2px solid #728af5;outline-offset:2px}'+
      '#testContextRecordWrap{margin-top:10px}'+
      '.testing-context-details{white-space:pre-wrap;border:1px solid #e1e8f5;background:#fff;border-radius:8px;color:#3d506c;font-size:11px;line-height:1.5;padding:11px;margin-top:10px;max-height:160px;overflow:auto}'+
      '.testing-context-note{font-size:11px;color:#526179;margin:10px 0 0;line-height:1.5}'+
      '.testing-context-error{color:#b91c1c}'+
      '#story[readonly]{background:#f6f8fc;color:#334155;cursor:default}'+
      '#platformSignedIn .platform-row{grid-template-columns:1fr}'+
      '@media(max-width:560px){.testing-context-grid{grid-template-columns:1fr}}';
    css.textContent += '.testing-context-fixed{min-height:42px;display:flex;align-items:center;font-weight:650;font-size:12px;color:#273b59;padding:9px 11px;background:#fff;border:1px solid #d7e1f0;border-radius:8px;overflow-wrap:anywhere}'+
      '.testing-context-actions{display:flex;gap:15px;flex-wrap:wrap;align-items:center;margin-top:11px;font-size:11px}'+
      '.testing-context-actions a,.testing-context-link{color:#305caa;text-decoration:underline;background:transparent;border:0;padding:3px 0;cursor:pointer;font:inherit}'+
      '.testing-context-actions a:focus-visible,.testing-context-link:focus-visible{outline:2px solid #728af5;outline-offset:3px}';
    document.head.appendChild(css);
    state.manualDraft=story.value;
    state.ready=true;
    return true;
  }
  async function loadProjectContext(){
    if(!setup())return;
    const serial=++state.serial,projectId=$('platformProject').value;
    state.project=null;state.stories=[];state.tasks=[];state.environments=[];
    state.mode='manual';
    $('testContextRecord').value='';
    if(!projectId){
      $('testContextMode').value='manual';
      renderSelection();
      return;
    }
    status('Loading project requirements, stories and tasks…');
    try{
      const [context,tasks]=await Promise.all([
        request('/api/projects/'+encodeURIComponent(projectId)+'/workspace'),
        request('/api/projects/'+encodeURIComponent(projectId)+'/work-items')
      ]);
      if(serial!==state.serial||$('platformProject').value!==projectId)return;
      state.project=context.project;
      state.stories=Array.isArray(context.stories)?context.stories:[];
      state.environments=Array.isArray(context.environments)?context.environments:[];
      state.tasks=Array.isArray(tasks.workItems)?tasks.workItems:[];
      $('testContextMode').value='project';
      state.mode='project';
      renderSelection();
      const restoring=state.handoff||state.savedHandoff;if(restoring&&String(restoring.projectId)===String(projectId)){state.handoff=restoring;applyHandoff();}
    }catch(error){
      if(serial!==state.serial)return;
      state.project=null;state.mode='manual';$('testContextMode').value='manual';
      renderSelection();status('Unable to load project context: '+error.message,true);
    }
  }
  async function request(url){
    const response=await fetch(url);
    const payload=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(payload.reply||'Project request failed ('+response.status+')');
    return payload;
  }
  function applyHandoff(){
    const x=state.handoff;
    if(!x||String(x.projectId)!==String($('platformProject')?.value)||!state.project)return;
    const mode=x.storyId?'story':x.taskId?'task':'project';
    const list=mode==='story'?state.stories:mode==='task'?state.tasks:[];
    const id=clean(x.storyId||x.taskId);
    if(id&&!list.some(record=>String(record.id)===id)){
      status('The selected '+mode+' is unavailable in this project. Choose another source.',true);
      state.handoff=null;
      return;
    }
    $('testContextMode').value=mode;
    state.mode=mode;
    selectRecordOptions();
    if(id)$('testContextRecord').value=id;
    renderSelection();
    state.handoff=null;
  }
  document.addEventListener('testnexus:projects-loaded',()=>{loadProjectContext();});
  document.addEventListener('testnexus:project-changed',()=>{state.handoff=null;state.manualDraft='';state.environmentId=null;state.loginEnvironmentId=null;loadProjectContext();});
  document.addEventListener('testnexus:workspace-handoff',event=>{state.handoff=event.detail||null;state.savedHandoff=event.detail||null;state.environmentId=event.detail?.environmentId||null;state.loginEnvironmentId=null;if(state.project)applyHandoff();});
  if(!setup()){
    const observer=new MutationObserver(()=>{if(setup()){observer.disconnect();if($('platformProject').options.length>1)loadProjectContext();}});
    observer.observe(document.body,{childList:true,subtree:true});
  }
})();

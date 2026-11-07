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
  // Breadcrumb above the page, same as the project pages: Projects › <project> [› Tasks] › Start testing.
  function renderTestingBreadcrumb(project,mode){
    let nav=document.getElementById('testCrumb');
    if(!nav){
      const wrap=document.querySelector('.wrap');if(!wrap)return;
      nav=document.createElement('nav');nav.id='testCrumb';nav.className='testing-crumb';nav.setAttribute('aria-label','Breadcrumb');
      wrap.prepend(nav);
    }
    const e=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const id=encodeURIComponent(document.getElementById('platformProject')?.value||'');
    const parts=['<a href="/workspace.html#projects">Projects</a>'];
    if(project&&id){
      parts.push('<a href="/workspace.html?projectId='+id+'#details">'+e(project.name||'Project')+'</a>');
      if(mode==='task')parts.push('<a href="/workspace.html?projectId='+id+'#tasks">Tasks</a>');
    }
    parts.push('<span aria-current="page">Start testing</span>');
    nav.innerHTML=parts.join('<span aria-hidden="true">›</span>');
    // Project name in the centre of the strip.
    const strip=document.getElementById('tnSubbar')||nav.parentElement;
    let title=document.getElementById('tnProjectTitle');
    if(!title&&strip){title=document.createElement('div');title.id='tnProjectTitle';strip.appendChild(title);}
    if(title){title.textContent=project?.name||'';title.title=project?.name||'';title.hidden=!project?.name;}
  }
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
    if(label)label.textContent=isManual?'Business user story (manual)':'What the AI will use';
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
    // Default to Username / password whenever the environment has saved test users (not only when its checkbox is ticked).
    login.loginRequired=Boolean(login.loginRequired||(Array.isArray(login.users)&&login.users.some(u=>u&&u.username))||login.username);
    const select=document.getElementById('webAuthMode')||[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>/no\s+login\s+required/i.test(o.textContent||'')));
    if(select){
      const wanted=[...select.options].find(o=>login.loginRequired?!/no\s+login/i.test(o.textContent||''):/no\s+login/i.test(o.textContent||''));
      if(wanted&&select.value!==wanted.value){select.value=wanted.value;select.dispatchEvent(new Event('change',{bubbles:true}));}
    }
    if(login.loginRequired&&typeof window.setTestNexusTestActors==='function'){
      // All saved test users with their roles (Admin, Customer…); older environments have one user.
      const users=Array.isArray(login.users)&&login.users.length?login.users:[{role:'Default User',username:login.username,password:login.password}];
      window.setTestNexusTestActors(users);
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
    if($('testContextManualToggle'))$('testContextManualToggle').textContent=mode==='manual'?'↩ Use selected story':'+ Custom story';
    const base=contextFields(project||{});
    const details=$('testContextProjectDetails');
    if(details){
      details.hidden=mode==='task'||mode==='manual'||!project;
      details.textContent=details.hidden?'':base.join('\n\n')||'No project description, objectives, scope, or acceptance criteria recorded.';
    }
    renderTestingBreadcrumb(project,mode);
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
    syncStoryEdit(mode,item);
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
  // ---- Edit the selected story from the testing page ----
  function syncStoryEdit(mode,item){
    const b=$('testContextEditStory');if(!b)return;
    b.hidden=!(mode==='story'&&item);
    if(b.hidden&&$('tcStoryDialog')?.open)$('tcStoryDialog').close();
    const save=$('testContextSaveCustom');if(save)save.hidden=mode!=='manual';
  }
  // Popup: save the custom story as a new project story (reusable, listed in Stories, recorded in Audit).
  function newStoryDialog(){
    let d=$('tcNewStoryDialog');if(d)return d;
    d=document.createElement('dialog');d.id='tcNewStoryDialog';d.className='tc-dialog';d.setAttribute('aria-labelledby','tcNewStoryTitle');
    d.innerHTML='<div class="tc-dialog-head"><div><h2 id="tcNewStoryTitle">Save as new story</h2><div class="tc-dialog-sub">Adds this story to the project so it can be reused and its tests are linked to it.</div></div><button type="button" class="tc-dialog-close" id="tcNewCancelX" aria-label="Close">×</button></div>'+
      '<div class="tc-dialog-body"><label for="tcNewTitle">Title *</label><input id="tcNewTitle" class="tc-input" maxlength="250" placeholder="e.g. Reset password">'+
      '<label for="tcNewStory">Story *</label><textarea id="tcNewStory" rows="6"></textarea>'+
      '<label for="tcNewCriteria">Acceptance criteria (optional)</label><textarea id="tcNewCriteria" rows="3" placeholder="Given …, when …, then …"></textarea>'+
      '<label for="tcNewPriority">Priority</label><select id="tcNewPriority" class="tc-input"><option>MEDIUM</option><option>HIGH</option><option>CRITICAL</option><option>LOW</option></select>'+
      '<p class="tc-dialog-hint" id="tcNewError" role="alert" hidden></p></div>'+
      '<div class="tc-dialog-foot"><button type="button" class="tc-btn tc-btn-ghost" id="tcNewCancel">Cancel</button><span class="tc-spacer"></span><button type="button" class="tc-btn tc-btn-primary" id="tcNewSave">Save story</button></div>';
    document.body.appendChild(d);
    const close=()=>{d.close();$('testContextSaveCustom')?.focus();};
    $('tcNewCancel').onclick=close;$('tcNewCancelX').onclick=close;
    $('tcNewSave').onclick=async()=>{
      const projectId=state.project?.id||$('platformProject')?.value,title=$('tcNewTitle').value.trim(),story=$('tcNewStory').value.trim(),err=$('tcNewError');
      err.hidden=true;
      if(!title||!story){err.textContent='Title and story are required.';err.hidden=false;return;}
      const btn=$('tcNewSave');btn.disabled=true;
      try{
        const r=await fetch('/api/projects/'+encodeURIComponent(projectId)+'/stories',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title,story,acceptanceCriteria:$('tcNewCriteria').value.trim(),priority:$('tcNewPriority').value})});
        const data=await r.json().catch(()=>({}));
        if(!r.ok)throw new Error(data.reply||'Story could not be saved ('+r.status+').');
        // Use the new story as the testing source, so this session is linked to it.
        state.stories.unshift(data.story);state.manualDraft='';
        $('testContextMode').value='story';renderSelection();
        $('testContextRecord').value=String(data.story.id);renderSelection();
        d.close();status('Story saved to the project as '+(data.story.reference_no||'a new story')+'.');
      }catch(e){err.textContent=e.message;err.hidden=false;}
      finally{btn.disabled=false;}
    };
    return d;
  }
  // Popup for editing the selected story (same look as the other TestNexus popups).
  function storyDialog(){
    let d=$('tcStoryDialog');if(d)return d;
    d=document.createElement('dialog');d.id='tcStoryDialog';d.className='tc-dialog';d.setAttribute('aria-labelledby','tcStoryDialogTitle');
    d.innerHTML='<div class="tc-dialog-head"><div><h2 id="tcStoryDialogTitle">Edit story</h2><div class="tc-dialog-sub" id="tcStoryDialogSub"></div></div><button type="button" class="tc-dialog-close" id="tcCancelX" aria-label="Close">×</button></div>'+
      '<div class="tc-dialog-body"><label for="tcEditStory">Story</label><textarea id="tcEditStory" rows="6" placeholder="As a … I want … so that …"></textarea>'+
      '<label for="tcEditCriteria">Acceptance criteria</label><textarea id="tcEditCriteria" rows="4" placeholder="Given …, when …, then …"></textarea>'+
      '<p class="tc-dialog-hint">Save to update the project story, or use the edited text for this test only.</p></div>'+
      '<div class="tc-dialog-foot"><button type="button" class="tc-btn tc-btn-ghost" id="tcCancelEdit">Cancel</button><span class="tc-spacer"></span>'+
      '<button type="button" class="tc-btn tc-btn-outline" id="tcUseOnce">Use for this test only</button><button type="button" class="tc-btn tc-btn-primary" id="tcSaveStory">Save to story</button></div>';
    document.body.appendChild(d);
    return d;
  }
  function storyEditText(item,storyText,criteria){
    return join([segment('Existing project story',item.title),clean(storyText),segment('Story acceptance criteria',criteria),...contextFields(state.project||{})]);
  }
  function closeStoryEditor(){const d=$('tcStoryDialog');if(d?.open)d.close();syncStoryEdit(state.mode,selectedRecord());$('testContextEditStory')?.focus();}
  function setupStoryEditor(){
    storyDialog();
    $('testContextEditStory').addEventListener('click',()=>{
      const item=selectedRecord();if(!item)return;
      $('tcEditStory').value=item.story||'';$('tcEditCriteria').value=item.acceptance_criteria||'';
      $('tcStoryDialogSub').textContent=[item.reference_no,item.title].filter(Boolean).join(' · ');
      $('tcStoryDialog').showModal();$('tcEditStory').focus();
    });
    $('tcCancelEdit').addEventListener('click',closeStoryEditor);
    $('tcCancelX').addEventListener('click',closeStoryEditor);
    $('testContextSaveCustom').addEventListener('click',()=>{
      const d=newStoryDialog(),text=($('story')?.value||'').trim();
      if(!text){status('Write the custom story first.',true);return;}
      $('tcNewStory').value=text;$('tcNewCriteria').value='';$('tcNewError').hidden=true;
      $('tcNewTitle').value=text.split('\n')[0].replace(/^as an? [^,]+,\s*/i,'').slice(0,80);
      d.showModal();$('tcNewTitle').focus();$('tcNewTitle').select();
    });
    // Use the edited text for this generation only: the saved story is not changed.
    $('tcUseOnce').addEventListener('click',()=>{
      const item=selectedRecord();if(!item)return;
      setStoryText(storyEditText(item,$('tcEditStory').value,$('tcEditCriteria').value),true);
      const label=$('story').closest('.field')?.querySelector('label');if(label)label.textContent='What the AI will use (edited for this test)';
      closeStoryEditor();status('Edited story is used for this test only. The saved story is unchanged.');
    });
    // Save the edit to the project story (recorded in the project audit as "Story updated").
    $('tcSaveStory').addEventListener('click',async()=>{
      const item=selectedRecord(),projectId=state.project?.id||$('platformProject')?.value;if(!item||!projectId)return;
      const btn=$('tcSaveStory');btn.disabled=true;
      try{
        const r=await fetch('/api/projects/'+encodeURIComponent(projectId)+'/stories/'+encodeURIComponent(item.id),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({story:$('tcEditStory').value,acceptanceCriteria:$('tcEditCriteria').value})});
        const d=await r.json().catch(()=>({}));
        if(!r.ok)throw new Error(d.reply||'Story could not be saved ('+r.status+').');
        Object.assign(item,d.story||{story:$('tcEditStory').value,acceptance_criteria:$('tcEditCriteria').value});
        closeStoryEditor();renderSelection();status('Story saved to the project.');
      }catch(err){status(err.message,true);}
      finally{btn.disabled=false;}
    });
  }
  // ---- Layout of the left column: "What to test" on top, Generate visible, advanced options folded ----
  // Only moves existing fields; every field keeps its behaviour.
  function arrangeTestingLayout(){
    const aside=document.querySelector('aside.panel');if(!aside)return false;
    const card=aside.querySelector('.testing-context-card'),storyField=$('story')?.closest('.field'),gen=$('generateBtn'),types=$('generationTypePicker'),cats=$('generationCategoryPicker'),fresh=$('bypassDiscoveryCache');
    if(!card||!storyField||!gen||!types||!cats||!fresh)return false;
    if(aside.dataset.tnLayout==='1')return true;
    aside.dataset.tnLayout='1';
    if(!document.getElementById('tnTestingLayoutStyles')){
      const st=document.createElement('style');st.id='tnTestingLayoutStyles';
      st.textContent='.testing-context-card .testing-context-heading,#testContextProjectDetails,.testing-context-card .testing-context-grid{display:none!important}'+
        '.testing-context-card .testing-context-actions button[hidden]{display:none!important}'+
        '.testing-context-card .testing-context-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}'+
        '.testing-context-card .testing-context-actions button{display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 14px;border:1px solid #3158ea;border-radius:8px;background:#fff;color:#3158ea;font-size:13px;font-weight:600;text-decoration:none;cursor:pointer}'+
        '.testing-context-card .testing-context-actions button:hover{border-color:#2346d5;background:#eef2ff;color:#2346d5}'+
        '.testing-context-card .testing-context-actions button:focus-visible{outline:3px solid #93b0ff;outline-offset:1px}'+
        '.testing-context-card .testing-context-note:not(.testing-context-error){display:none}'+
        '.testing-context-card label[for=testContextRecord]{font-size:13px;font-weight:600;color:#0f172a}'+
        '.testing-context-card .testing-context-grid{display:flex;align-items:center;gap:8px;grid-template-columns:none}'+
        '.testing-context-card .testing-context-grid>div:first-child{display:none}'+
        '.testing-context-card .testing-context-grid>div{display:flex;align-items:center;gap:8px}'+
        '.testing-context-card .testing-context-grid label{margin:0}'+
        '.testing-context-card .testing-context-fixed{min-height:0;padding:4px 10px;font-size:12px}'+
        '.testing-context-card{margin:10px 0 12px;padding:12px 14px}'+
        '.tn-advanced{margin-top:14px;border:1px solid #e2e8f0;border-radius:10px;background:#fff}'+
        '.tn-advanced>summary{cursor:pointer;list-style:none;padding:11px 14px;font-size:13px;font-weight:600;color:#0f172a}'+
        '.tn-advanced>summary::-webkit-details-marker{display:none}'+
        '.tn-advanced>summary:before{content:"▸";display:inline-block;width:14px;color:#64748b;transition:transform .15s}'+
        '.tn-advanced[open]>summary:before{transform:rotate(90deg)}'+
        '.tn-advanced>summary span{display:block;margin:2px 0 0 14px;font-size:11.5px;font-weight:400;color:#64748b}'+
        '.tn-advanced-body{padding:4px 14px 14px;border-top:1px solid #eef1f6}'+
        '.tn-tip{display:inline-grid;place-items:center;width:15px;height:15px;margin-left:6px;border-radius:50%;background:#eef2ff;color:#3656c9;font-size:10px;font-weight:700;cursor:help;vertical-align:middle}'+
        '.tn-tip-text{display:none!important}'+
        '#generateBtn{margin-top:16px}';
      document.head.appendChild(st);
    }
    const head=aside.querySelector('.section-head'),title=head?.querySelector('h2,h3,strong,b');
    if(title&&!title.querySelector('.tc-step'))title.textContent='1. What to test';
    const fieldBy=t=>[...aside.querySelectorAll(':scope > .field')].find(f=>f.querySelector('label')?.textContent.trim().startsWith(t));
    const top=n=>{while(n&&n.parentElement&&n.parentElement!==aside)n=n.parentElement;return n;};
    const env=aside.querySelector(':scope > .two'),ai=fieldBy('AI quality profile'),scope=$('pageScopeField'),login=fieldBy('Application login'),actors=$('testActorPanel'),freshWrap=top(fresh),err=$('errorBox');
    const recordLabel=card.querySelector('label[for="testContextRecord"]');if(recordLabel)recordLabel.textContent='Story';
    // Order: heading, source + story, text for the AI, environment + AI profile, advanced options, Generate.
    head.after(card);card.after(storyField);
    let last=storyField;
    for(const n of [env,ai])if(n){last.after(n);last=n;}
    const adv=document.createElement('details');adv.className='tn-advanced';
    adv.innerHTML='<summary>Advanced options<span>Page scope, application login, fresh discovery, scenario types, test categories, security</span></summary><div class="tn-advanced-body"></div>';
    const body=adv.querySelector('.tn-advanced-body');
    for(const n of [scope,login,actors,freshWrap,types,cats])if(n)body.appendChild(n);
    last.after(adv);last=adv;
    last.after(gen);last=gen;
    if(err)last.after(err);
    window.syncTestNexusJourneyFormOrder?.(); // the form-order script now uses this layout too
    // Long help texts become an ⓘ tip next to the field label.
    aside.querySelectorAll('.field > small, .web-auth-note, .generation-type-note, .generation-category-note').forEach(note=>{
      const host=note.closest('.field, .generation-type-picker, .generation-category-picker');
      const label=host?.querySelector('label');const text=note.textContent.trim();if(!label||!text)return;
      if(!label.querySelector('.tn-tip')){const tip=document.createElement('span');tip.className='tn-tip';tip.textContent='i';tip.title=text;tip.tabIndex=0;tip.setAttribute('aria-label',text);label.appendChild(tip);}
      note.classList.add('tn-tip-text');
    });
    return true;
  }
  function arrangeReviewSection(){
    const cases=$('cases'),shell=$('reviewFilterShell'),rules=$('behaviorRuleToolbar'),select=document.querySelector('.case-selection-actions');
    if(!cases||!shell||!rules||!select)return false;
    const sec=cases.closest('section');if(!sec||sec.dataset.tnReview==='1')return true;
    sec.dataset.tnReview='1';
    // Rules: a small button in the section header instead of a large box.
    // (The original toolbar stays in the page, hidden, because other scripts update it; this button opens the same rules window.)
    rules.style.setProperty('display','none','important'); // other styles force this box visible
    const actions=sec.querySelector('.section-actions');
    if(actions&&!$('tcRulesBtn')){const b=document.createElement('button');b.type='button';b.id='tcRulesBtn';b.className='tc-rules-btn';b.textContent='Validation';b.title='Validation & behavior rules: applied automatically after generation. Open to review, override, import or export.';b.onclick=()=>$('openBehaviorRules')?.click();actions.prepend(b);}
    // Selection + count sit directly above the list of cases.
    const bar=document.createElement('div');bar.className='tc-case-toolbar';
    const left=document.createElement('div');left.className='tc-case-select';
    const all=$('selectAllCasesBtn'),none=$('deselectAllCasesBtn');
    if(all)all.textContent='Select all';if(none)none.textContent='Deselect all';
    left.append(...[all,none].filter(Boolean));select.remove();
    bar.append(left);const summary=$('reviewFilterSummary');if(summary)bar.append(summary);
    cases.before(shell);cases.before(bar);
    const clear=$('reviewClearFilters');if(clear){clear.textContent='Reset';clear.title='Clear all filters';}
    const search=$('reviewSearch');if(search)search.placeholder='Search test ID, title or expected result';
    return true;
  }
  if(!document.getElementById('tcReviewStyles')){
    const st=document.createElement('style');st.id='tcReviewStyles';
    st.textContent=[
      // popup
      '.tc-dialog{width:min(640px,calc(100vw - 32px));padding:0;border:0;border-radius:14px;box-shadow:0 24px 60px rgba(15,23,42,.3);color:#0f172a;font-family:inherit}',
      '.tc-dialog::backdrop{background:rgba(15,23,42,.45)}',
      '.tc-dialog-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:18px 22px 14px;border-bottom:1px solid #eef1f6}',
      '.tc-dialog-head h2{margin:0 0 3px;font-size:17px;font-weight:600}',
      '.tc-dialog-sub{font-size:12.5px;color:#64748b}',
      '.tc-dialog-close{width:32px;height:32px;border:0;border-radius:8px;background:none;color:#64748b;font-size:22px;line-height:1;cursor:pointer}',
      '.tc-dialog-close:hover{background:#f1f5f9;color:#0f172a}',
      '.tc-dialog-body{padding:16px 22px}',
      '.tc-dialog-body label{display:block;margin:10px 0 6px;font-size:13px;font-weight:600;color:#334155}',
      '.tc-dialog-body label:first-child{margin-top:0}',
      '.tc-dialog-body textarea{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #cbd5e1;border-radius:9px;font:inherit;font-size:13.5px;line-height:1.5;resize:vertical;background:#fff}',
      '.tc-dialog-body textarea:focus{outline:0;border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.18)}',
      '.tc-dialog-hint{margin:10px 0 0;font-size:12px;color:#64748b}',
      '#tcNewError{color:#b91c1c}',
      '.tc-input{width:100%;box-sizing:border-box;height:40px;padding:0 12px;border:1px solid #cbd5e1;border-radius:9px;font:inherit;font-size:13.5px;background:#fff}',
      '.tc-input:focus{outline:0;border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.18)}',
      '.tc-dialog-foot{display:flex;align-items:center;gap:8px;padding:14px 22px 18px;border-top:1px solid #eef1f6}',
      '.tc-spacer{flex:1}',
      '.tc-btn{height:38px;padding:0 16px;border-radius:8px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap}',
      '.tc-btn-primary{border:0;background:#3158ea;color:#fff}.tc-btn-primary:hover{background:#2346d5}',
      '.tc-btn-outline{border:1px solid #3158ea;background:#fff;color:#3158ea}.tc-btn-outline:hover{border-color:#2346d5;background:#eef2ff;color:#2346d5}',
      '.tc-btn-ghost{border:0;background:none;color:#475569}.tc-btn-ghost:hover{background:#f1f5f9}',
      '.tc-btn:disabled{opacity:.6;cursor:wait}',
      '.tc-btn:focus-visible,.tc-dialog-close:focus-visible{outline:3px solid #93b0ff;outline-offset:2px}',
      // section 2
      '#behaviorRuleToolbar{display:none!important}',
      '.tc-rules-btn{height:32px;padding:0 12px;border:1px solid #3158ea;border-radius:8px;background:#fff;color:#3158ea;font:inherit;font-size:12.5px;font-weight:600;cursor:pointer}',
      '.tc-rules-btn:hover{border-color:#2346d5;background:#eef2ff;color:#2346d5}',
      '#reviewFilterShell{margin:0;padding:12px 18px;background:#f9fbff;border-top:1px solid #eef1f6;border-bottom:1px solid #eef1f6}',
      '#reviewFilterShell .review-filter-row{display:flex!important;flex-wrap:wrap;gap:8px;align-items:center;margin:0;grid-template-columns:none}',
      '#reviewFilterShell .review-filter-secondary{margin-top:8px}',
      '#reviewFilterShell .review-filter-secondary:not(:has(> :not([hidden]):not(.review-filter-summary))){display:none}',
      '#reviewSearch{width:auto!important;flex:2 1 240px;min-width:200px;height:36px;padding:0 12px 0 34px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;background:#fff url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%2364748b%27 stroke-width=%272%27 stroke-linecap=%27round%27%3E%3Ccircle cx=%2711%27 cy=%2711%27 r=%277%27/%3E%3Cpath d=%27m20 20-3.5-3.5%27/%3E%3C/svg%3E") no-repeat 11px center/15px}',
      '#reviewSearch:focus,#reviewFilterShell .review-filter-select:focus{outline:0;border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.18)}',
      '#reviewFilterShell .review-filter-select{width:auto!important;flex:1 1 140px;max-width:200px;min-width:130px;height:36px;padding:0 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:12.5px;color:#0f172a;background-color:#fff}',
      '#reviewClearFilters{height:36px;width:auto;padding:0 12px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#475569;font-size:12.5px;font-weight:600}',
      '#reviewClearFilters:hover{border-color:#2563eb;color:#1d4ed8}',
      '.tc-case-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 18px;border-bottom:1px solid #eef1f6;background:#fff}',
      '.tc-case-select{display:flex;gap:4px}',
      '.tc-case-select .btn{width:auto;height:30px;min-height:0;padding:0 10px;border:0;border-radius:7px;background:none;color:#1d4ed8;font-size:12.5px;font-weight:600}',
      '.tc-case-select .btn:hover{background:#eef2ff}',
      '.tc-case-toolbar #reviewFilterSummary{font-size:12.5px;color:#64748b;white-space:nowrap}'
    ].join('');
    document.head.appendChild(st);
  }
  // Cards on the testing page: same look as the project pages (border, radius, header band, stat tiles).
  if(!document.getElementById('tcCardStyles')){
    const st=document.createElement('style');st.id='tcCardStyles';
    st.textContent=[
      'body{background:#eef2f7!important}',
      '.wrap .grid,.wrap .workflow{gap:24px!important}',
      '.wrap .panel{background:#fff;border:1px solid #e2e8f0;border-radius:14px;box-shadow:0 1px 2px rgba(15,23,42,.06),0 8px 24px rgba(15,23,42,.07)}',
      // hover lift, like the cards on the project pages
      '.wrap .panel{transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease}',
      '.wrap .panel:hover{transform:translateY(-3px);border-color:#c7d2fe;box-shadow:0 0 0 3px rgba(59,130,246,.08),0 14px 32px rgba(15,31,92,.12)}',
      '.wrap .panel:focus-within{border-color:#c7d2fe}',
      '@media (prefers-reduced-motion:reduce){.wrap .panel{transition:none}.wrap .panel:hover{transform:none}}',
      '.tc-step{display:inline-grid;place-items:center;width:24px;height:24px;margin-right:9px;border-radius:50%;background:#0f1f5c;color:#fff;font-size:12px;font-weight:700;vertical-align:1px}',
      // header band with the card title
      '.wrap .panel.pad>.section-head{margin:-18px -18px 16px;padding:14px 18px;background:#f9fbff;border-bottom:1px solid #eef1f6;border-radius:14px 14px 0 0}',
      '.wrap .panel>.pad.section-head{margin:0;padding:14px 18px;background:#f9fbff;border-bottom:1px solid #eef1f6;border-radius:14px 14px 0 0}',
      '.wrap .panel .section-head h2{margin:0;font-size:16px;font-weight:600;color:#0f172a;white-space:nowrap}',
      '.wrap .panel .section-head .sub{margin-top:3px;font-size:12.5px;line-height:1.45;color:#64748b}',
      '.wrap .panel .section-head{align-items:flex-start;flex-wrap:wrap;row-gap:8px}',
      '.wrap .panel .section-head .section-actions{flex-wrap:wrap;margin-left:auto}',
      '.wrap .panel .section-head>div:first-child{flex:1 1 180px;min-width:0}',
      '.wrap .panel .section-head .section-actions{flex:0 0 auto}',
      // section 3 result numbers as stat tiles
      '.wrap .metric-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}',
      '.wrap .metric{padding:12px 14px;background:#fff;border:1px solid #e2e8f0;border-top:3px solid #94a3b8;border-radius:12px;text-align:left;box-shadow:none}',
      '.wrap .metric:nth-child(1){border-top-color:#3158ea}.wrap .metric:nth-child(2){border-top-color:#16a34a}.wrap .metric:nth-child(3){border-top-color:#dc2626}.wrap .metric:nth-child(4){border-top-color:#7c3aed}',
      '.wrap .metric .n{font-size:24px;font-weight:700;line-height:1.1}',
      '.wrap .metric .l{margin-top:4px;font-size:12px;font-weight:500;color:#64748b}',
      '.wrap .results .empty,.wrap .cases .empty{color:#64748b;font-size:13px}',
      // 1) flatter left card: no box inside the box
      // story section: soft blue panel with an accent line
      '.wrap .testing-context-card{margin:0 0 16px!important;padding:14px 14px 14px 16px!important;background:linear-gradient(180deg,#f5f8ff,#eef3ff)!important;border:1px solid #d6e0fb!important;border-left:4px solid #3158ea!important;border-radius:12px!important}',
      '.wrap .testing-context-card label[for=testContextRecord]{display:flex!important;align-items:center;gap:7px;color:#0f1f5c!important}',
      '.wrap .testing-context-card label[for=testContextRecord]:before{content:"";width:18px;height:18px;background:url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%233158ea%27 stroke-width=%272%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E%3Cpath d=%27M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z%27/%3E%3Cpath d=%27M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5%27/%3E%3C/svg%3E") no-repeat center/16px}',
      '.wrap .testing-context-card select{border-color:#c7d2fe!important}',
      // advanced options: gear, chevron, hover and open states
      '.wrap .panel .tn-advanced{margin-top:16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;transition:border-color .15s,box-shadow .15s}',
      '.wrap .panel .tn-advanced[open]{background:#fff;border-color:#c7d2fe;box-shadow:0 4px 14px rgba(49,88,234,.08)}',
      '.wrap .panel .tn-advanced>summary{position:relative;padding:12px 40px 12px 46px;font-size:13.5px;font-weight:600;color:#0f172a;background:url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%233158ea%27 stroke-width=%272%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E%3Ccircle cx=%2712%27 cy=%2712%27 r=%273%27/%3E%3Cpath d=%27M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z%27/%3E%3C/svg%3E") no-repeat 16px 14px/18px}',
      '.wrap .panel .tn-advanced>summary:hover{background-color:#eef2ff}',
      '.wrap .panel .tn-advanced>summary:before{content:none!important}',
      '.wrap .panel .tn-advanced>summary:after{content:"";position:absolute;right:14px;top:50%;width:16px;height:16px;margin-top:-8px;background:url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%2364748b%27 stroke-width=%272.2%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E%3Cpath d=%27m9 6 6 6-6 6%27/%3E%3C/svg%3E") no-repeat center/16px;transition:transform .15s}',
      '.wrap .panel .tn-advanced[open]>summary:after{transform:rotate(90deg)}',
      '.wrap .panel .tn-advanced>summary span{margin:3px 0 0!important;font-size:12px!important}',
      '.wrap .panel .tn-advanced[open]>summary{border-bottom:1px solid #eef1f6}',
      '.wrap .panel .tn-advanced-body{padding:14px 16px 6px!important;border-top:0!important}',
      '.wrap .panel .tn-advanced:focus-within>summary,.wrap .panel .tn-advanced>summary:focus-visible{outline:0;box-shadow:inset 0 0 0 3px rgba(147,176,255,.6)}',
      // 2) labels and inputs like the project pages
      '.wrap .panel .field>label,.wrap .panel .two label,.wrap .testing-context-card label{display:block;margin:0 0 6px;font-size:13px;font-weight:600;color:#334155}',
      '.wrap .panel .field{margin-bottom:14px}',
      '.wrap .panel select,.wrap .panel input[type=text],.wrap .panel input[type=url],.wrap .panel input[type=search]{height:40px;border:1px solid #cbd5e1;border-radius:9px;font-size:13.5px;background-color:#fff}',
      '.wrap .panel textarea{border:1px solid #cbd5e1;border-radius:9px;font-size:13.5px;line-height:1.5}',
      '.wrap .panel textarea[readonly]{background:#f8fafc;color:#334155}',
      '.wrap .panel select:focus,.wrap .panel input:focus,.wrap .panel textarea:focus{outline:0;border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.18)}',
      // 3) header buttons in one style
      '.wrap .section-actions{display:flex;align-items:center;gap:6px}',
      '.wrap .section-actions .icon-action{width:32px;height:32px;min-height:0;padding:0;display:inline-grid;place-items:center;border:1px solid #c7d2fe;border-radius:8px;background:#fff;color:#0f1f5c}',
      '.wrap .section-actions .icon-action:hover{border-color:#2563eb;background:#eef2ff}',
      '.wrap .section-actions .pill{min-width:26px;height:26px;display:inline-grid;place-items:center;padding:0 8px;border-radius:999px;background:#eef2ff;color:#0f1f5c;font-size:12px;font-weight:700}',
      // 4) empty states with an icon
      '.wrap .cases .empty,.wrap .results .empty{display:flex;flex-direction:column;align-items:center;gap:10px;padding:34px 16px;text-align:center}',
      // no "Preparing your AI test suite" placeholder while generating: cases appear as they are written
      'body.generation-active #cases>.empty{display:none!important}',
      '.wrap .cases .empty:before,.wrap .results .empty:before{content:"";width:42px;height:42px;border-radius:12px;background:#eef2ff url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%233158ea%27 stroke-width=%271.8%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E%3Cpath d=%27M9 11l3 3 8-8%27/%3E%3Cpath d=%27M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9%27/%3E%3C/svg%3E") no-repeat center/22px}',
      '.wrap .results .empty:before{background-image:url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%233158ea%27 stroke-width=%271.8%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E%3Cpath d=%27M3 3v18h18%27/%3E%3Cpath d=%27m7 14 4-4 3 3 5-6%27/%3E%3C/svg%3E")}',
      // run bar
      '.wrap .runbar{padding:14px 18px;background:#f9fbff;border-top:1px solid #eef1f6;border-radius:0 0 14px 14px}',
      '.wrap .runbar .run-state{font-size:12.5px;color:#64748b}',
      // compact left column: Generate is visible without scrolling on a laptop screen
      '.wrap{padding-top:12px!important}',
      '.wrap .testing-context-card{margin:0 0 10px!important;padding:10px 12px 10px 14px!important}',
      '.wrap aside.panel>.field{margin-top:10px!important}',
      '.wrap aside.panel #story{min-height:80px!important;height:92px!important}',
      '.wrap aside.panel .field input:not([type=checkbox]):not([type=radio]),.wrap aside.panel .field select{min-height:38px!important;height:38px!important}',
      '.wrap .panel .tn-advanced{margin-top:12px!important}',
      '.wrap .panel .tn-advanced>summary{padding-top:9px!important;padding-bottom:9px!important}',
      '.wrap .panel .tn-advanced>summary span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.wrap aside.panel>.two{margin-top:2px!important}',
      '.wrap aside.panel .field>label{margin-bottom:5px!important}',
      '#generateBtn{margin-top:18px!important}',
      // smaller live stats tiles
      '.wrap .metric-grid{gap:8px!important}',
      '.wrap .metric{padding:8px 12px!important}',
      '.wrap .metric .n{font-size:20px!important}'
    ].join('');
    document.head.appendChild(st);
  }
  // Step badges: "1. What to test" -> (1) What to test, so the three columns read as separate steps.
  (function stepBadges(tries=0){
    const heads=[...document.querySelectorAll('.wrap .panel .section-head h2')];
    let done=0;
    for(const h of heads){
      if(h.querySelector('.tc-step')){done++;continue;}
      const m=h.textContent.trim().match(/^(\d)\.\s*(.+)$/);if(!m)continue;
      h.textContent='';const b=document.createElement('span');b.className='tc-step';b.textContent=m[1];b.setAttribute('aria-hidden','true');
      h.append(b,document.createTextNode(m[2]==='Select testing context'?'What to test':m[2]));done++;
    }
    if(done<3&&tries<40)setTimeout(()=>stepBadges(tries+1),250);
  })();
  // Section 3: one short line under the title (the long explanation moves to a hover tip).
  (function shortenResultsSubtitle(){
    const h=[...document.querySelectorAll('h2')].find(x=>/Execution/.test(x.textContent));const sub=h?.parentElement?.querySelector('.sub');
    if(!sub){setTimeout(shortenResultsSubtitle,300);return;}
    if(sub.dataset.tnShort)return;sub.dataset.tnShort='1';sub.title=sub.textContent.trim();sub.textContent='Live results of the tests you run.';
    const emptyCases=document.querySelector('#cases .empty');if(emptyCases&&/No test cases generated yet/.test(emptyCases.textContent))emptyCases.textContent='No test cases yet. Generate them from step 1.';
    const emptyRes=document.querySelector('#results .empty');if(emptyRes&&/Run approved tests/.test(emptyRes.textContent))emptyRes.textContent='Results appear here after you run the selected tests.';
    const cs=$('caseSubtitle');if(cs&&!cs.dataset.tnShort&&/^Select a project/.test(cs.textContent.trim())){cs.dataset.tnShort='1';cs.textContent='Review the generated cases, then select the ones to run.';}
  })();
  const reviewObserver=new MutationObserver(()=>{if(arrangeReviewSection())reviewObserver.disconnect();});
  reviewObserver.observe(document.documentElement,{childList:true,subtree:true});
  const layoutObserver=new MutationObserver(()=>{if(arrangeTestingLayout())layoutObserver.disconnect();});
  layoutObserver.observe(document.documentElement,{childList:true,subtree:true});
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
      '<div class="testing-context-actions">'+
      '<button id="testContextEditStory" type="button" class="testing-context-link" hidden><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16 4 4 4M4 20l4-.7L20 7a2 2 0 0 0-3-3L5 16z"/></svg>Edit story</button>'+
      '<button id="testContextManualToggle" type="button" class="testing-context-link">+ Custom story</button>'+
      '<button id="testContextSaveCustom" type="button" class="testing-context-link" hidden>Save as new story</button></div>'+

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
    setupStoryEditor();
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
      '.testing-crumb{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin:0 0 12px;font:500 13px Inter,system-ui,-apple-system,Segoe UI,Arial,sans-serif;color:#64748b}'+
      '.testing-crumb a{color:#1d4ed8;text-decoration:none}.testing-crumb a:hover{text-decoration:underline}'+
      '.testing-crumb [aria-current]{color:#0f172a}'+
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

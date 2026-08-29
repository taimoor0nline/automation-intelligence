(function () {
  const modal = document.getElementById('editorModal');
  const card = modal?.querySelector('.modal-card');
  if (!card) return;

  let currentEditorIndex = -1;

  const style = document.createElement('style');
  style.textContent = `
    .test-create-mode{margin:0 0 14px;padding:14px;border:1px solid var(--border);border-radius:11px;background:#fff}
    .test-create-mode-title{font-size:12px;font-weight:800;color:#111827;margin-bottom:4px}
    .test-create-mode-note{font-size:10.5px;line-height:1.45;color:#64748b;margin-bottom:9px}
    .test-create-mode select{width:100%;border:1px solid var(--border);border-radius:9px;padding:10px 11px;background:#fff;color:#111827;font-weight:700}
    .test-create-stage-note{margin-top:8px;padding:8px 10px;border-radius:8px;background:#f8fafc;border:1px solid var(--border);font-size:10.5px;line-height:1.45;color:#64748b}
    .review-icon-btn{width:34px!important;height:34px!important;min-width:34px!important;padding:0!important;display:inline-flex!important;align-items:center;justify-content:center;border-radius:9px!important}
    .review-icon-btn svg{width:16px;height:16px;pointer-events:none}
    .readiness-actions .review-icon-btn{width:36px!important;height:32px!important}
    .editor-assertion-ai{margin:8px 0 14px;padding:10px 12px;border:1px solid #dbe3ff;border-radius:10px;background:#f8faff;display:flex;align-items:center;gap:10px;justify-content:space-between}
    .editor-assertion-ai-copy{font-size:10.5px;line-height:1.4;color:#64748b}.editor-assertion-ai-copy strong{display:block;color:#3730a3;font-size:11px;margin-bottom:2px}
    .editor-assertion-result{margin-top:8px;padding:9px 10px;border-radius:8px;background:#fff;border:1px solid #dbe3ff;font-size:10.5px;line-height:1.45;color:#475569;display:none}
    .editor-view-tabs{display:flex;gap:6px;margin:0 0 14px;padding:4px;border:1px solid var(--border);border-radius:10px;background:#f8fafc}
    .editor-view-tab{flex:1;border:0;background:transparent;color:#64748b;padding:9px 10px;border-radius:8px;font-size:11px;font-weight:800;cursor:pointer}
    .editor-view-tab.active{background:#fff;color:#1d4ed8;box-shadow:0 1px 3px rgba(15,23,42,.08)}
    .automation-view{display:none;margin:0 0 14px;border:1px solid var(--border);border-radius:11px;background:#fff;overflow:hidden}
    .automation-view.show{display:block}
    .automation-head{padding:12px 14px;border-bottom:1px solid var(--border);background:#f8fafc}.automation-head strong{display:block;font-size:12px}.automation-head span{display:block;margin-top:3px;color:#64748b;font-size:10.5px}
    .automation-section{padding:12px 14px;border-bottom:1px solid #eef1f6}.automation-section:last-child{border-bottom:0}.automation-section h4{margin:0 0 7px;font-size:11px;color:#334155}.automation-code{margin:0;padding:9px 10px;border:1px solid #e2e8f0;border-radius:8px;background:#0f172a;color:#e2e8f0;white-space:pre-wrap;word-break:break-word;font:10.5px/1.55 Consolas,Monaco,monospace}.automation-list{margin:0;padding-left:18px;color:#475569;font-size:10.5px;line-height:1.5}.automation-badge{display:inline-block;padding:3px 7px;border-radius:999px;font-size:9.5px;font-weight:900}.automation-badge.ready{background:#dcfce7;color:#166534}.automation-badge.blocked{background:#ffedd5;color:#9a3412}.repair-history-item{padding:9px 10px;margin-top:7px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;font-size:10.5px;line-height:1.5;color:#475569}.repair-history-item b{color:#111827}.automation-empty{padding:14px;color:#64748b;font-size:10.5px}
  `;
  document.head.appendChild(style);

  const icon = {
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>',
    del: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></svg>',
    repair: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a4 4 0 0 0-5-5L7.4 3.6l3 3L8.1 8.9a4 4 0 0 0 5 5l7-7a2 2 0 0 0-3-3Z"/><path d="m5 13-3 3 6 6 3-3"/></svg>',
    assertion: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>'
  };

  function decorateReviewActions() {
    document.querySelectorAll('#cases .case').forEach((caseCard) => {
      caseCard.querySelectorAll('.case-actions button').forEach((btn) => {
        const text = (btn.textContent || '').trim().toLowerCase();
        if (text === 'edit') { btn.classList.add('review-icon-btn'); btn.innerHTML = icon.edit; btn.title = 'Edit test case'; btn.setAttribute('aria-label','Edit test case'); }
        else if (text === 'delete') { btn.classList.add('review-icon-btn'); btn.innerHTML = icon.del; btn.title = 'Delete test case'; btn.setAttribute('aria-label','Delete test case'); }
      });
      caseCard.querySelectorAll('.readiness-actions button').forEach((btn) => {
        const text = (btn.textContent || '').trim().toLowerCase();
        if (text.includes('suggest assertion')) { btn.remove(); return; }
        if (text.includes('fix with ai') || text.includes('repair')) { btn.classList.add('review-icon-btn'); btn.innerHTML = icon.repair; btn.title = 'Repair test case with AI'; btn.setAttribute('aria-label','Repair test case with AI'); }
      });
      const actionBox = caseCard.querySelector('.readiness-actions');
      if (actionBox && !actionBox.children.length) actionBox.remove();
    });
  }

  const reviewObserver = new MutationObserver(decorateReviewActions);
  const cases = document.getElementById('cases');
  if (cases) reviewObserver.observe(cases, { childList:true, subtree:true });
  decorateReviewActions();

  const chooser = document.createElement('div');
  chooser.id = 'testCreationMode'; chooser.className = 'test-create-mode'; chooser.style.display = 'none';
  chooser.innerHTML = `<div class="test-create-mode-title">Create test case</div><div class="test-create-mode-note">Choose how you want to start. In both modes you review and can edit every test-case field before saving.</div><select id="testCreationModeSelect" aria-label="Test case creation method"><option value="">Select creation method…</option><option value="ai">Create with AI</option><option value="manual">Create Manually</option></select><div id="testCreationModeHint" class="test-create-stage-note">Select a creation method to continue.</div>`;

  const readiness = document.getElementById('editorReadiness');
  if (readiness) readiness.insertAdjacentElement('beforebegin', chooser); else card.querySelector('.section-head')?.insertAdjacentElement('afterend', chooser);

  const tabs = document.createElement('div');
  tabs.id = 'editorViewTabs'; tabs.className = 'editor-view-tabs';
  tabs.innerHTML = `<button type="button" class="editor-view-tab active" data-editor-view="human">Human Test Case</button><button type="button" class="editor-view-tab" data-editor-view="automation">Automation Details</button>`;
  chooser.insertAdjacentElement('afterend', tabs);

  const automationView = document.createElement('div');
  automationView.id = 'editorAutomationView'; automationView.className = 'automation-view';
  automationView.innerHTML = '<div class="automation-empty">Automation details will appear after the test case has been validated.</div>';
  tabs.insertAdjacentElement('afterend', automationView);

  const modeSelect = document.getElementById('testCreationModeSelect');
  const modeHint = document.getElementById('testCreationModeHint');
  const templateSection = document.getElementById('templateSection');
  const aiGenerator = document.getElementById('editorAiGenerator');
  const saveBtn = document.getElementById('saveEditorBtn');
  const cancelBtn = document.getElementById('cancelEditorBtn');
  const detailNodes = [document.getElementById('editId')?.closest('.field'),document.getElementById('editTitle')?.closest('.field'),document.getElementById('editType')?.closest('.two'),document.getElementById('editPreconditions')?.closest('.field'),document.getElementById('editSteps')?.closest('.field'),document.getElementById('editExpected')?.closest('.field'),document.getElementById('editorReadiness')].filter(Boolean);

  function escape(value) { return String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function formatAction(a) { if (!a) return ''; return [a.operation || a.action || 'ACTION', a.selector || a.target || a.path || '', a.value ?? ''].filter(v => String(v).length).join(' → '); }
  function formatAssertion(a) { if (!a) return ''; return [a.operation || 'ASSERT', a.selector || a.target || '', a.value ?? a.expected ?? ''].filter(v => String(v).length).join(' → '); }

  function currentCase() { return currentEditorIndex >= 0 && Array.isArray(window.testCases || testCases) ? (window.testCases || testCases)[currentEditorIndex] : null; }

  function renderAutomationDetails(tc) {
    if (!tc) { automationView.innerHTML = '<div class="automation-empty">Save or validate this test case first to generate Automation Details.</div>'; return; }
    const r = tc.automationReadiness || {};
    const plan = r.automationPlan || {};
    const actions = Array.isArray(plan.actions) ? plan.actions : [];
    const assertions = Array.isArray(plan.assertions) ? plan.assertions : [];
    const evidence = Array.isArray(r.evidence) ? r.evidence : [];
    const uncompiled = Array.isArray(r.uncompiledExpectations) ? r.uncompiledExpectations : [];
    const history = Array.isArray(tc.repairHistory) ? tc.repairHistory : [];
    const status = String(r.status || 'NOT_VALIDATED');
    const statusClass = status === 'READY' ? 'ready' : 'blocked';
    const actionText = actions.length ? actions.map(formatAction).join('\n') : 'No resolved actions available.';
    const assertionText = assertions.length ? assertions.map(formatAssertion).join('\n') : 'No resolved assertions available.';
    const historyHtml = history.length ? history.map((h, i) => `<div class="repair-history-item"><b>Repair ${i+1}</b><br>Attempt: ${escape(h.attempt ?? i+1)}<br>Reason before repair: ${escape(h.reason || h.reasonCode || '—')}<br>Change: ${escape(h.explanation || h.action || 'Repair applied')}<br>Result: ${escape(h.result || '—')}</div>`).join('') : '<div class="muted">No repair has been applied to this test case.</div>';
    automationView.innerHTML = `
      <div class="automation-head"><strong>Automation Details</strong><span>Read-only execution and debugging view.</span></div>
      <div class="automation-section"><h4>Readiness</h4><span class="automation-badge ${statusClass}">${escape(status.replaceAll('_',' '))}</span><div style="margin-top:7px;font-size:10.5px;color:#475569">${escape(r.reason || 'Not validated yet.')}</div></div>
      <div class="automation-section"><h4>Resolved Actions</h4><pre class="automation-code">${escape(actionText)}</pre></div>
      <div class="automation-section"><h4>Resolved Assertions</h4><pre class="automation-code">${escape(assertionText)}</pre></div>
      <div class="automation-section"><h4>Grounding / Validation Evidence</h4>${evidence.length ? `<ul class="automation-list">${evidence.map(x=>`<li>${escape(x)}</li>`).join('')}</ul>` : '<div class="muted">No evidence recorded.</div>'}</div>
      ${uncompiled.length ? `<div class="automation-section"><h4>Unresolved Expectations</h4><ul class="automation-list">${uncompiled.map(x=>`<li>${escape(x)}</li>`).join('')}</ul></div>` : ''}
      <div class="automation-section"><h4>Repair History</h4>${historyHtml}</div>`;
  }

  function setEditorView(view) {
    const automation = view === 'automation';
    tabs.querySelectorAll('.editor-view-tab').forEach(b => b.classList.toggle('active', b.dataset.editorView === view));
    automationView.classList.toggle('show', automation);
    detailNodes.forEach(node => node.style.display = automation ? 'none' : '');
    if (templateSection) templateSection.style.display = automation ? 'none' : templateSection.style.display;
    if (aiGenerator) aiGenerator.style.display = automation ? 'none' : aiGenerator.style.display;
    const assertionBox = document.getElementById('editorAssertionAi'); if (assertionBox) assertionBox.style.display = automation ? 'none' : assertionBox.style.display;
    if (saveBtn) saveBtn.style.display = automation ? 'none' : '';
    if (automation) renderAutomationDetails(currentCase());
  }
  tabs.addEventListener('click', e => { const b=e.target.closest('[data-editor-view]'); if(b) setEditorView(b.dataset.editorView); });

  function showDetails(show) { detailNodes.forEach(node => { node.style.display = show ? '' : 'none'; }); if (saveBtn) saveBtn.style.display = show ? '' : 'none'; if (cancelBtn) cancelBtn.style.display = ''; const assertionBox = document.getElementById('editorAssertionAi'); if (assertionBox) assertionBox.style.display = show ? 'flex' : 'none'; }
  function resetAiGenerator() { const prompt=document.getElementById('editorAiPrompt'),status=document.getElementById('editorAiStatus'),btn=document.getElementById('editorAiGenerateBtn'); if(prompt)prompt.value=''; if(status){status.textContent='';status.className='status';} if(btn){btn.disabled=false;btn.textContent='Generate';} }
  function setMode(mode) { const isAi=mode==='ai',isManual=mode==='manual'; if(templateSection)templateSection.style.display=isManual?'block':'none'; if(aiGenerator)aiGenerator.style.display=isAi?'block':'none'; const heading=document.getElementById('editorHeading'); if(heading&&chooser.style.display!=='none')heading.textContent=isAi?'Add Test Case · AI':isManual?'Add Test Case · Manual':'Add Test Case'; if(!mode){showDetails(false);if(modeHint)modeHint.textContent='Select a creation method to continue.';return;} if(isManual){showDetails(true);if(modeHint)modeHint.textContent='Write the human-readable test case, then inspect Automation Details after validation.';return;} showDetails(false);resetAiGenerator();if(modeHint)modeHint.textContent='Describe one scenario and generate a candidate. Review the human test case before saving.'; }
  modeSelect?.addEventListener('change',()=>setMode(modeSelect.value));

  const expectedField=document.getElementById('editExpected')?.closest('.field');
  if(expectedField&&!document.getElementById('editorAssertionAi')){const box=document.createElement('div');box.id='editorAssertionAi';box.className='editor-assertion-ai';box.innerHTML=`<div class="editor-assertion-ai-copy"><strong>AI assertion advisor</strong>Review expected results and ask AI whether an existing deterministic assertion fits or a new assertion capability is needed.<div id="editorAssertionResult" class="editor-assertion-result"></div></div><button id="editorAssertionBtn" type="button" class="btn ghost review-icon-btn" title="Suggest assertion with AI" aria-label="Suggest assertion with AI">${icon.assertion}</button>`;expectedField.insertAdjacentElement('afterend',box);}

  function lines(value){return String(value||'').split(/\r?\n/).map(v=>v.trim()).filter(Boolean);}
  function editorCandidate(){const stepLines=lines(document.getElementById('editSteps')?.value);const steps=stepLines.map(line=>{const parts=line.split('|').map(v=>v.trim());return{action:parts[0]||'',target:parts[1]||'',value:parts.length>2?(parts.slice(2).join('|').trim()||null):null};});return{id:document.getElementById('editId')?.value||'TC-H001',title:document.getElementById('editTitle')?.value||'Draft test case',type:document.getElementById('editType')?.value||'functional',priority:document.getElementById('editPriority')?.value||'medium',preconditions:lines(document.getElementById('editPreconditions')?.value),testData:{},steps,expectedResults:lines(document.getElementById('editExpected')?.value),source:currentEditorIndex>=0?(testCases[currentEditorIndex]?.source||'human'):'human'};}

  document.getElementById('editorAssertionBtn')?.addEventListener('click',async()=>{const btn=document.getElementById('editorAssertionBtn'),result=document.getElementById('editorAssertionResult');btn.disabled=true;result.style.display='block';result.textContent='AI is reviewing the expected-result assertion coverage…';try{const tc=currentEditorIndex>=0?{...testCases[currentEditorIndex],...editorCandidate()}:editorCandidate();const r=await fetch('/api/test-cases/assertion-suggestion',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId,testCase:tc,credentials:{username:document.getElementById('username')?.value||'',password:document.getElementById('password')?.value||''}})});const data=await r.json();if(!r.ok)throw new Error(data.reply||'AI could not suggest an assertion.');const s=data.suggestion||{};result.innerHTML=`<b>${String(s.kind||'REVIEW').replaceAll('_',' ')}</b>${s.operation?` · <code>${s.operation}</code>`:''}<br>${escape(s.rationale||'')}`;}catch(err){result.textContent=err.message;}finally{btn.disabled=false;}});

  const aiStatus=document.getElementById('editorAiStatus');
  if(aiStatus)new MutationObserver(()=>{if(modeSelect?.value==='ai'&&/candidate generated/i.test(aiStatus.textContent||'')){showDetails(true);if(modeHint)modeHint.textContent='AI candidate generated. Review the Human Test Case, then save. Automation Details will appear after validation.';}}).observe(aiStatus,{childList:true,characterData:true,subtree:true});

  const previousOpenEditor=window.openEditor;
  if(typeof previousOpenEditor==='function'){
    window.openEditor=function(index){currentEditorIndex=Number(index);previousOpenEditor(index);const isNew=currentEditorIndex<0;chooser.style.display=isNew?'block':'none';tabs.style.display='flex';setEditorView('human');const assertionResult=document.getElementById('editorAssertionResult');if(assertionResult){assertionResult.style.display='none';assertionResult.textContent='';}if(isNew){if(modeSelect)modeSelect.value='';if(templateSection)templateSection.style.display='none';if(aiGenerator)aiGenerator.style.display='none';showDetails(false);resetAiGenerator();const heading=document.getElementById('editorHeading');if(heading)heading.textContent='Add Test Case';if(modeHint)modeHint.textContent='Select a creation method to continue.';}else{if(templateSection)templateSection.style.display='none';if(aiGenerator)aiGenerator.style.display='none';showDetails(true);renderAutomationDetails(currentCase());}};
    try{openEditor=window.openEditor;}catch{}
  }
})();
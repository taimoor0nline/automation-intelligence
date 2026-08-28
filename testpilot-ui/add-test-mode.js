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
  `;
  document.head.appendChild(style);

  const icon = {
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>',
    del: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></svg>',
    repair: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 3 1.2 3.2L16.5 7.5l-3.3 1.3L12 12l-1.2-3.2L7.5 7.5l3.3-1.3Z"/><path d="m18 13 .8 2.2L21 16l-2.2.8L18 19l-.8-2.2L15 16l2.2-.8Z"/></svg>',
    assertion: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>'
  };

  function decorateReviewActions() {
    document.querySelectorAll('#cases .case').forEach((caseCard) => {
      caseCard.querySelectorAll('.case-actions button').forEach((btn) => {
        const text = (btn.textContent || '').trim().toLowerCase();
        if (text === 'edit') {
          btn.classList.add('review-icon-btn'); btn.innerHTML = icon.edit; btn.title = 'Edit test case'; btn.setAttribute('aria-label','Edit test case');
        } else if (text === 'delete') {
          btn.classList.add('review-icon-btn'); btn.innerHTML = icon.del; btn.title = 'Delete test case'; btn.setAttribute('aria-label','Delete test case');
        }
      });
      caseCard.querySelectorAll('.readiness-actions button').forEach((btn) => {
        const text = (btn.textContent || '').trim().toLowerCase();
        if (text.includes('suggest assertion')) {
          btn.remove();
          return;
        }
        if (text.includes('fix with ai') || text.includes('repair')) {
          btn.classList.add('review-icon-btn'); btn.innerHTML = icon.repair; btn.title = 'Repair test case with AI'; btn.setAttribute('aria-label','Repair test case with AI');
        }
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
  chooser.id = 'testCreationMode';
  chooser.className = 'test-create-mode';
  chooser.style.display = 'none';
  chooser.innerHTML = `<div class="test-create-mode-title">Create test case</div><div class="test-create-mode-note">Choose how you want to start. In both modes you review and can edit every test-case field before saving.</div><select id="testCreationModeSelect" aria-label="Test case creation method"><option value="">Select creation method…</option><option value="ai">Create with AI</option><option value="manual">Create Manually</option></select><div id="testCreationModeHint" class="test-create-stage-note">Select a creation method to continue.</div>`;

  const readiness = document.getElementById('editorReadiness');
  if (readiness) readiness.insertAdjacentElement('beforebegin', chooser);
  else card.querySelector('.section-head')?.insertAdjacentElement('afterend', chooser);

  const modeSelect = document.getElementById('testCreationModeSelect');
  const modeHint = document.getElementById('testCreationModeHint');
  const templateSection = document.getElementById('templateSection');
  const aiGenerator = document.getElementById('editorAiGenerator');
  const saveBtn = document.getElementById('saveEditorBtn');
  const cancelBtn = document.getElementById('cancelEditorBtn');

  const detailNodes = [document.getElementById('editId')?.closest('.field'),document.getElementById('editTitle')?.closest('.field'),document.getElementById('editType')?.closest('.two'),document.getElementById('editPreconditions')?.closest('.field'),document.getElementById('editSteps')?.closest('.field'),document.getElementById('editExpected')?.closest('.field'),document.getElementById('editorReadiness')].filter(Boolean);

  function showDetails(show) {
    detailNodes.forEach((node) => { node.style.display = show ? '' : 'none'; });
    if (saveBtn) saveBtn.style.display = show ? '' : 'none';
    if (cancelBtn) cancelBtn.style.display = '';
    const assertionBox = document.getElementById('editorAssertionAi');
    if (assertionBox) assertionBox.style.display = show ? 'flex' : 'none';
  }

  function resetAiGenerator() {
    const prompt = document.getElementById('editorAiPrompt'), status = document.getElementById('editorAiStatus'), btn = document.getElementById('editorAiGenerateBtn');
    if (prompt) prompt.value = '';
    if (status) { status.textContent = ''; status.className = 'status'; }
    if (btn) { btn.disabled = false; btn.textContent = 'Generate'; }
  }

  function setMode(mode) {
    const isAi = mode === 'ai', isManual = mode === 'manual';
    if (templateSection) templateSection.style.display = isManual ? 'block' : 'none';
    if (aiGenerator) aiGenerator.style.display = isAi ? 'block' : 'none';
    const heading = document.getElementById('editorHeading');
    if (heading && chooser.style.display !== 'none') heading.textContent = isAi ? 'Add Test Case · AI' : isManual ? 'Add Test Case · Manual' : 'Add Test Case';
    if (!mode) { showDetails(false); if (modeHint) modeHint.textContent='Select a creation method to continue.'; return; }
    if (isManual) { showDetails(true); if (modeHint) modeHint.textContent='Choose a template, then review or edit all fields before saving.'; return; }
    showDetails(false); resetAiGenerator(); if (modeHint) modeHint.textContent='Describe one scenario and generate a candidate. The full test-case fields will appear for review before you can save.';
  }
  modeSelect?.addEventListener('change', () => setMode(modeSelect.value));

  const expectedField = document.getElementById('editExpected')?.closest('.field');
  if (expectedField && !document.getElementById('editorAssertionAi')) {
    const box = document.createElement('div');
    box.id = 'editorAssertionAi'; box.className = 'editor-assertion-ai';
    box.innerHTML = `<div class="editor-assertion-ai-copy"><strong>AI assertion advisor</strong>Review the expected results and ask AI whether an existing deterministic assertion fits or a new assertion capability is needed.<div id="editorAssertionResult" class="editor-assertion-result"></div></div><button id="editorAssertionBtn" type="button" class="btn ghost review-icon-btn" title="Suggest assertion with AI" aria-label="Suggest assertion with AI">${icon.assertion}</button>`;
    expectedField.insertAdjacentElement('afterend', box);
  }

  function lines(value) { return String(value || '').split(/\r?\n/).map(v=>v.trim()).filter(Boolean); }
  function editorCandidate() {
    const stepLines = lines(document.getElementById('editSteps')?.value);
    const steps = stepLines.map(line => {
      const parts = line.split('|').map(v=>v.trim());
      return { action: parts[0] || '', target: parts[1] || '', value: parts.length > 2 ? (parts.slice(2).join('|').trim() || null) : null };
    });
    return {
      id: document.getElementById('editId')?.value || 'TC-H001',
      title: document.getElementById('editTitle')?.value || 'Draft test case',
      type: document.getElementById('editType')?.value || 'functional',
      priority: document.getElementById('editPriority')?.value || 'medium',
      preconditions: lines(document.getElementById('editPreconditions')?.value),
      testData: {}, steps,
      expectedResults: lines(document.getElementById('editExpected')?.value),
      source: currentEditorIndex >= 0 ? (testCases[currentEditorIndex]?.source || 'human') : 'human'
    };
  }

  document.getElementById('editorAssertionBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('editorAssertionBtn');
    const result = document.getElementById('editorAssertionResult');
    btn.disabled = true; result.style.display='block'; result.textContent='AI is reviewing the expected-result assertion coverage…';
    try {
      const tc = currentEditorIndex >= 0 ? { ...testCases[currentEditorIndex], ...editorCandidate() } : editorCandidate();
      const r = await fetch('/api/test-cases/assertion-suggestion', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ sessionId, testCase:tc, credentials:{ username:document.getElementById('username')?.value||'', password:document.getElementById('password')?.value||'' } }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.reply || 'AI could not suggest an assertion.');
      const s = data.suggestion || {};
      result.innerHTML = `<b>${String(s.kind||'REVIEW').replaceAll('_',' ')}</b>${s.operation ? ` · <code>${s.operation}</code>` : ''}<br>${escapeHtml(s.rationale||'')}${s.cypressStrategy ? `<br><b>Cypress:</b> ${escapeHtml(s.cypressStrategy)}` : ''}`;
    } catch (err) { result.textContent = err.message; }
    finally { btn.disabled=false; }
  });

  const aiStatus = document.getElementById('editorAiStatus');
  if (aiStatus) new MutationObserver(() => { if (modeSelect?.value==='ai' && /candidate generated/i.test(aiStatus.textContent||'')) { showDetails(true); if(modeHint)modeHint.textContent='AI candidate generated. Review or edit every field below, then save the test case.'; } }).observe(aiStatus,{childList:true,characterData:true,subtree:true});

  const previousOpenEditor = window.openEditor;
  if (typeof previousOpenEditor === 'function') {
    window.openEditor = function(index) {
      currentEditorIndex = Number(index);
      previousOpenEditor(index);
      const isNew = currentEditorIndex < 0;
      chooser.style.display = isNew ? 'block' : 'none';
      const assertionResult = document.getElementById('editorAssertionResult'); if(assertionResult){assertionResult.style.display='none';assertionResult.textContent='';}
      if (isNew) {
        if(modeSelect)modeSelect.value=''; if(templateSection)templateSection.style.display='none'; if(aiGenerator)aiGenerator.style.display='none'; showDetails(false); resetAiGenerator();
        const heading=document.getElementById('editorHeading');if(heading)heading.textContent='Add Test Case';if(modeHint)modeHint.textContent='Select a creation method to continue.';
      } else { if(templateSection)templateSection.style.display='none'; if(aiGenerator)aiGenerator.style.display='none'; showDetails(true); }
    };
    try { openEditor = window.openEditor; } catch {}
  }
})();

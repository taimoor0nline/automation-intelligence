(function () {
  // readiness.js keeps its own nativeFetch reference for deterministic readiness batching.
  // Restore the browser's original fetch for the rest of the page so the original /api/chat
  // generation handler is never routed through a later wrapper.
  if (window.__aiTestPilotNativeFetch) window.fetch = window.__aiTestPilotNativeFetch;

  const modal = document.getElementById('editorModal');
  const card = modal?.querySelector('.modal-card');
  if (!card || document.getElementById('testCreationMode')) return;

  const style = document.createElement('style');
  style.textContent = `
    .test-create-mode{margin:0 0 14px;padding:14px;border:1px solid var(--border);border-radius:11px;background:#fff}
    .test-create-mode-title{font-size:12px;font-weight:800;color:#111827;margin-bottom:4px}
    .test-create-mode-note{font-size:10.5px;line-height:1.45;color:#64748b;margin-bottom:9px}
    .test-create-mode select{width:100%;border:1px solid var(--border);border-radius:9px;padding:10px 11px;background:#fff;color:#111827;font-weight:700}
    .test-create-mode select:focus{outline:none;border-color:var(--blue);box-shadow:0 0 0 3px #eaf0ff}
    .test-create-stage-note{margin-top:8px;padding:8px 10px;border-radius:8px;background:#f8fafc;border:1px solid var(--border);font-size:10.5px;line-height:1.45;color:#64748b}
  `;
  document.head.appendChild(style);

  const chooser = document.createElement('div');
  chooser.id = 'testCreationMode';
  chooser.className = 'test-create-mode';
  chooser.style.display = 'none';
  chooser.innerHTML = `
    <div class="test-create-mode-title">Create test case</div>
    <div class="test-create-mode-note">Choose how you want to start. In both modes you review and can edit every test-case field before saving.</div>
    <select id="testCreationModeSelect" aria-label="Test case creation method">
      <option value="">Select creation method…</option>
      <option value="ai">Create with AI</option>
      <option value="manual">Create Manually</option>
    </select>
    <div id="testCreationModeHint" class="test-create-stage-note">Select a creation method to continue.</div>`;

  const readiness = document.getElementById('editorReadiness');
  if (readiness) readiness.insertAdjacentElement('beforebegin', chooser);
  else card.querySelector('.section-head')?.insertAdjacentElement('afterend', chooser);

  const modeSelect = document.getElementById('testCreationModeSelect');
  const modeHint = document.getElementById('testCreationModeHint');
  const templateSection = document.getElementById('templateSection');
  const aiGenerator = document.getElementById('editorAiGenerator');
  const saveBtn = document.getElementById('saveEditorBtn');
  const cancelBtn = document.getElementById('cancelEditorBtn');

  const detailNodes = [
    document.getElementById('editId')?.closest('.field'),
    document.getElementById('editTitle')?.closest('.field'),
    document.getElementById('editType')?.closest('.two'),
    document.getElementById('editPreconditions')?.closest('.field'),
    document.getElementById('editSteps')?.closest('.field'),
    document.getElementById('editExpected')?.closest('.field'),
    document.getElementById('editorReadiness'),
  ].filter(Boolean);

  function showDetails(show) {
    detailNodes.forEach((node) => { node.style.display = show ? '' : 'none'; });
    if (saveBtn) saveBtn.style.display = show ? '' : 'none';
    if (cancelBtn) cancelBtn.style.display = '';
  }

  function resetAiGenerator() {
    const prompt = document.getElementById('editorAiPrompt');
    const status = document.getElementById('editorAiStatus');
    const btn = document.getElementById('editorAiGenerateBtn');
    if (prompt) prompt.value = '';
    if (status) { status.textContent = ''; status.className = 'status'; }
    if (btn) { btn.disabled = false; btn.textContent = 'Generate'; }
  }

  function setMode(mode) {
    const isAi = mode === 'ai';
    const isManual = mode === 'manual';

    if (templateSection) templateSection.style.display = isManual ? 'block' : 'none';
    if (aiGenerator) aiGenerator.style.display = isAi ? 'block' : 'none';

    const heading = document.getElementById('editorHeading');
    if (heading && chooser.style.display !== 'none') {
      heading.textContent = isAi ? 'Add Test Case · AI' : isManual ? 'Add Test Case · Manual' : 'Add Test Case';
    }

    if (!mode) {
      showDetails(false);
      if (modeHint) modeHint.textContent = 'Select a creation method to continue.';
      return;
    }

    if (isManual) {
      showDetails(true);
      if (modeHint) modeHint.textContent = 'Choose a template, then review or edit all fields before saving.';
      setTimeout(() => document.getElementById('templateSelect')?.focus(), 20);
      return;
    }

    showDetails(false);
    resetAiGenerator();
    if (modeHint) modeHint.textContent = 'Describe one scenario and generate a candidate. The full test-case fields will appear for review before you can save.';
    setTimeout(() => document.getElementById('editorAiPrompt')?.focus(), 20);
  }

  modeSelect?.addEventListener('change', () => setMode(modeSelect.value));

  const aiStatus = document.getElementById('editorAiStatus');
  if (aiStatus) {
    const observer = new MutationObserver(() => {
      if (modeSelect?.value !== 'ai') return;
      if (/candidate generated/i.test(aiStatus.textContent || '')) {
        showDetails(true);
        if (modeHint) modeHint.textContent = 'AI candidate generated. Review or edit every field below, then save the test case.';
        setTimeout(() => document.getElementById('editTitle')?.focus(), 20);
      }
    });
    observer.observe(aiStatus, { childList: true, characterData: true, subtree: true });
  }

  const previousOpenEditor = window.openEditor;
  if (typeof previousOpenEditor === 'function') {
    window.openEditor = function (index) {
      previousOpenEditor(index);
      const isNew = Number(index) < 0;
      chooser.style.display = isNew ? 'block' : 'none';

      if (isNew) {
        if (modeSelect) modeSelect.value = '';
        if (templateSection) templateSection.style.display = 'none';
        if (aiGenerator) aiGenerator.style.display = 'none';
        showDetails(false);
        resetAiGenerator();
        const heading = document.getElementById('editorHeading');
        if (heading) heading.textContent = 'Add Test Case';
        if (modeHint) modeHint.textContent = 'Select a creation method to continue.';
        setTimeout(() => modeSelect?.focus(), 20);
      } else {
        if (templateSection) templateSection.style.display = 'none';
        if (aiGenerator) aiGenerator.style.display = 'none';
        showDetails(true);
        if (saveBtn) saveBtn.style.display = '';
      }
    };
    try { openEditor = window.openEditor; } catch {}
  }

  ['/test-case-export.js', '/reporting-entry.js'].forEach((src) => {
    if (document.querySelector(`script[src="${src}"]`)) return;
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    document.body.appendChild(script);
  });
})();

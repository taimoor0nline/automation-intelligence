(function () {
  const modal = document.getElementById('editorModal');
  const card = modal?.querySelector('.modal-card');
  if (!card || document.getElementById('testCreationMode')) return;

  const style = document.createElement('style');
  style.textContent = `
    .test-create-mode{margin:0 0 14px;padding:14px;border:1px solid var(--border);border-radius:11px;background:#fff}
    .test-create-mode-title{font-size:12px;font-weight:800;color:#111827;margin-bottom:4px}
    .test-create-mode-note{font-size:10.5px;line-height:1.45;color:#64748b;margin-bottom:10px}
    .test-create-mode-options{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .test-create-choice{appearance:none;text-align:left;border:1px solid var(--border);border-radius:10px;background:#f8fafc;padding:12px;cursor:pointer;transition:border-color .15s,box-shadow .15s,background .15s}
    .test-create-choice:hover{border-color:#93c5fd;background:#f8fbff}
    .test-create-choice.active{border-color:var(--blue);box-shadow:0 0 0 3px #eaf0ff;background:#f8fbff}
    .test-create-choice strong{display:block;font-size:12px;color:#111827;margin-bottom:4px}
    .test-create-choice span{display:block;font-size:10.5px;line-height:1.4;color:#64748b;font-weight:500}
    @media(max-width:640px){.test-create-mode-options{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);

  const chooser = document.createElement('div');
  chooser.id = 'testCreationMode';
  chooser.className = 'test-create-mode';
  chooser.style.display = 'none';
  chooser.innerHTML = `
    <div class="test-create-mode-title">How do you want to create this test?</div>
    <div class="test-create-mode-note">Choose one creation method. You can still review and edit every field before saving.</div>
    <div class="test-create-mode-options">
      <button id="createWithAiBtn" class="test-create-choice" type="button">
        <strong>Create with AI</strong>
        <span>Describe one specific scenario and let AI prepare a grounded test-case candidate.</span>
      </button>
      <button id="createManuallyBtn" class="test-create-choice" type="button">
        <strong>Create Manually</strong>
        <span>Start from a Functional, Validation, Boundary, Negative or Blank template and edit it yourself.</span>
      </button>
    </div>`;

  const readiness = document.getElementById('editorReadiness');
  if (readiness) readiness.insertAdjacentElement('beforebegin', chooser);
  else card.querySelector('.section-head')?.insertAdjacentElement('afterend', chooser);

  const aiBtn = document.getElementById('createWithAiBtn');
  const manualBtn = document.getElementById('createManuallyBtn');
  const templateSection = document.getElementById('templateSection');
  const aiGenerator = document.getElementById('editorAiGenerator');

  function setMode(mode) {
    const isAi = mode === 'ai';
    const isManual = mode === 'manual';
    aiBtn?.classList.toggle('active', isAi);
    manualBtn?.classList.toggle('active', isManual);
    if (templateSection) templateSection.style.display = isManual ? 'block' : 'none';
    if (aiGenerator) aiGenerator.style.display = isAi ? 'block' : 'none';

    const heading = document.getElementById('editorHeading');
    if (heading && chooser.style.display !== 'none') {
      heading.textContent = isAi ? 'Add Test Case · AI' : isManual ? 'Add Test Case · Manual' : 'Add Test Case';
    }

    if (isAi) setTimeout(() => document.getElementById('editorAiPrompt')?.focus(), 20);
    if (isManual) setTimeout(() => document.getElementById('templateSelect')?.focus(), 20);
  }

  aiBtn?.addEventListener('click', () => setMode('ai'));
  manualBtn?.addEventListener('click', () => setMode('manual'));

  const previousOpenEditor = window.openEditor;
  if (typeof previousOpenEditor === 'function') {
    window.openEditor = function (index) {
      previousOpenEditor(index);
      const isNew = Number(index) < 0;
      chooser.style.display = isNew ? 'block' : 'none';

      if (isNew) {
        setMode(null);
        if (templateSection) templateSection.style.display = 'none';
        if (aiGenerator) aiGenerator.style.display = 'none';
        const heading = document.getElementById('editorHeading');
        if (heading) heading.textContent = 'Add Test Case';
      } else {
        if (templateSection) templateSection.style.display = 'none';
        if (aiGenerator) aiGenerator.style.display = 'none';
      }
    };
    try { openEditor = window.openEditor; } catch {}
  }
})();

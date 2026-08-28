(function () {
  if (window.__aiTestPilotGenerationExperience) return;
  window.__aiTestPilotGenerationExperience = true;

  let active = false;
  let stageTimer = null;
  let stageIndex = 0;
  let observer = null;
  let safetyTimer = null;

  const stages = [
    'Discovering the relevant page structure…',
    'Preparing application evidence for AI…',
    'Generating grounded test cases with AI…',
    'Finalizing generated test cases…',
  ];

  function ensureStyles() {
    if (document.getElementById('generationExperienceStyles')) return;
    const style = document.createElement('style');
    style.id = 'generationExperienceStyles';
    style.textContent = `
      .generation-progress{display:none;position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:115;width:min(520px,calc(100vw - 36px));padding:24px;border:2px solid #ef4444;border-radius:16px;background:rgba(254,242,242,.98);color:#991b1b;box-shadow:0 24px 70px rgba(127,29,29,.25);pointer-events:none;text-align:center}
      .generation-progress.show{display:block;animation:generationAppear .18s ease-out}
      .generation-progress.complete{border-color:#16a34a;background:rgba(240,253,244,.98);color:#166534}
      .generation-progress.failed{border-color:#dc2626;background:rgba(254,226,226,.99);color:#991b1b}
      .generation-progress-head{display:flex;align-items:center;justify-content:center;gap:10px;font-size:18px;font-weight:900;letter-spacing:.35px;text-transform:uppercase}
      .generation-progress-stage{margin-top:14px;color:#7f1d1d;font-size:13px;font-weight:800;line-height:1.5}.generation-progress.complete .generation-progress-stage{color:#166534}.generation-progress.failed .generation-progress-stage{color:#991b1b}
      .generation-progress-note{margin-top:10px;color:#991b1b;font-size:11px;line-height:1.45}.generation-progress.complete .generation-progress-note{color:#166534}
      .generation-spinner{display:inline-block;width:18px;height:18px;border:3px solid #fecaca;border-top-color:#dc2626;border-radius:50%;animation:generationSpin .75s linear infinite}
      .generation-progress.complete .generation-spinner{border-color:#bbf7d0;border-top-color:#16a34a;animation:none}.generation-progress.failed .generation-spinner{border-color:#fecaca;border-top-color:#b91c1c;animation:none}
      body.ai-generation-active #cases>.activity-alert{display:none!important}
      body.ai-generation-active #runStatus.activity-pill{visibility:hidden!important}
      @keyframes generationSpin{to{transform:rotate(360deg)}}
      @keyframes generationAppear{from{opacity:0;transform:translate(-50%,-46%) scale(.97)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}
      @media(max-width:620px){.generation-progress{padding:18px}.generation-progress-head{font-size:15px}.generation-progress-stage{font-size:12px}}
    `;
    document.head.appendChild(style);
  }

  function ensurePanel() {
    let panel = document.getElementById('generationProgress');
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = 'generationProgress';
    panel.className = 'generation-progress';
    panel.setAttribute('role', 'status');
    panel.setAttribute('aria-live', 'polite');
    panel.innerHTML = '<div class="generation-progress-head"><span class="generation-spinner"></span><span>Generating AI Test Cases</span></div><div id="generationStage" class="generation-progress-stage">Preparing generation…</div><div class="generation-progress-note">Page discovery and AI generation run without launching the Cypress execution browser.</div>';
    document.body.appendChild(panel);
    return panel;
  }

  function setFastProfile() {
    const select = document.getElementById('aiModelTier');
    if (select && [...select.options].some((o) => String(o.value).toLowerCase() === 'fast')) {
      select.value = 'fast';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function setStage(text) {
    const stage = document.getElementById('generationStage');
    if (stage) stage.textContent = text;
  }

  function clearRuntime() {
    clearInterval(stageTimer);
    clearTimeout(safetyTimer);
    stageTimer = null;
    safetyTimer = null;
    observer?.disconnect();
    observer = null;
  }

  function removeLegacyGenerationMessage() {
    const legacy = document.querySelector('#cases>.activity-alert');
    if (legacy && /generat|discover/i.test(legacy.textContent || '')) legacy.remove();
  }

  function finish(ok, caseCount = 0) {
    if (!active) return;
    active = false;
    clearRuntime();
    removeLegacyGenerationMessage();
    document.body.classList.remove('ai-generation-active');

    const panel = ensurePanel();
    panel.classList.toggle('complete', Boolean(ok));
    panel.classList.toggle('failed', !ok);
    if (ok) {
      setStage(`${caseCount} test case${caseCount === 1 ? '' : 's'} generated and ready for human review.`);
      setTimeout(() => panel.classList.remove('show', 'complete'), 700);
    } else {
      setStage('Test-case generation did not complete. Check the error message and try again.');
      setTimeout(() => panel.classList.remove('show', 'failed'), 4500);
    }
  }

  function inspectUiState() {
    if (!active) return;
    const cases = document.querySelectorAll('#cases .case');
    if (cases.length) {
      finish(true, cases.length);
      return;
    }
    const errorBox = document.getElementById('errorBox');
    if (errorBox?.classList.contains('show') && String(errorBox.textContent || '').trim()) finish(false);
  }

  function begin() {
    if (active) return;
    active = true;
    stageIndex = 0;
    document.body.classList.add('ai-generation-active');
    const panel = ensurePanel();
    panel.classList.remove('complete', 'failed');
    panel.classList.add('show');
    setStage(stages[0]);

    stageTimer = setInterval(() => {
      stageIndex = Math.min(stageIndex + 1, stages.length - 1);
      setStage(stages[stageIndex]);
    }, 5000);

    observer = new MutationObserver(inspectUiState);
    const cases = document.getElementById('cases');
    const errorBox = document.getElementById('errorBox');
    if (cases) observer.observe(cases, { childList: true, subtree: true });
    if (errorBox) observer.observe(errorBox, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

    // Safety only: never leave a stale overlay indefinitely. This does not control generation itself.
    safetyTimer = setTimeout(() => {
      if (!active) return;
      const rendered = document.querySelectorAll('#cases .case').length;
      if (rendered) finish(true, rendered);
      else finish(false);
    }, 180000);
  }

  function start() {
    ensureStyles();
    ensurePanel();
    setFastProfile();

    const generateBtn = document.getElementById('generateBtn');
    if (!generateBtn || generateBtn.dataset.generationExperienceBound === '1') return;
    generateBtn.dataset.generationExperienceBound = '1';

    // Capture phase runs before the original index.html click handler. We only show UI and select Fast;
    // we never intercept fetch(), Response.json(), testCases, or renderCases().
    generateBtn.addEventListener('click', () => {
      const target = String(document.getElementById('targetUrl')?.value || '').trim();
      const story = String(document.getElementById('story')?.value || '').trim();
      if (!target || !story) return;
      setFastProfile();
      begin();
    }, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();

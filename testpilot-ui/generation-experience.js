(function () {
  if (window.__aiTestPilotGenerationExperience) return;
  window.__aiTestPilotGenerationExperience = true;

  const previousFetch = window.fetch.bind(window);
  let active = false;
  let stageTimer = null;
  let stageIndex = 0;

  const stages = [
    'Discovering the relevant page structure…',
    'Preparing application evidence for AI…',
    'Generating grounded test cases with AI…',
    'Finalizing generated test cases…',
  ];

  function requestPath(input) {
    try {
      const raw = typeof input === 'string' ? input : String(input?.url || '');
      return new URL(raw, window.location.origin).pathname;
    } catch {
      return String(input || '').split('?')[0];
    }
  }

  function isInitialGeneration(input, payload) {
    if (requestPath(input) !== '/api/chat') return false;
    if (!payload || typeof payload !== 'object') return false;
    if (Array.isArray(payload.approvedIds) || payload.message === 'approve reviewed cases') return false;
    return Boolean(payload.targetUrl && String(payload.message || '').trim());
  }

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

  function clearStageTimer() {
    clearInterval(stageTimer);
    stageTimer = null;
  }

  function removeLegacyGenerationMessage() {
    const legacy = document.querySelector('#cases>.activity-alert');
    if (legacy && /generat|discover/i.test(legacy.textContent || '')) legacy.remove();
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
    clearStageTimer();
    stageTimer = setInterval(() => {
      stageIndex = Math.min(stageIndex + 1, stages.length - 1);
      setStage(stages[stageIndex]);
    }, 5000);
  }

  function finish(ok, caseCount = 0) {
    if (!active) return;
    active = false;
    clearStageTimer();
    removeLegacyGenerationMessage();
    document.body.classList.remove('ai-generation-active');

    const panel = ensurePanel();
    panel.classList.toggle('complete', Boolean(ok));
    panel.classList.toggle('failed', !ok);
    if (ok) {
      setStage(`${caseCount || 'AI'} test case${caseCount === 1 ? '' : 's'} generated. Preparing them for human review and readiness checks…`);
      setTimeout(() => panel.classList.remove('show', 'complete'), 900);
    } else {
      setStage('Test-case generation did not complete.');
      setTimeout(() => panel.classList.remove('show', 'failed'), 5000);
    }
  }

  window.fetch = async function generationAwareFetch(input, init = {}) {
    let nextInit = init;
    let generationRequest = false;

    if (typeof init?.body === 'string') {
      try {
        const payload = JSON.parse(init.body);
        if (isInitialGeneration(input, payload)) {
          generationRequest = true;
          payload.aiModelTier = 'fast';
          nextInit = { ...init, body: JSON.stringify(payload) };
          setFastProfile();
          begin();
        }
      } catch {}
    }

    try {
      const response = await previousFetch(input, nextInit);
      if (!generationRequest) return response;

      const originalJson = response.json.bind(response);
      response.json = async () => {
        const data = await originalJson();
        const cases = Array.isArray(data?.testCases) ? data.testCases : [];
        finish(Boolean(response.ok && cases.length), cases.length);
        return data;
      };
      return response;
    } catch (err) {
      if (generationRequest) finish(false);
      throw err;
    }
  };

  function start() {
    ensureStyles();
    ensurePanel();
    setFastProfile();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();

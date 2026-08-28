(function () {
  if (window.__aiTestPilotGenerationExperience) return;
  window.__aiTestPilotGenerationExperience = true;

  const previousFetch = window.fetch.bind(window);
  let active = false;
  let startedAt = 0;
  let timer = null;
  let stageTimer = null;
  let generationTiming = null;
  let stageIndex = 0;

  const stages = [
    'Reading the target page structure over HTTP…',
    'Preparing compact UI evidence for AI…',
    'AI is creating grounded test scenarios…',
    'Preparing generated cases for readiness validation…',
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

  function isReadinessValidation(input) {
    return requestPath(input) === '/api/test-cases/revalidate';
  }

  function ensureStyles() {
    if (document.getElementById('generationExperienceStyles')) return;
    const style = document.createElement('style');
    style.id = 'generationExperienceStyles';
    style.textContent = `
      .generation-progress{display:none;position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:115;width:min(560px,calc(100vw - 36px));padding:22px 24px;border:2px solid #ef4444;border-radius:16px;background:rgba(254,242,242,.98);color:#991b1b;box-shadow:0 24px 70px rgba(127,29,29,.25);pointer-events:none;text-align:center}
      .generation-progress.show{display:block;animation:generationAppear .18s ease-out}
      .generation-progress.complete{border-color:#16a34a;background:rgba(240,253,244,.98);color:#166534}
      .generation-progress.failed{border-color:#dc2626;background:rgba(254,226,226,.99);color:#991b1b}
      .generation-progress-head{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;font-size:18px;font-weight:900;letter-spacing:.35px;text-transform:uppercase}
      .generation-title{display:flex;align-items:center;justify-content:center;gap:8px}
      .generation-elapsed{min-width:92px;padding:7px 12px;border-radius:999px;background:#dc2626;color:#fff;font-size:20px;font-weight:900;letter-spacing:0;text-transform:none;box-shadow:0 6px 16px rgba(220,38,38,.22)}
      .generation-browser-free{display:inline-flex;align-items:center;justify-content:center;margin-top:11px;padding:5px 10px;border-radius:999px;background:#fff;border:1px solid #fecaca;color:#991b1b;font-size:10.5px;font-weight:900;letter-spacing:.2px}
      .generation-progress.complete .generation-browser-free{border-color:#bbf7d0;color:#166534;background:#fff}
      .generation-progress.complete .generation-elapsed{background:#16a34a}.generation-progress.failed .generation-elapsed{background:#b91c1c}
      .generation-progress-stage{margin-top:13px;color:#7f1d1d;font-size:13px;font-weight:800;line-height:1.5}.generation-progress.complete .generation-progress-stage{color:#166534}.generation-progress.failed .generation-progress-stage{color:#991b1b}
      .generation-progress-note{margin-top:9px;color:#991b1b;font-size:11px;line-height:1.45}.generation-progress.complete .generation-progress-note{color:#166534}
      .generation-spinner{display:inline-block;width:18px;height:18px;border:3px solid #fecaca;border-top-color:#dc2626;border-radius:50%;animation:generationSpin .75s linear infinite}
      .generation-progress.complete .generation-spinner{border-color:#bbf7d0;border-top-color:#16a34a;animation:none}.generation-progress.failed .generation-spinner{border-color:#fecaca;border-top-color:#b91c1c;animation:none}
      body.ai-generation-active #cases>.activity-alert{display:none!important}
      body.ai-generation-active #runStatus.activity-pill{visibility:hidden!important}
      @keyframes generationSpin{to{transform:rotate(360deg)}}
      @keyframes generationAppear{from{opacity:0;transform:translate(-50%,-46%) scale(.97)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}
      @media(max-width:620px){.generation-progress{padding:18px}.generation-progress-head{font-size:15px}.generation-elapsed{font-size:18px}.generation-progress-stage{font-size:12px}}
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
    panel.innerHTML = '<div class="generation-progress-head"><span class="generation-title"><span class="generation-spinner"></span>Generating AI Test Cases</span><span id="generationElapsed" class="generation-elapsed">0s</span></div><div class="generation-browser-free">No automation browser launched</div><div id="generationStage" class="generation-progress-stage">Preparing generation…</div><div class="generation-progress-note">Chrome opens only when <b>Run Approved Tests</b> starts Cypress execution.</div>';
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

  function elapsedMs() {
    return startedAt ? Math.max(0, Date.now() - startedAt) : 0;
  }

  function updateElapsed() {
    if (!active) return;
    const elapsed = document.getElementById('generationElapsed');
    if (elapsed) elapsed.textContent = `${Math.floor(elapsedMs() / 1000)}s`;
  }

  function setStage(text) {
    const stage = document.getElementById('generationStage');
    if (stage) stage.textContent = text;
  }

  function clearTimers() {
    clearInterval(timer);
    clearInterval(stageTimer);
    timer = null;
    stageTimer = null;
  }

  function begin() {
    if (active) return;
    active = true;
    startedAt = Date.now();
    generationTiming = null;
    stageIndex = 0;
    document.body.classList.add('ai-generation-active');

    const panel = ensurePanel();
    panel.classList.remove('complete', 'failed');
    panel.classList.add('show');
    const elapsed = document.getElementById('generationElapsed');
    if (elapsed) elapsed.textContent = '0s';
    setStage(stages[0]);

    // One update per second is enough for a real elapsed timer and avoids unnecessary DOM churn.
    timer = setInterval(updateElapsed, 1000);
    stageTimer = setInterval(() => {
      stageIndex = Math.min(stageIndex + 1, stages.length - 1);
      setStage(stages[stageIndex]);
    }, 4500);
  }

  function casesReturned() {
    clearInterval(stageTimer);
    stageTimer = null;
    setStage('Test cases created. Checking automation readiness…');
  }

  function removeLegacyGenerationMessage() {
    const legacy = document.querySelector('#cases>.activity-alert');
    if (legacy && /generat|discover/i.test(legacy.textContent || '')) legacy.remove();
  }

  function finish(ok) {
    if (!active) return;
    updateElapsed();
    const total = elapsedMs();
    active = false;
    clearTimers();
    removeLegacyGenerationMessage();
    document.body.classList.remove('ai-generation-active');

    const panel = ensurePanel();
    const elapsed = document.getElementById('generationElapsed');
    panel.classList.toggle('complete', Boolean(ok));
    panel.classList.toggle('failed', !ok);
    if (elapsed) elapsed.textContent = `${(total / 1000).toFixed(1)}s`;

    if (ok) {
      const ai = generationTiming?.aiGenerationMs != null ? ` · AI ${(generationTiming.aiGenerationMs / 1000).toFixed(1)}s` : '';
      const discovery = generationTiming?.discoveryMs != null ? ` · discovery ${(generationTiming.discoveryMs / 1000).toFixed(1)}s` : '';
      setStage(`Ready for human review · total ${(total / 1000).toFixed(1)}s${ai}${discovery}.`);
    } else {
      setStage('Generation or readiness validation did not complete.');
    }

    setTimeout(() => panel.classList.remove('show', 'complete', 'failed'), ok ? 3200 : 8000);
  }

  window.fetch = async function generationAwareFetch(input, init = {}) {
    let nextInit = init;
    let generationRequest = false;
    let readinessRequest = false;

    if (typeof init?.body === 'string') {
      try {
        const payload = JSON.parse(init.body);
        if (isInitialGeneration(input, payload)) {
          generationRequest = true;
          payload.aiModelTier = 'fast';
          nextInit = { ...init, body: JSON.stringify(payload) };
          setFastProfile();
          begin();
        } else if (isReadinessValidation(input)) {
          readinessRequest = true;
        }
      } catch {}
    } else if (isReadinessValidation(input)) {
      readinessRequest = true;
    }

    try {
      const response = await previousFetch(input, nextInit);

      if (generationRequest) {
        const originalJson = response.json.bind(response);
        response.json = async () => {
          const data = await originalJson();
          if (!response.ok || !Array.isArray(data?.testCases) || !data.testCases.length) {
            finish(false);
            return data;
          }
          generationTiming = data.generationTiming || null;
          casesReturned();
          return data;
        };
      }

      if (readinessRequest && active) {
        const originalJson = response.json.bind(response);
        response.json = async () => {
          const data = await originalJson();
          // Finish on the next task so readiness.js can first render the validated cases.
          setTimeout(() => finish(Boolean(response.ok && data?.readinessPending === false)), 0);
          return data;
        };
      }

      return response;
    } catch (err) {
      if (generationRequest || (readinessRequest && active)) finish(false);
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

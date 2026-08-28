(function () {
  if (window.__aiTestPilotGenerationExperience) return;
  window.__aiTestPilotGenerationExperience = true;

  const previousFetch = window.fetch.bind(window);
  let active = false;
  let startedAt = 0;
  let timer = null;
  let stageTimer = null;
  let readinessWatch = null;
  let generationTiming = null;
  const stages = [
    'Discovering the relevant page structure…',
    'Preparing compact UI evidence for the AI model…',
    'AI is drafting grounded test scenarios…',
    'Validating generated scenarios against discovered evidence…',
    'Finalizing generated cases…',
  ];

  function isInitialGeneration(url, payload) {
    const path = typeof url === 'string' ? url : String(url?.url || '');
    if (!/\/api\/chat(?:\?|$)/.test(path)) return false;
    if (!payload || typeof payload !== 'object') return false;
    if (Array.isArray(payload.approvedIds) || payload.message === 'approve reviewed cases') return false;
    return Boolean(payload.targetUrl && String(payload.message || '').trim());
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
      .generation-progress-head{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;font-size:18px;font-weight:900;letter-spacing:.45px;text-transform:uppercase}
      .generation-title{display:flex;align-items:center;justify-content:center;gap:8px}
      .generation-elapsed{min-width:92px;padding:7px 12px;border-radius:999px;background:#dc2626;color:#fff;font-size:20px;font-weight:900;letter-spacing:0;text-transform:none;box-shadow:0 6px 16px rgba(220,38,38,.22)}
      .generation-progress.complete .generation-elapsed{background:#16a34a}.generation-progress.failed .generation-elapsed{background:#b91c1c}
      .generation-progress-stage{margin-top:13px;color:#7f1d1d;font-size:13px;font-weight:800;line-height:1.5}.generation-progress.complete .generation-progress-stage{color:#166534}.generation-progress.failed .generation-progress-stage{color:#991b1b}
      .generation-progress-note{margin-top:9px;color:#991b1b;font-size:11px;line-height:1.45}.generation-progress.complete .generation-progress-note{color:#166534}
      .generation-spinner{display:inline-block;width:18px;height:18px;border:3px solid #fecaca;border-top-color:#dc2626;border-radius:50%;animation:generationSpin .75s linear infinite}
      .generation-progress.complete .generation-spinner{border-color:#bbf7d0;border-top-color:#16a34a;animation:none}.generation-progress.failed .generation-spinner{border-color:#fecaca;border-top-color:#b91c1c;animation:none}
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
    panel.innerHTML = '<div class="generation-progress-head"><span class="generation-title"><span class="generation-spinner"></span>Generating AI Test Cases</span><span id="generationElapsed" class="generation-elapsed">0s</span></div><div id="generationStage" class="generation-progress-stage">Preparing generation…</div><div class="generation-progress-note">Elapsed time is measured from generation start until automation-readiness validation finishes.</div>';
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

  function currentElapsedMs() {
    return startedAt ? Math.max(0, Date.now() - startedAt) : 0;
  }

  function updateElapsed() {
    const elapsed = document.getElementById('generationElapsed');
    if (elapsed && active) elapsed.textContent = `${Math.floor(currentElapsedMs() / 1000)}s`;
  }

  function clearTimers() {
    clearInterval(timer);
    clearInterval(stageTimer);
    clearInterval(readinessWatch);
    timer = null;
    stageTimer = null;
    readinessWatch = null;
  }

  function begin() {
    if (active) return;
    active = true;
    startedAt = Date.now();
    generationTiming = null;
    let stageIndex = 0;
    const panel = ensurePanel();
    panel?.classList.remove('complete', 'failed');
    panel?.classList.add('show');
    const elapsed = document.getElementById('generationElapsed');
    const stage = document.getElementById('generationStage');
    if (elapsed) elapsed.textContent = '0s';
    if (stage) stage.textContent = stages[0];
    timer = setInterval(updateElapsed, 250);
    stageTimer = setInterval(() => {
      stageIndex = Math.min(stageIndex + 1, stages.length - 1);
      if (stage) stage.textContent = stages[stageIndex];
    }, 3000);
  }

  function readinessFinished() {
    const subtitle = String(document.getElementById('caseSubtitle')?.textContent || '').toLowerCase();
    if (subtitle.includes('automation readiness completed')) return true;

    const hint = String(document.getElementById('runHint')?.textContent || '').toLowerCase();
    const hasCases = document.querySelectorAll('#cases .case').length > 0;
    const stillChecking = /checking|locked|validation|readiness is being checked/.test(hint);
    return hasCases && !stillChecking && /automation ready|action\/manual/.test(hint);
  }

  function waitForReadiness() {
    if (!active || readinessWatch) return;
    const stage = document.getElementById('generationStage');
    if (stage) stage.textContent = 'AI test cases generated · checking automation readiness…';
    readinessWatch = setInterval(() => {
      updateElapsed();
      if (readinessFinished()) finish(true);
    }, 250);
  }

  function finish(ok) {
    if (!active) return;
    updateElapsed();
    const elapsedMs = currentElapsedMs();
    active = false;
    clearTimers();

    const panel = ensurePanel();
    const elapsed = document.getElementById('generationElapsed');
    const stage = document.getElementById('generationStage');
    panel?.classList.toggle('complete', Boolean(ok));
    panel?.classList.toggle('failed', !ok);
    if (elapsed) elapsed.textContent = `${(elapsedMs / 1000).toFixed(1)}s`;
    if (stage) {
      stage.textContent = ok
        ? `Ready for human review · total ${(elapsedMs / 1000).toFixed(1)}s${generationTiming?.aiGenerationMs != null ? ` · AI ${(generationTiming.aiGenerationMs / 1000).toFixed(1)}s` : ''}${generationTiming?.discoveryMs != null ? ` · discovery ${(generationTiming.discoveryMs / 1000).toFixed(1)}s` : ''}.`
        : 'Generation stopped before the complete review-ready test set was returned.';
    }
    setTimeout(() => panel?.classList.remove('show', 'complete', 'failed'), ok ? 3500 : 8000);
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
        if (!response.ok) {
          finish(false);
          return data;
        }
        generationTiming = data?.generationTiming || null;
        waitForReadiness();
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

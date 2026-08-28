(function () {
  if (window.__aiTestPilotGenerationExperience) return;
  window.__aiTestPilotGenerationExperience = true;

  const previousFetch = window.fetch.bind(window);
  let active = false;
  let startedAt = 0;
  let timer = null;
  let stageTimer = null;
  const stages = [
    'Discovering the relevant page structure…',
    'Preparing compact UI evidence for the AI model…',
    'AI is drafting grounded test scenarios…',
    'Validating generated scenarios against discovered evidence…',
    'Finalizing cases for human review…',
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
      .generation-progress{display:none;margin-top:12px;padding:12px 13px;border:1px solid #bfdbfe;border-radius:10px;background:#f8fbff;color:#1e3a8a}
      .generation-progress.show{display:block}.generation-progress-head{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:11.5px;font-weight:800}
      .generation-progress-stage{margin-top:5px;color:#475569;font-size:10.8px;line-height:1.45}.generation-progress-note{margin-top:6px;color:#64748b;font-size:10px;line-height:1.4}
      .generation-spinner{display:inline-block;width:11px;height:11px;border:2px solid #bfdbfe;border-top-color:#2f5bff;border-radius:50%;animation:generationSpin .75s linear infinite;margin-right:6px;vertical-align:-2px}
      @keyframes generationSpin{to{transform:rotate(360deg)}}
    `;
    document.head.appendChild(style);
  }

  function ensurePanel() {
    let panel = document.getElementById('generationProgress');
    if (panel) return panel;
    const button = document.getElementById('generateBtn');
    if (!button) return null;
    panel = document.createElement('div');
    panel.id = 'generationProgress';
    panel.className = 'generation-progress';
    panel.innerHTML = '<div class="generation-progress-head"><span><span class="generation-spinner"></span>Generating test cases</span><span id="generationElapsed">0s</span></div><div id="generationStage" class="generation-progress-stage">Preparing generation…</div><div class="generation-progress-note">The page remains usable while the server and AI model work. Initial case generation uses the Fast AI profile; stronger profiles remain available for repair and failure analysis.</div>';
    button.insertAdjacentElement('afterend', panel);
    return panel;
  }

  function setFastProfile() {
    const select = document.getElementById('aiModelTier');
    if (select && [...select.options].some((o) => String(o.value).toLowerCase() === 'fast')) {
      select.value = 'fast';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function begin() {
    if (active) return;
    active = true;
    startedAt = Date.now();
    let stageIndex = 0;
    const panel = ensurePanel();
    panel?.classList.add('show');
    const elapsed = document.getElementById('generationElapsed');
    const stage = document.getElementById('generationStage');
    if (stage) stage.textContent = stages[0];
    timer = setInterval(() => {
      if (elapsed) elapsed.textContent = `${Math.max(0, Math.round((Date.now() - startedAt) / 1000))}s`;
    }, 250);
    stageTimer = setInterval(() => {
      stageIndex = Math.min(stageIndex + 1, stages.length - 1);
      if (stage) stage.textContent = stages[stageIndex];
    }, 2500);
  }

  function finish(ok, timing) {
    if (!active) return;
    active = false;
    clearInterval(timer); clearInterval(stageTimer); timer = null; stageTimer = null;
    const elapsedMs = timing?.totalMs || (Date.now() - startedAt);
    const panel = ensurePanel();
    const elapsed = document.getElementById('generationElapsed');
    const stage = document.getElementById('generationStage');
    if (elapsed) elapsed.textContent = `${(elapsedMs / 1000).toFixed(1)}s`;
    if (stage) {
      stage.textContent = ok
        ? `Generation complete${timing?.aiGenerationMs != null ? ` · AI ${(timing.aiGenerationMs / 1000).toFixed(1)}s` : ''}${timing?.discoveryMs != null ? ` · discovery ${(timing.discoveryMs / 1000).toFixed(1)}s` : ''}.`
        : 'Generation stopped before test cases were returned.';
    }
    setTimeout(() => panel?.classList.remove('show'), ok ? 5000 : 8000);
  }

  window.fetch = async function generationAwareFetch(input, init = {}) {
    let nextInit = init;
    let generationRequest = false;
    if (typeof init?.body === 'string') {
      try {
        const payload = JSON.parse(init.body);
        if (isInitialGeneration(input, payload)) {
          generationRequest = true;
          // Initial scenario generation is a structured drafting task. Keep it on
          // the low-latency profile; stronger models are reserved for explicit
          // repair/failure-analysis requests where additional reasoning is useful.
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
        finish(response.ok, data?.generationTiming);
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
    // Avoid the server-injected default profile putting the demo back onto the
    // slow balanced/strong model before the first request.
    setFastProfile();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();

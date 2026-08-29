(function () {
  function selected(selector, fallback = []) {
    const values = [...document.querySelectorAll(selector + ':checked')].map((el) => el.value).filter(Boolean);
    return values.length ? values : fallback;
  }

  function generationSelection() {
    return {
      categories: selected('#generationCategoryMenu input[data-test-category]'),
      scenarioTypes: selected('#generationTypeMenu input[data-scenario-type]'),
      securitySubcategories: selected('#securitySubcategoryMenu input[data-security-subcategory]'),
      securitySeverities: selected('#securitySeverityMenu input[data-security-severity]'),
    };
  }

  function resetExecutionState() {
    ['mTotal','mPassed','mFailed'].forEach((id) => { const el = $(id); if (el) el.textContent = '0'; });
    if ($('mRate')) $('mRate').textContent = '0%';
    if ($('results')) $('results').innerHTML = '<div class="empty">Waiting for execution.</div>';
    if ($('analysis')) $('analysis').innerHTML = '';
    if ($('reportBox')) $('reportBox').style.display = 'none';
    if ($('reportLink')) $('reportLink').removeAttribute('href');
    if ($('runBtn')) $('runBtn').disabled = true;
  }

  function setGenerationUi(active) {
    window.__aiTestPilotProgressiveGenerationActive = active;
    window.__aiTestPilotSuspendReviewFilters = active;
    document.documentElement.classList.toggle('generation-active', active);
    document.body.classList.toggle('generation-active', active);
    document.documentElement.style.overflowY = 'auto';
    document.body.style.overflowY = 'auto';
    if (!active) {
      document.documentElement.style.removeProperty('overflow-y');
      document.body.style.removeProperty('overflow-y');
    }
  }

  function status(text) {
    const subtitle = $('caseSubtitle');
    if (subtitle && subtitle.textContent !== text) subtitle.textContent = text;
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
  }

  function mergeGeneratedCases(incoming) {
    const map = new Map((testCases || []).map((tc) => [String(tc.id || '').toUpperCase(), tc]));
    for (const tc of incoming || []) {
      const key = String(tc.id || '').toUpperCase();
      if (!key) continue;
      map.set(key, { ...tc, source: tc.source || 'ai', automationReadiness: null });
    }
    testCases = [...map.values()].sort((a, b) => String(a.id || '').localeCompare(String(b.id || ''), undefined, { numeric: true }));
  }

  function renderGenerationPreview() {
    const casesEl = $('cases');
    if (!casesEl) return;
    const html = (testCases || []).map((tc) => {
      const category = String(tc.testCategory || 'FUNCTIONAL').replaceAll('_', ' ');
      const scenarioType = String(tc.type || 'functional');
      const priority = String(tc.priority || 'medium');
      return `<div class="generation-case-preview">
        <div class="generation-case-preview-title">${esc(tc.id)} — ${esc(tc.title)}</div>
        <div class="generation-case-preview-meta">
          <span>${esc(scenarioType)}</span><span>${esc(category)}</span><span>${esc(priority)}</span><span class="pending">Readiness pending</span>
        </div>
      </div>`;
    }).join('');
    casesEl.innerHTML = html || '<div class="empty">Waiting for the first generated test case…</div>';
    if ($('caseCount')) $('caseCount').textContent = String((testCases || []).length);
  }

  function consumeEventSource(url, onEvent) {
    return new Promise((resolve, reject) => {
      const source = new EventSource(url);
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        source.close();
        fn(value);
      };
      const types = ['GENERATION_STARTED','DISCOVERY_COMPLETED','GENERATION_PLAN','BATCH_STARTED','BATCH_COMPLETED','GENERATION_COMPLETED','GENERATION_FAILED'];
      for (const type of types) {
        source.addEventListener(type, async (event) => {
          try {
            const data = JSON.parse(event.data || '{}');
            await onEvent(type, data);
            if (type === 'GENERATION_COMPLETED') finish(resolve, data);
            if (type === 'GENERATION_FAILED') finish(reject, new Error(data.message || 'Generation failed.'));
          } catch (err) {
            finish(reject, err);
          }
        });
      }
      source.onerror = () => {};
    });
  }

  async function consumeFetchStream(url, onEvent) {
    const response = await fetch(url, { headers: { Accept: 'text/event-stream' }, cache: 'no-store' });
    if (!response.ok) throw new Error(`Generation stream failed (${response.status}).`);
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Generation stream is unavailable in this browser.');
    const decoder = new TextDecoder();
    let buffer = '';
    let completed = null;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let match;
      while ((match = buffer.match(/\r?\n\r?\n/))) {
        const boundary = match.index;
        const frame = buffer.slice(0, boundary).trim();
        buffer = buffer.slice(boundary + match[0].length);
        if (!frame || frame.startsWith(':')) continue;
        let eventType = 'message', dataText = '';
        for (const line of frame.split(/\r?\n/)) {
          if (line.startsWith('event:')) eventType = line.slice(6).trim();
          else if (line.startsWith('data:')) dataText += line.slice(5).trim();
        }
        if (!dataText) continue;
        const data = JSON.parse(dataText);
        await onEvent(eventType, data);
        if (eventType === 'GENERATION_COMPLETED') completed = data;
        if (eventType === 'GENERATION_FAILED') throw new Error(data.message || 'Generation failed.');
      }
    }
    return completed;
  }

  async function progressiveGenerate(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    clearError();
    const targetUrl = $('targetUrl')?.value.trim();
    const story = $('story')?.value.trim();
    if (!targetUrl || !story) { showError('Target URL and business story are required.'); return; }

    sessionId = 'run-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    humanCounter = 1;
    testCases = [];
    resetExecutionState();
    setGenerationUi(true);
    renderGenerationPreview();
    status('Starting generation…');
    setBusy($('generateBtn'), true, 'Generating test cases…');

    const selection = generationSelection();
    const securitySelected = selection.categories.includes('SECURITY');
    const paths = $('additionalPaths').value.split(',').map((v) => v.trim()).filter(Boolean);
    const payload = {
      sessionId, message: story, targetUrl, additionalPaths: paths,
      credentials: { username: $('username').value, password: $('password').value },
      aiModelTier: $('aiModelTier')?.value || 'fast',
      bypassDiscoveryCache: Boolean($('bypassDiscoveryCache')?.checked),
      selectedTestCategories: selection.categories,
      selectedScenarioTypes: selection.scenarioTypes,
      selectedSecuritySubcategories: securitySelected ? selection.securitySubcategories : [],
      selectedSecuritySeverities: securitySelected ? selection.securitySeverities : [],
    };

    let generatedCount = 0;
    let total = 0;
    try {
      const startResponse = await fetch('/api/generation/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const start = await startResponse.json();
      if (!startResponse.ok) throw new Error(start.reply || 'Generation could not start.');
      total = Number(start.totalRequested || 0);
      status(`Generation started · 0/${total} · ${start.concurrency || 1} AI worker(s)`);

      const onEvent = async (type, data) => {
        if (type === 'DISCOVERY_COMPLETED') {
          status(`Page discovery complete in ${data.durationMs || 0} ms · generating ${total} test case(s)…`);
        } else if (type === 'GENERATION_PLAN') {
          status(`${data.units?.length || total} generation unit(s) planned · AI generation in progress…`);
        } else if (type === 'BATCH_COMPLETED') {
          mergeGeneratedCases(data.cases || []);
          generatedCount = Math.max((testCases || []).length, Number(data.generatedSoFar || 0));
          renderGenerationPreview();
          status(`AI generation in progress · ${generatedCount}/${data.totalRequested || total} completed`);
        }
      };

      let completed;
      const platformToken = sessionStorage.getItem('aiTestPilotToken') || '';
      if (!platformToken && typeof EventSource === 'function') completed = await consumeEventSource(start.eventsUrl, onEvent);
      else completed = await consumeFetchStream(start.eventsUrl, onEvent);

      if (!completed) throw new Error('Generation stream ended before the suite completed.');
      mergeGeneratedCases(completed.cases || []);
      testCases = (testCases || []).map((tc) => ({ ...tc, source: tc.source || 'ai', automationReadiness: null }));
      setGenerationUi(false);
      renderCases();
      setActivityStatus('Checking readiness', true);
      status(`${testCases.length} test case(s) generated in ${((completed.durationMs || 0) / 1000).toFixed(1)}s · readiness validation starting…`);
    } catch (err) {
      setGenerationUi(false);
      showError(err.message || 'Generation failed.');
      setActivityStatus('Error', false);
      if ((testCases || []).length) renderCases(); else renderGenerationPreview();
    } finally {
      setGenerationUi(false);
      setBusy($('generateBtn'), false, '');
    }
  }

  function install() {
    if (!document.getElementById('generationStableStyles')) {
      const style = document.createElement('style');
      style.id = 'generationStableStyles';
      style.textContent = `
        html.generation-active,body.generation-active{overflow-y:auto!important;pointer-events:auto!important}
        body.generation-active #reviewFilterBar,body.generation-active .review-filter-bar,body.generation-active [data-review-filter-bar]{display:none!important}
        body.generation-active #cases{max-height:none!important;overflow:visible!important}
        body.generation-active .modal:not(.show){display:none!important}
        .generation-case-preview{padding:13px 14px;border-bottom:1px solid #eef1f6;background:#fff}
        .generation-case-preview-title{font-size:12px;font-weight:800;color:#111827}
        .generation-case-preview-meta{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
        .generation-case-preview-meta span{padding:3px 7px;border-radius:999px;background:#f1f5f9;color:#475569;font-size:9.5px;font-weight:800;text-transform:uppercase}
        .generation-case-preview-meta .pending{background:#dbeafe;color:#1d4ed8}
      `;
      document.head.appendChild(style);
    }
    const button = $('generateBtn');
    if (!button || button.dataset.progressiveGenerationInstalled === 'true') return;
    button.dataset.progressiveGenerationInstalled = 'true';
    button.addEventListener('click', progressiveGenerate, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true }); else install();
})();
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
    setActivityStatus('Generating 0', true);
  }

  function setGenerationUiState(active) {
    document.documentElement.classList.toggle('generation-active', active);
    document.body.classList.toggle('generation-active', active);
    if (active) {
      document.documentElement.style.overflowY = 'auto';
      document.body.style.overflowY = 'auto';
      document.body.style.overflowX = 'hidden';
    } else {
      document.documentElement.style.removeProperty('overflow-y');
      document.body.style.removeProperty('overflow-y');
      document.body.style.removeProperty('overflow-x');
    }
  }

  function queuedReadiness() {
    return {
      status: 'NEEDS_PREFLIGHT', automatable: false, reasonCode: 'READINESS_QUEUED',
      reason: 'Generated successfully. Readiness validation will begin when generation finishes.',
      reasons: ['Generated successfully. Readiness validation is queued.'], resolutionType: 'NONE', repairable: false,
      requiredInputs: [], evidence: [], automationPlan: null, assertionSuggestions: [], uncompiledExpectations: [], canSuggestAssertion: false, validationSource: 'queued'
    };
  }

  function escapeText(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }

  function renderStreamingPreview() {
    const casesEl = $('cases');
    if (!casesEl) return;
    const rows = (testCases || []).map((tc) => {
      const category = String(tc.testCategory || 'FUNCTIONAL').replaceAll('_',' ');
      const type = String(tc.type || 'functional');
      return `<div class="case generation-preview-case">
        <div></div>
        <div>
          <div class="case-title">${escapeText(tc.id)} — ${escapeText(tc.title)}</div>
          <div class="case-meta"><span class="tag">${escapeText(type)}</span><span class="tag">${escapeText(category)}</span><span class="tag preflight">Readiness queued</span></div>
        </div>
        <div></div>
      </div>`;
    }).join('');
    casesEl.innerHTML = rows || '<div class="empty">Generating first test case…</div>';
    if ($('caseCount')) $('caseCount').textContent = String((testCases || []).length);
  }

  let previewFrame = 0;
  function scheduleStreamingPreview() {
    if (previewFrame) return;
    previewFrame = requestAnimationFrame(() => {
      previewFrame = 0;
      renderStreamingPreview();
    });
  }

  function mergeIncoming(cases) {
    const existing = new Map((testCases || []).map((tc) => [String(tc.id || '').toUpperCase(), tc]));
    for (const tc of cases || []) existing.set(String(tc.id || '').toUpperCase(), { ...tc, source: tc.source || 'ai', automationReadiness: queuedReadiness() });
    testCases = [...existing.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    scheduleStreamingPreview();
  }

  async function consumeSse(url, onEvent) {
    const response = await fetch(url, { headers: { Accept: 'text/event-stream' }, cache: 'no-store' });
    if (!response.ok) {
      let message = `Generation stream failed (${response.status}).`;
      try { const body = await response.json(); message = body.reply || message; } catch {}
      throw new Error(message);
    }
    if (!response.body) throw new Error('Generation stream is unavailable in this browser.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, boundary).trim();
        buffer = buffer.slice(boundary + 2);
        if (!frame || frame.startsWith(':')) continue;
        let eventType = 'message', dataText = '';
        for (const line of frame.split(/\r?\n/)) {
          if (line.startsWith('event:')) eventType = line.slice(6).trim();
          else if (line.startsWith('data:')) dataText += line.slice(5).trim();
        }
        if (!dataText) continue;
        await onEvent(eventType, JSON.parse(dataText));
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
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
    window.__aiTestPilotProgressiveGenerationActive = true;
    window.__aiTestPilotSuspendReviewFilters = true;
    setGenerationUiState(true);
    resetExecutionState();
    renderStreamingPreview();
    if ($('caseSubtitle')) $('caseSubtitle').textContent = 'Starting generation · you can continue scrolling and reviewing the page';
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

    try {
      const startResponse = await fetch('/api/generation/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const start = await startResponse.json();
      if (!startResponse.ok) throw new Error(start.reply || 'Progressive generation could not start.');
      const total = Number(start.totalRequested || 0);
      if ($('caseSubtitle')) $('caseSubtitle').textContent = `Generation started · 0/${total} cases · ${start.concurrency || 1} worker(s)`;

      let completed = false;
      await consumeSse(start.eventsUrl, async (type, data) => {
        if (type === 'DISCOVERY_COMPLETED') {
          if ($('caseSubtitle')) $('caseSubtitle').textContent = `Page discovery complete in ${data.durationMs || 0} ms · generating test cases…`;
          return;
        }
        if (type === 'GENERATION_PLAN') {
          if ($('caseSubtitle')) $('caseSubtitle').textContent = `${data.units?.length || total} generation unit(s) planned · results will appear as they complete`;
          return;
        }
        if (type === 'BATCH_STARTED') {
          setActivityStatus(`Generating ${data.generatedSoFar || 0}/${data.totalRequested || total}`, true);
          return;
        }
        if (type === 'BATCH_COMPLETED') {
          mergeIncoming(data.cases || []);
          setActivityStatus(`Generating ${data.generatedSoFar || testCases.length}/${data.totalRequested || total}`, true);
          const scope = `${String(data.category || '').replaceAll('_',' ').toLowerCase()} / ${String(data.scenarioType || 'functional').toLowerCase()}`;
          if ($('caseSubtitle')) $('caseSubtitle').textContent = `${data.generatedSoFar || testCases.length}/${data.totalRequested || total} generated · ${scope} completed in ${((data.durationMs || 0) / 1000).toFixed(1)}s`;
          return;
        }
        if (type === 'GENERATION_COMPLETED') {
          completed = true;
          testCases = (data.cases || testCases).map((tc) => ({ ...tc, source: tc.source || 'ai', automationReadiness: null }));
          window.__aiTestPilotProgressiveGenerationActive = false;
          window.__aiTestPilotSuspendReviewFilters = false;
          setGenerationUiState(false);
          renderCases();
          setActivityStatus('Checking readiness', true);
          if ($('caseSubtitle')) $('caseSubtitle').textContent = `${testCases.length} test case(s) generated in ${((data.durationMs || 0) / 1000).toFixed(1)}s · readiness validation starting…`;
          return;
        }
        if (type === 'GENERATION_FAILED') throw new Error(data.message || 'Progressive generation failed.');
      });
      if (!completed) throw new Error('Generation stream ended before the suite completed.');
    } catch (err) {
      window.__aiTestPilotProgressiveGenerationActive = false;
      window.__aiTestPilotSuspendReviewFilters = false;
      setGenerationUiState(false);
      showError(err.message || 'Progressive generation failed.');
      setActivityStatus('Error', false);
      if (testCases.length) testCases = testCases.map((tc) => ({ ...tc, automationReadiness: null }));
      renderCases();
    } finally {
      window.__aiTestPilotSuspendReviewFilters = false;
      setGenerationUiState(false);
      setBusy($('generateBtn'), false, '');
    }
  }

  function install() {
    const style = document.createElement('style');
    style.textContent = `.generation-active{scroll-behavior:auto!important}.generation-preview-case{min-height:64px}.generation-preview-case .preflight{background:#dbeafe;color:#1d4ed8;font-weight:800}`;
    document.head.appendChild(style);
    const button = $('generateBtn');
    if (!button || button.dataset.progressiveGenerationInstalled === 'true') return;
    button.dataset.progressiveGenerationInstalled = 'true';
    button.addEventListener('click', progressiveGenerate, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true }); else install();
})();
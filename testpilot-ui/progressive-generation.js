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

  function queuedReadiness() {
    return {
      status: 'NEEDS_PREFLIGHT', automatable: false, reasonCode: 'READINESS_QUEUED',
      reason: 'Generated successfully. Deterministic readiness validation will begin when progressive generation finishes.',
      reasons: ['Generated successfully. Deterministic readiness validation is queued.'], resolutionType: 'NONE', repairable: false,
      requiredInputs: [], evidence: [], automationPlan: null, assertionSuggestions: [], uncompiledExpectations: [], canSuggestAssertion: false, validationSource: 'queued'
    };
  }

  function mergeIncoming(cases) {
    const existing = new Map((testCases || []).map((tc) => [String(tc.id || '').toUpperCase(), tc]));
    for (const tc of cases || []) existing.set(String(tc.id || '').toUpperCase(), { ...tc, source: tc.source || 'ai', automationReadiness: queuedReadiness() });
    testCases = [...existing.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    renderCases();
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
        try { await onEvent(eventType, JSON.parse(dataText)); } catch (err) { if (eventType === 'GENERATION_FAILED') throw err; }
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
    resetExecutionState();
    renderCases();
    $('cases').innerHTML = '<div class="activity-alert">Preparing progressive test generation…<small>Generated cases will appear here as each small AI work unit completes.</small></div>';
    setBusy($('generateBtn'), true, 'Generating test cases…');

    const selection = generationSelection();
    const paths = $('additionalPaths').value.split(',').map((v) => v.trim()).filter(Boolean);
    const payload = {
      sessionId, message: story, targetUrl, additionalPaths: paths,
      credentials: { username: $('username').value, password: $('password').value },
      aiModelTier: $('aiModelTier')?.value || 'fast',
      bypassDiscoveryCache: Boolean($('bypassDiscoveryCache')?.checked),
      selectedTestCategories: selection.categories,
      selectedScenarioTypes: selection.scenarioTypes,
      selectedSecuritySubcategories: selection.securitySubcategories,
      selectedSecuritySeverities: selection.securitySeverities,
    };

    try {
      const startResponse = await fetch('/api/generation/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const start = await startResponse.json();
      if (!startResponse.ok) throw new Error(start.reply || 'Progressive generation could not start.');
      const total = Number(start.totalRequested || 0);
      if ($('caseSubtitle')) $('caseSubtitle').textContent = `Progressive generation started · 0/${total} cases`;

      let completed = false;
      await consumeSse(start.eventsUrl, async (type, data) => {
        if (type === 'DISCOVERY_COMPLETED') {
          if ($('caseSubtitle')) $('caseSubtitle').textContent = `Page discovery complete · ${data.pageCount || 0} page(s) · generating first test…`;
          return;
        }
        if (type === 'GENERATION_PLAN') {
          const units = (data.units || []).slice(0, 5).map((u) => `${String(u.category || '').replaceAll('_',' ').toLowerCase()} / ${u.scenarioType || 'functional'}`);
          if ($('caseSubtitle')) $('caseSubtitle').textContent = `Generation plan ready · ${units.join(' · ')} · streaming results progressively`;
          return;
        }
        if (type === 'BATCH_STARTED') {
          setActivityStatus(`Generating ${data.generatedSoFar || 0}/${data.totalRequested || total}`, true);
          const scope = `${String(data.category || '').replaceAll('_',' ').toLowerCase()} / ${String(data.scenarioType || 'functional').toLowerCase()}`;
          if ($('caseSubtitle')) $('caseSubtitle').textContent = `Generating ${scope} · ${data.generatedSoFar || 0}/${data.totalRequested || total} available`;
          return;
        }
        if (type === 'BATCH_COMPLETED') {
          mergeIncoming(data.cases || []);
          setActivityStatus(`Generating ${data.generatedSoFar || testCases.length}/${data.totalRequested || total}`, true);
          const scope = `${String(data.category || '').replaceAll('_',' ').toLowerCase()} / ${String(data.scenarioType || 'functional').toLowerCase()}`;
          if ($('caseSubtitle')) $('caseSubtitle').textContent = `${data.generatedSoFar || testCases.length}/${data.totalRequested || total} generated · latest ${scope} in ${((data.durationMs || 0) / 1000).toFixed(1)}s · continuing…`;
          return;
        }
        if (type === 'GENERATION_COMPLETED') {
          completed = true;
          testCases = (data.cases || testCases).map((tc) => ({ ...tc, source: tc.source || 'ai', automationReadiness: null }));
          window.__aiTestPilotProgressiveGenerationActive = false;
          renderCases();
          setActivityStatus('Checking readiness', true);
          if ($('caseSubtitle')) $('caseSubtitle').textContent = `${testCases.length} test case(s) generated progressively in ${((data.durationMs || 0) / 1000).toFixed(1)}s · readiness validation starting…`;
          return;
        }
        if (type === 'GENERATION_FAILED') throw new Error(data.message || 'Progressive generation failed.');
      });
      if (!completed) throw new Error('Generation stream ended before the suite completed.');
    } catch (err) {
      window.__aiTestPilotProgressiveGenerationActive = false;
      showError(err.message || 'Progressive generation failed.');
      setActivityStatus('Error', false);
      if (testCases.length) testCases = testCases.map((tc) => ({ ...tc, automationReadiness: null }));
      renderCases();
    } finally { setBusy($('generateBtn'), false, ''); }
  }

  function install() {
    const button = $('generateBtn');
    if (!button || button.dataset.progressiveGenerationInstalled === 'true') return;
    button.dataset.progressiveGenerationInstalled = 'true';
    button.addEventListener('click', progressiveGenerate, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true }); else install();
})();
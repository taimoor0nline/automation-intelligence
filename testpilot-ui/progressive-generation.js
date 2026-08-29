(function () {
  function selected(selector, fallback = []) {
    const values = [...document.querySelectorAll(selector + ':checked')].map((el) => el.value).filter(Boolean);
    return values.length ? values : fallback;
  }

  function splitCustomValues(value) {
    return [...new Set(String(value || '').split(/[,|]/).map((item) => item.trim()).filter(Boolean))].slice(0, 20);
  }

  function generationSelection() {
    return {
      categories: selected('#generationCategoryMenu input[data-test-category]'),
      scenarioTypes: selected('#generationTypeMenu input[data-scenario-type]'),
      securitySubcategories: selected('#securitySubcategoryMenu input[data-security-subcategory]'),
      securitySeverities: selected('#securitySeverityMenu input[data-security-severity]'),
      customCategories: splitCustomValues(document.getElementById('generationCustomCategoriesInput')?.value),
      customScenarioTypes: splitCustomValues(document.getElementById('generationCustomScenarioTypesInput')?.value),
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
    document.getElementById('generationCoverageProposal')?.remove();
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

  function renderCoverageProposal(data) {
    const casesEl = $('cases');
    if (!casesEl) return;
    let box = document.getElementById('generationCoverageProposal');
    if (!box) {
      box = document.createElement('div');
      box.id = 'generationCoverageProposal';
      box.className = 'generation-coverage-proposal';
      casesEl.insertAdjacentElement('beforebegin', box);
    }
    const score = Math.max(0, Math.min(100, Number(data?.coverageScore ?? data?.score ?? 0) || 0));
    const count = Number(data?.proposedTestCaseCount ?? data?.proposedTestCaseCount ?? 0) || 0;
    const max = Number(data?.maxTestCases || 0) || 0;
    const summary = String(data?.coverageSummary || data?.summary || '').trim();
    const covered = Array.isArray(data?.coveredAreas) ? data.coveredAreas.filter(Boolean) : [];
    const gaps = Array.isArray(data?.knownGaps) ? data.knownGaps.filter(Boolean) : [];
    box.innerHTML = `
      <div class="generation-coverage-head">
        <div><strong>AI proposed requirement coverage</strong><span>This is an AI estimate of story/scenario coverage, not source-code coverage.</span></div>
        <div class="generation-coverage-score">${Math.round(score)}%</div>
      </div>
      <div class="generation-coverage-meta"><span>${count} test${count === 1 ? '' : 's'} proposed</span>${max ? `<span>Maximum ${max}</span>` : ''}</div>
      ${summary ? `<div class="generation-coverage-summary">${esc(summary)}</div>` : ''}
      ${(covered.length || gaps.length) ? `<details class="generation-coverage-details"><summary>Coverage details</summary>${covered.length ? `<div><b>Covered:</b> ${covered.map(esc).join(' · ')}</div>` : ''}${gaps.length ? `<div><b>Known gaps:</b> ${gaps.map(esc).join(' · ')}</div>` : ''}</details>` : ''}`;
  }

  function mergeGeneratedCases(incoming) {
    const map = new Map((testCases || []).map((tc) => [String(tc.id || '').toUpperCase(), tc]));
    for (const tc of incoming || []) {
      const key = String(tc.id || '').toUpperCase();
      if (!key) continue;
      const existing = map.get(key);
      map.set(key, {
        ...existing,
        ...tc,
        source: tc.source || existing?.source || 'ai',
        automationReadiness: tc.automationReadiness || existing?.automationReadiness || null,
        __readinessChecking: Boolean(tc.__readinessChecking ?? existing?.__readinessChecking),
      });
    }
    testCases = [...map.values()].sort((a, b) => String(a.id || '').localeCompare(String(b.id || ''), undefined, { numeric: true }));
  }

  function patchCase(id, patch) {
    const key = String(id || '').toUpperCase();
    const tc = (testCases || []).find((item) => String(item.id || '').toUpperCase() === key);
    if (tc) Object.assign(tc, patch);
    return tc;
  }

  function readinessLabel(tc) {
    const statusValue = String(tc?.automationReadiness?.status || '').toUpperCase();
    if (statusValue === 'READY') return { text: 'Automation Ready', cls: 'ready' };
    if (statusValue) return { text: statusValue.replaceAll('_', ' '), cls: 'blocked' };
    if (tc?.__readinessChecking) return { text: 'Checking readiness…', cls: 'checking' };
    if (tc?.__readinessError) return { text: 'Readiness error', cls: 'blocked' };
    return { text: 'Readiness pending', cls: 'pending' };
  }

  function renderGenerationPreview() {
    const casesEl = $('cases');
    if (!casesEl) return;
    const html = (testCases || []).map((tc) => {
      const category = String(tc.testCategory || 'FUNCTIONAL').replaceAll('_', ' ');
      const customCategory = tc.customCategory ? ` · ${tc.customCategory}` : '';
      const scenarioType = String(tc.customScenarioType || tc.type || 'positive');
      const priority = String(tc.priority || 'medium');
      const readiness = readinessLabel(tc);
      return `<div class="generation-case-preview">
        <div class="generation-case-preview-title">${esc(tc.id)} — ${esc(tc.title)}</div>
        <div class="generation-case-preview-meta">
          <span>${esc(scenarioType)}</span><span>${esc(category + customCategory)}</span><span>${esc(priority)}</span><span class="${readiness.cls}">${esc(readiness.text)}</span>
        </div>
      </div>`;
    }).join('');
    casesEl.innerHTML = html || '<div class="empty">Discovering the application and planning the smallest useful test suite…</div>';
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
      const types = [
        'GENERATION_STARTED','DISCOVERY_COMPLETED','COVERAGE_PLANNING_STARTED','GENERATION_PLAN','BATCH_STARTED','BATCH_COMPLETED',
        'READINESS_STARTED','READINESS_COMPLETED','READINESS_FAILED','READINESS_DRAINING',
        'GENERATION_COMPLETED','GENERATION_FAILED'
      ];
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

    const selection = generationSelection();
    if (!selection.categories.length) { showError('Select at least one Test Category.'); return; }
    if (!selection.scenarioTypes.length) { showError('Select at least one Scenario Type.'); return; }
    if (selection.categories.includes('CUSTOM') && !selection.customCategories.length) {
      showError('Enter at least one custom test category, separated by comma or |.'); return;
    }

    sessionId = 'run-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    humanCounter = 1;
    testCases = [];
    resetExecutionState();
    setGenerationUi(true);
    renderGenerationPreview();
    status('Discovering application and planning coverage…');
    setBusy($('generateBtn'), true, 'Planning & generating tests…');

    const securitySelected = selection.categories.includes('SECURITY');
    const paths = $('additionalPaths').value.split(',').map((v) => v.trim()).filter(Boolean);
    const credentials = { username: $('username').value, password: $('password').value };
    const payload = {
      sessionId, message: story, targetUrl, additionalPaths: paths,
      credentials,
      aiModelTier: $('aiModelTier')?.value || 'fast',
      bypassDiscoveryCache: Boolean($('bypassDiscoveryCache')?.checked),
      selectedTestCategories: selection.categories,
      selectedScenarioTypes: selection.scenarioTypes,
      customTestCategories: selection.customCategories,
      customScenarioTypes: selection.customScenarioTypes,
      selectedSecuritySubcategories: securitySelected ? selection.securitySubcategories : [],
      selectedSecuritySeverities: securitySelected ? selection.securitySeverities : [],
    };

    let generatedCount = 0;
    let readinessCompleted = 0;
    let total = 0;
    let maxCases = 0;
    let coverageScore = null;
    try {
      const startResponse = await fetch('/api/generation/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const start = await startResponse.json();
      if (!startResponse.ok) throw new Error(start.reply || 'Generation could not start.');
      maxCases = Number(start.maxTestCases || 0);
      status(`Discovery started · AI will choose the useful suite size${maxCases ? ` up to ${maxCases} cases` : ''}.`);

      const onEvent = async (type, data) => {
        if (type === 'DISCOVERY_COMPLETED') {
          status(`Page discovery complete in ${data.durationMs || 0} ms · AI planning requirement coverage…`);
        } else if (type === 'COVERAGE_PLANNING_STARTED') {
          maxCases = Number(data.maxTestCases || maxCases || 0);
          status(`AI is deciding the smallest useful suite${maxCases ? ` within the ${maxCases}-case limit` : ''}…`);
        } else if (type === 'GENERATION_PLAN') {
          total = Number(data.proposedTestCaseCount || data.units?.length || 0);
          maxCases = Number(data.maxTestCases || maxCases || 0);
          coverageScore = Number(data.coverageScore ?? 0);
          renderCoverageProposal(data);
          status(`AI proposed ${total} test case${total === 1 ? '' : 's'} · estimated requirement coverage ${Math.round(coverageScore)}% · generating now…`);
        } else if (type === 'BATCH_COMPLETED') {
          mergeGeneratedCases(data.cases || []);
          generatedCount = Math.max((testCases || []).length, Number(data.generatedSoFar || 0));
          total = Number(data.totalRequested || total || generatedCount);
          renderGenerationPreview();
          status(`AI generation ${generatedCount}/${total} · readiness ${readinessCompleted}/${generatedCount} checked${coverageScore == null ? '' : ` · proposed coverage ${Math.round(coverageScore)}%`}`);
        } else if (type === 'READINESS_STARTED') {
          patchCase(data.testCaseId, { __readinessChecking: true, __readinessError: null });
          renderGenerationPreview();
        } else if (type === 'READINESS_COMPLETED') {
          if (data.testCase) mergeGeneratedCases([{ ...data.testCase, __readinessChecking: false }]);
          else patchCase(data.testCaseId, { automationReadiness: data.readiness, __readinessChecking: false });
          readinessCompleted = Math.max(readinessCompleted, Number(data.completed || 0));
          renderGenerationPreview();
          status(`AI generation ${generatedCount}/${total || generatedCount} · readiness ${readinessCompleted}/${Math.max(generatedCount, readinessCompleted)} checked${coverageScore == null ? '' : ` · proposed coverage ${Math.round(coverageScore)}%`}`);
        } else if (type === 'READINESS_FAILED') {
          patchCase(data.testCaseId, { __readinessChecking: false, __readinessError: data.message || 'Readiness validation failed.' });
          renderGenerationPreview();
        } else if (type === 'READINESS_DRAINING') {
          status(`Generation complete · finishing ${Math.max(0, Number(data.generated || total) - Number(data.completed || 0))} readiness check(s)…`);
        }
      };

      let completed;
      const platformToken = sessionStorage.getItem('aiTestPilotToken') || '';
      if (!platformToken && typeof EventSource === 'function') completed = await consumeEventSource(start.eventsUrl, onEvent);
      else completed = await consumeFetchStream(start.eventsUrl, onEvent);

      if (!completed) throw new Error('Generation stream ended before the suite completed.');
      mergeGeneratedCases(completed.cases || []);
      if (completed.coverageProposal) {
        coverageScore = Number(completed.coverageProposal.score ?? coverageScore ?? 0);
        renderCoverageProposal({
          coverageScore,
          coverageSummary: completed.coverageProposal.summary,
          coveredAreas: completed.coverageProposal.coveredAreas,
          knownGaps: completed.coverageProposal.knownGaps,
          proposedTestCaseCount: completed.coverageProposal.proposedTestCaseCount || completed.totalGenerated,
          maxTestCases: completed.coverageProposal.maxTestCases || completed.maxTestCases || maxCases,
        });
      }
      setGenerationUi(false);
      renderCases();
      const ready = (testCases || []).filter((tc) => String(tc?.automationReadiness?.status || '').toUpperCase() === 'READY').length;
      setActivityStatus('Review required', false);
      status(`${testCases.length} AI-proposed test case(s) generated in ${((completed.durationMs || 0) / 1000).toFixed(1)}s · ${ready}/${testCases.length} Automation Ready${coverageScore == null ? '' : ` · proposed coverage ${Math.round(coverageScore)}%`}`);
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
        .generation-coverage-proposal{margin:0 18px 10px;padding:12px 14px;border:1px solid #cfe0ff;border-radius:12px;background:linear-gradient(135deg,#f8fbff,#f4f7ff);box-shadow:0 4px 14px rgba(47,91,255,.04)}
        .generation-coverage-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.generation-coverage-head strong{display:block;color:#172033;font-size:11.5px}.generation-coverage-head span{display:block;margin-top:3px;color:#667085;font-size:9.5px}.generation-coverage-score{min-width:58px;text-align:center;padding:7px 9px;border-radius:10px;background:#eaf0ff;color:#3155c8;font-size:17px;font-weight:900}.generation-coverage-meta{display:flex;gap:7px;flex-wrap:wrap;margin-top:8px}.generation-coverage-meta span{padding:3px 7px;border-radius:999px;background:#fff;border:1px solid #dce5ff;color:#475569;font-size:9.5px;font-weight:800}.generation-coverage-summary{margin-top:8px;color:#475569;font-size:10.5px;line-height:1.45}.generation-coverage-details{margin-top:7px;color:#667085;font-size:9.8px;line-height:1.5}.generation-coverage-details summary{cursor:pointer;color:#3857c8;font-weight:800}.generation-coverage-details div{margin-top:4px}
        .generation-case-preview{padding:13px 14px;border-bottom:1px solid #eef1f6;background:#fff}
        .generation-case-preview-title{font-size:12px;font-weight:800;color:#111827}
        .generation-case-preview-meta{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
        .generation-case-preview-meta span{padding:3px 7px;border-radius:999px;background:#f1f5f9;color:#475569;font-size:9.5px;font-weight:800;text-transform:uppercase}
        .generation-case-preview-meta .pending{background:#dbeafe;color:#1d4ed8}
        .generation-case-preview-meta .checking{background:#fef3c7;color:#92400e}
        .generation-case-preview-meta .ready{background:#dcfce7;color:#15803d}
        .generation-case-preview-meta .blocked{background:#ffedd5;color:#9a3412}
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

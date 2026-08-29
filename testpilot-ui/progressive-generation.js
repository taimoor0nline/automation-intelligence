(function () {
  const READINESS_CONCURRENCY = 2;

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
      const existing = map.get(key);
      map.set(key, {
        ...existing,
        ...tc,
        source: tc.source || existing?.source || 'ai',
        automationReadiness: tc.automationReadiness || existing?.automationReadiness || null,
      });
    }
    testCases = [...map.values()].sort((a, b) => String(a.id || '').localeCompare(String(b.id || ''), undefined, { numeric: true }));
  }

  function readinessLabel(tc) {
    const statusValue = String(tc?.automationReadiness?.status || '').toUpperCase();
    if (statusValue === 'READY') return { text: 'Automation Ready', cls: 'ready' };
    if (statusValue) return { text: statusValue.replaceAll('_', ' '), cls: 'blocked' };
    if (tc?.__readinessChecking) return { text: 'Checking readiness…', cls: 'checking' };
    return { text: 'Readiness pending', cls: 'pending' };
  }

  function renderGenerationPreview() {
    const casesEl = $('cases');
    if (!casesEl) return;
    const html = (testCases || []).map((tc) => {
      const category = String(tc.testCategory || 'FUNCTIONAL').replaceAll('_', ' ');
      const scenarioType = String(tc.type || 'functional');
      const priority = String(tc.priority || 'medium');
      const readiness = readinessLabel(tc);
      return `<div class="generation-case-preview">
        <div class="generation-case-preview-title">${esc(tc.id)} — ${esc(tc.title)}</div>
        <div class="generation-case-preview-meta">
          <span>${esc(scenarioType)}</span><span>${esc(category)}</span><span>${esc(priority)}</span><span class="${readiness.cls}">${esc(readiness.text)}</span>
        </div>
      </div>`;
    }).join('');
    casesEl.innerHTML = html || '<div class="empty">Waiting for the first generated test case…</div>';
    if ($('caseCount')) $('caseCount').textContent = String((testCases || []).length);
  }

  function createReadinessQueue(credentials) {
    const queue = [];
    const pending = new Set();
    let active = 0;
    let stopped = false;

    function pump() {
      if (stopped) return;
      while (active < READINESS_CONCURRENCY && queue.length) {
        const tc = queue.shift();
        active += 1;
        tc.__readinessChecking = true;
        renderGenerationPreview();
        const task = fetch('/api/test-cases/revalidate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            testCases: [tc],
            credentials,
            batchIndex: 1,
            batchCount: 2,
            totalCases: 9999,
          }),
        })
          .then(async (response) => {
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.reply || `Readiness validation failed (${response.status}).`);
            const assessed = data.testCases?.[0];
            if (assessed) mergeGeneratedCases([assessed]);
          })
          .catch((error) => {
            tc.__readinessError = error.message || 'Readiness validation failed.';
          })
          .finally(() => {
            tc.__readinessChecking = false;
            active -= 1;
            pending.delete(task);
            renderGenerationPreview();
            pump();
          });
        pending.add(task);
      }
    }

    return {
      enqueue(tc) { if (!stopped && tc) { queue.push(tc); pump(); } },
      async drain() {
        while (queue.length || active || pending.size) {
          if (pending.size) await Promise.allSettled([...pending]);
          else await new Promise((resolve) => setTimeout(resolve, 0));
        }
      },
      stop() { stopped = true; queue.length = 0; },
    };
  }

  async function synchronizeFinalReadiness(credentials) {
    if (!(testCases || []).length) return;
    const response = await fetch('/api/test-cases/revalidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        testCases,
        credentials,
        batchIndex: 1,
        batchCount: 1,
        totalCases: testCases.length,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.reply || `Final readiness synchronization failed (${response.status}).`);
    mergeGeneratedCases(data.testCases || []);
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
    const credentials = { username: $('username').value, password: $('password').value };
    const payload = {
      sessionId, message: story, targetUrl, additionalPaths: paths,
      credentials,
      aiModelTier: $('aiModelTier')?.value || 'fast',
      bypassDiscoveryCache: Boolean($('bypassDiscoveryCache')?.checked),
      selectedTestCategories: selection.categories,
      selectedScenarioTypes: selection.scenarioTypes,
      selectedSecuritySubcategories: securitySelected ? selection.securitySubcategories : [],
      selectedSecuritySeverities: securitySelected ? selection.securitySeverities : [],
    };

    let generatedCount = 0;
    let total = 0;
    const readinessQueue = createReadinessQueue(credentials);
    try {
      const startResponse = await fetch('/api/generation/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const start = await startResponse.json();
      if (!startResponse.ok) throw new Error(start.reply || 'Generation could not start.');
      total = Number(start.totalRequested || 0);
      status(`Generation started · 0/${total} · ${start.concurrency || 1} AI worker(s) · readiness runs in parallel`);

      const onEvent = async (type, data) => {
        if (type === 'DISCOVERY_COMPLETED') {
          status(`Page discovery complete in ${data.durationMs || 0} ms · generating ${total} test case(s)…`);
        } else if (type === 'GENERATION_PLAN') {
          status(`${data.units?.length || total} generation unit(s) planned · generation + readiness running concurrently…`);
        } else if (type === 'BATCH_COMPLETED') {
          const incoming = data.cases || [];
          mergeGeneratedCases(incoming);
          for (const tc of incoming) {
            const current = (testCases || []).find((item) => String(item.id).toUpperCase() === String(tc.id).toUpperCase());
            if (current) readinessQueue.enqueue(current);
          }
          generatedCount = Math.max((testCases || []).length, Number(data.generatedSoFar || 0));
          renderGenerationPreview();
          const checked = (testCases || []).filter((tc) => tc.automationReadiness).length;
          status(`AI generation ${generatedCount}/${data.totalRequested || total} · readiness ${checked}/${generatedCount} checked`);
        }
      };

      let completed;
      const platformToken = sessionStorage.getItem('aiTestPilotToken') || '';
      if (!platformToken && typeof EventSource === 'function') completed = await consumeEventSource(start.eventsUrl, onEvent);
      else completed = await consumeFetchStream(start.eventsUrl, onEvent);

      if (!completed) throw new Error('Generation stream ended before the suite completed.');
      mergeGeneratedCases(completed.cases || []);
      status(`Generation complete · finishing readiness checks…`);
      await readinessQueue.drain();
      await synchronizeFinalReadiness(credentials);

      setGenerationUi(false);
      renderCases();
      const ready = (testCases || []).filter((tc) => String(tc?.automationReadiness?.status || '').toUpperCase() === 'READY').length;
      setActivityStatus('Review required', false);
      status(`${testCases.length} test case(s) generated in ${((completed.durationMs || 0) / 1000).toFixed(1)}s · ${ready}/${testCases.length} Automation Ready`);
    } catch (err) {
      readinessQueue.stop();
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
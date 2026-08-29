(function () {
  let databaseConfigured = false;
  let observer = null;

  function tryInsert() {
    if (!databaseConfigured) return false;
    const token = sessionStorage.getItem('aiTestPilotToken') || '';
    const switcher = document.getElementById('testModeSwitch');
    if (!token || !switcher) return false;
    if (document.getElementById('testReportsLink')) return true;

    const link = document.createElement('a');
    link.id = 'testReportsLink';
    link.href = '/reports.html';
    link.textContent = 'Reports';
    link.title = 'Role-aware historical test reports';
    switcher.appendChild(link);
    return true;
  }

  async function start() {
    try {
      const health = window.aiTestPilotHealth
        ? await window.aiTestPilotHealth
        : await fetch('/health').then((r) => r.json());
      databaseConfigured = Boolean(health.database?.configured);
      if (!databaseConfigured) return;

      if (tryInsert()) return;
      observer = new MutationObserver(() => {
        if (tryInsert()) observer?.disconnect();
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true });

      const timer = setInterval(() => {
        if (tryInsert()) {
          clearInterval(timer);
          observer?.disconnect();
        }
      }, 500);
    } catch {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();

(function () {
  if (window.__aiTestPilotExecutionStreaming) return;
  window.__aiTestPilotExecutionStreaming = true;

  const esc = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  function testCaseId(test) {
    return String(test?.testCaseId || String(test?.title || '').match(/TC(?:\d{3}|-H\d{3})/i)?.[0] || '').toUpperCase();
  }

  function evidenceUrl(test) {
    if (test?.evidence?.screenshotUrl) return test.evidence.screenshotUrl;
    const id = testCaseId(test);
    return id ? `/api/artifacts/${encodeURIComponent(sessionId)}/screenshot/${encodeURIComponent(id)}` : '';
  }

  async function openEvidence(url) {
    if (!url) return;
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      let message = `Screenshot evidence is unavailable (${response.status}).`;
      try {
        const data = await response.json();
        if (data?.reply) message = data.reply;
      } catch {}
      throw new Error(message);
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const popup = window.open(objectUrl, '_blank', 'noopener');
    if (!popup) {
      const link = document.createElement('a');
      link.href = objectUrl;
      link.target = '_blank';
      link.rel = 'noopener';
      link.click();
    }
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
  }

  function screenshotControl(test) {
    if (!test?.evidence?.screenshotAvailable) return '';
    const url = evidenceUrl(test);
    if (!url) return '';
    return `<div class="result-evidence"><button type="button" class="evidence-open" data-evidence-url="${esc(url)}" style="font-size:10.5px;font-weight:700;color:var(--blue);border:1px solid #dbe3ff;background:#f5f7ff;border-radius:6px;padding:4px 7px;cursor:pointer">Open screenshot</button></div>`;
  }

  function failedCaseActions(test) {
    if (!test?.fail) return '';
    const id = testCaseId(test);
    if (!id) return '';
    return `<div class="result-retest-actions" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button type="button" class="btn ghost individual-retest" data-test-case-id="${esc(id)}">Re-test This Test</button><button type="button" class="btn ghost edit-failed-test" data-test-case-id="${esc(id)}">Edit / Rewrite Test</button></div>`;
  }

  function decorateFinalEvidence(summary) {
    const results = document.getElementById('results');
    if (!results || !Array.isArray(summary?.tests)) return;
    const rows = [...results.querySelectorAll('.result')];
    summary.tests.forEach((test, index) => {
      const row = rows[index];
      if (!row) return;
      const title = row.querySelector('.result-title') || row.firstElementChild;
      if (!title) return;
      if (test?.evidence?.screenshotAvailable && !row.querySelector('.evidence-open')) title.insertAdjacentHTML('beforeend', screenshotControl(test));
      if (test?.fail && !row.querySelector('.result-retest-actions')) title.insertAdjacentHTML('beforeend', failedCaseActions(test));
    });
  }

  function installResultHandlers() {
    if (window.__aiTestPilotResultHandlers) return;
    window.__aiTestPilotResultHandlers = true;
    document.addEventListener('click', async (event) => {
      const evidenceButton = event.target.closest('.evidence-open[data-evidence-url]');
      if (evidenceButton) {
        event.preventDefault();
        const original = evidenceButton.textContent;
        evidenceButton.disabled = true;
        evidenceButton.textContent = 'Opening…';
        try {
          await openEvidence(evidenceButton.dataset.evidenceUrl);
        } catch (err) {
          if (typeof showError === 'function') showError(err.message);
          else alert(err.message);
        } finally {
          evidenceButton.disabled = false;
          evidenceButton.textContent = original;
        }
        return;
      }

      const editButton = event.target.closest('.edit-failed-test[data-test-case-id]');
      if (editButton) {
        event.preventDefault();
        const id = String(editButton.dataset.testCaseId || '').toUpperCase();
        const index = Array.isArray(testCases) ? testCases.findIndex((tc) => String(tc?.id || '').toUpperCase() === id) : -1;
        if (index < 0) {
          if (typeof showError === 'function') showError(`Could not find ${id} in the reviewed test cases.`);
          return;
        }
        const hint = document.getElementById('runHint');
        if (hint) hint.textContent = `${id} opened for editing. Save it, wait for Automation Ready, then re-test only this case.`;
        if (typeof window.openEditor === 'function') window.openEditor(index);
        else if (typeof openEditor === 'function') openEditor(index);
        return;
      }

      const retestButton = event.target.closest('.individual-retest[data-test-case-id]');
      if (retestButton) {
        event.preventDefault();
        const id = String(retestButton.dataset.testCaseId || '').toUpperCase();
        const tc = Array.isArray(testCases) ? testCases.find((item) => String(item?.id || '').toUpperCase() === id) : null;
        if (!tc) {
          if (typeof showError === 'function') showError(`Could not find ${id} in the reviewed test cases.`);
          return;
        }
        if (tc.automationReadiness?.status !== 'READY') {
          if (typeof showError === 'function') showError(`${id} must be Automation Ready before it can be re-tested. Save any edits and wait for readiness validation to complete.`);
          return;
        }
        retestButton.disabled = true;
        retestButton.textContent = 'Starting re-test…';
        try {
          await executeApprovedIds([id], { individual: true, testCaseId: id });
        } finally {
          if (document.body.contains(retestButton)) {
            retestButton.disabled = false;
            retestButton.textContent = 'Re-test This Test';
          }
        }
      }
    });
  }

  function renderLiveProgress(progress) {
    if (!progress) return;
    const total = Number(progress.total || 0);
    const completed = Number(progress.completed || 0);
    const passed = Number(progress.passed || 0);
    const failed = Number(progress.failed || 0);

    const totalEl = document.getElementById('mTotal');
    const passedEl = document.getElementById('mPassed');
    const failedEl = document.getElementById('mFailed');
    const rateEl = document.getElementById('mRate');
    if (totalEl) totalEl.textContent = total;
    if (passedEl) passedEl.textContent = passed;
    if (failedEl) failedEl.textContent = failed;
    if (rateEl) rateEl.textContent = completed ? Math.round((passed / completed) * 100) + '%' : '0%';

    const statusValue = String(progress.status || '').toUpperCase();
    const status = document.getElementById('runStatus');
    if (status) {
      if (statusValue === 'FINALIZING') status.textContent = 'Finalizing';
      else if (statusValue === 'DONE') status.textContent = 'Completed';
      else if (statusValue === 'FAILED') status.textContent = 'Error';
      else status.textContent = `Running ${completed}/${total}`;
      status.classList.toggle('activity-pill', !['DONE', 'FAILED'].includes(statusValue));
    }

    const results = document.getElementById('results');
    if (!results) return;
    const rows = Array.isArray(progress.tests) ? progress.tests.map((test) => {
      const duration = test.durationMs == null ? '' : `<div class="expected">Duration: ${esc(test.durationMs)} ms</div>`;
      const error = test.err?.message ? `<div class="expected">${esc(test.err.message).slice(0, 260)}</div>` : '';
      return `<div class="result"><div class="result-title">${esc(test.title)}${duration}${error}${screenshotControl(test)}</div><span class="badge ${test.pass ? 'pass' : 'fail'}">${test.pass ? 'PASS' : 'FAIL'}</span></div>`;
    }).join('') : '';

    const remaining = Math.max(0, total - completed);
    let waiting = '';
    if (progress.type === 'TEST_STARTED' && progress.currentTestCaseId) {
      waiting = `<div class="empty" style="padding:18px 12px">Executing ${esc(progress.currentTestCaseId)} in a controlled Chrome instance…</div>`;
    } else if (statusValue === 'FINALIZING') {
      waiting = '<div class="empty" style="padding:18px 12px">All tests executed · verifying final Chromium cleanup and preparing results…</div>';
    } else if (remaining > 0 && statusValue !== 'DONE') {
      waiting = `<div class="empty" style="padding:18px 12px">${remaining} test${remaining === 1 ? '' : 's'} remaining · the next approved test will start after evidence capture and browser cleanup.</div>`;
    }
    results.innerHTML = rows + waiting;
  }

  function processSseBlock(block, state) {
    const lines = String(block || '').split(/\r?\n/);
    let eventType = 'message';
    const dataLines = [];
    for (const line of lines) {
      if (line.startsWith(':')) continue;
      if (line.startsWith('event:')) eventType = line.slice(6).trim();
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (!dataLines.length) return;
    try {
      const event = JSON.parse(dataLines.join('\n'));
      event.type = event.type || eventType;
      state.lastEvent = event;
      renderLiveProgress(event);
      const terminalStatus = String(event.status || '').toUpperCase();
      if (event.type === 'RUN_COMPLETED' || terminalStatus === 'DONE') {
        state.completed = true;
        state.terminal = 'DONE';
      } else if (event.type === 'RUN_FAILED' || terminalStatus === 'FAILED') {
        state.completed = true;
        state.terminal = 'FAILED';
        state.error = event.error || 'Execution failed.';
      }
    } catch (err) {
      console.warn('[execution-sse] Could not parse event', err);
    }
  }

  async function streamExecution(state) {
    const response = await fetch(`/api/test-runs/events/${encodeURIComponent(sessionId)}`, {
      method: 'GET',
      headers: { Accept: 'text/event-stream' },
      cache: 'no-store',
      signal: state.controller.signal,
    });
    if (!response.ok) throw new Error(`Execution event stream failed (${response.status}).`);
    if (!response.body) throw new Error('Execution event stream is not supported by this browser.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (!state.completed) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          processSseBlock(block, state);
          if (state.completed) break;
          boundary = buffer.indexOf('\n\n');
        }
      }
      if (!state.completed && buffer.trim()) processSseBlock(buffer, state);
      if (state.completed) {
        try { await reader.cancel(); } catch {}
      }
    } catch (err) {
      if (err?.name !== 'AbortError') throw err;
    } finally {
      try { reader.releaseLock(); } catch {}
    }
  }

  async function loadFinalResult() {
    const response = await fetch(`/api/test-runs/result/${encodeURIComponent(sessionId)}`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.reply || 'Final execution result is unavailable.');
    return data;
  }

  function setFinishedButton(runButton, label = 'Re-test Approved Tests') {
    if (!runButton) return;
    runButton.dataset.oldText = label;
    runButton.textContent = label;
    runButton.disabled = false;
    runButton.style.display = 'inline-flex';
  }

  async function executeApprovedIds(approvedIds, options = {}) {
    const approved = (approvedIds || []).map((id) => String(id || '')).filter(Boolean);
    if (!approved.length) {
      if (typeof showError === 'function') showError('Select at least one test case.');
      return null;
    }

    const runButton = document.getElementById('runBtn');
    let executionStarted = false;
    const singleId = options.individual ? String(options.testCaseId || approved[0]) : '';
    if (typeof clearError === 'function') clearError();
    if (runButton) setBusy(runButton, true, singleId ? `Re-testing ${singleId}…` : 'Starting tests…');
    setActivityStatus(singleId ? `Starting ${singleId}` : 'Starting execution', true);
    window.dispatchEvent(new CustomEvent('testnexus:execution-starting', { detail: { approvedIds: approved, individual: Boolean(options.individual), testCaseId: singleId || null } }));

    const results = document.getElementById('results');
    if (results) {
      results.innerHTML = singleId
        ? `<div class="activity-alert">Starting individual re-test ${esc(singleId)}…<small>This creates a new one-test execution run. The earlier suite run remains available in history.</small></div>`
        : `<div class="activity-alert">Starting browser execution…<small>${approved.length} approved test${approved.length === 1 ? '' : 's'} will execute one-by-one. Each test captures evidence, closes its controlled Chrome instance, then continues with the next approved test.</small></div>`;
    }
    const analysis = document.getElementById('analysis');
    if (analysis) analysis.innerHTML = '';
    const reportBox = document.getElementById('reportBox');
    if (reportBox) reportBox.style.display = 'none';
    const reportActions = document.getElementById('executionReportActions');
    if (reportActions) reportActions.style.display = 'none';

    const streamState = { controller: new AbortController(), completed: false, error: null, terminal: null, lastEvent: null };
    let streamPromise = null;
    try {
      streamPromise = streamExecution(streamState);
      const startResponse = await fetch('/api/test-runs/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, approvedIds: approved, reviewedTestCases: testCases }),
      });
      const startData = await startResponse.json();
      if (!startResponse.ok) throw new Error(startData.reply || 'Could not start execution.');

      executionStarted = true;
      setActivityStatus(`Running 0/${startData.total}`, true);
      window.dispatchEvent(new CustomEvent('testnexus:execution-started', { detail: { total: startData.total, approvedIds: approved, individual: Boolean(options.individual), testCaseId: singleId || null } }));

      await streamPromise;
      if (streamState.error) throw new Error(streamState.error);

      const finalData = await loadFinalResult();
      if (typeof window.renderResults === 'function') window.renderResults(finalData.summary, []);
      else if (typeof renderResults === 'function') renderResults(finalData.summary, []);
      setTimeout(() => decorateFinalEvidence(finalData.summary), 0);

      setActivityStatus('Completed', false);
      if (runButton) runButton.dataset.oldText = 'Re-test Approved Tests';
      window.dispatchEvent(new CustomEvent('testnexus:execution-completed', {
        detail: {
          summary: finalData.summary,
          reportUrl: null,
          approvedIds: approved,
          individual: Boolean(options.individual),
          testCaseId: singleId || null,
        }
      }));
      return finalData;
    } catch (err) {
      streamState.controller.abort();
      if (streamPromise) await streamPromise.catch(() => {});
      if (typeof showError === 'function') showError(err.message || 'Execution failed.');
      setActivityStatus('Error', false);
      if (executionStarted && runButton) runButton.dataset.oldText = 'Re-test Approved Tests';
      window.dispatchEvent(new CustomEvent('testnexus:execution-failed', {
        detail: { error: err.message || 'Execution failed.', approvedIds: approved, executionStarted, individual: Boolean(options.individual), testCaseId: singleId || null }
      }));
      return null;
    } finally {
      streamState.controller.abort();
      if (runButton) {
        setBusy(runButton, false, '');
        if (executionStarted) setFinishedButton(runButton);
        else {
          runButton.dataset.oldText = 'Start Tests';
          runButton.textContent = 'Start Tests';
        }
      }
    }
  }

  window.testNexusExecuteApprovedIds = executeApprovedIds;

  function install() {
    installResultHandlers();
    const oldButton = document.getElementById('runBtn');
    if (!oldButton || oldButton.dataset.streamingExecution === '1') return;

    const runButton = oldButton.cloneNode(true);
    runButton.dataset.streamingExecution = '1';
    oldButton.replaceWith(runButton);

    runButton.addEventListener('click', async () => {
      const approved = [...document.querySelectorAll('.case-check:checked')].map((el) => el.value);
      await executeApprovedIds(approved, { individual: false });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();
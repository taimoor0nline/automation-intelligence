(function () {
  if (window.__testNexusExecutionControls) return;
  window.__testNexusExecutionControls = true;

  const START_LABEL = 'Start Tests';
  const RETEST_LABEL = 'Re-test Approved Tests';
  let cancellationRequested = false;
  let resetting = false;
  let lastApprovedIds = [];
  let hasCompletedExecution = false;

  function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

  function sid() {
    try {
      if (window.sessionId) return window.sessionId;
      if (typeof sessionId !== 'undefined') return sessionId;
    } catch {}
    return '';
  }

  function authHeaders(extra) {
    const headers = { ...(extra || {}) };
    try {
      const token = sessionStorage.getItem('aiTestPilotToken') || '';
      if (token) headers.Authorization = `Bearer ${token}`;
    } catch {}
    return headers;
  }

  function checkedIds() {
    return Array.from(document.querySelectorAll('.case-check:checked'))
      .map((el) => String(el.value || ''))
      .filter(Boolean);
  }

  function applyApprovedIds(ids) {
    const wanted = new Set((ids || []).map((id) => String(id).toUpperCase()));
    if (!wanted.size) return;
    for (const checkbox of document.querySelectorAll('.case-check')) {
      checkbox.checked = wanted.has(String(checkbox.value || '').toUpperCase());
    }
  }

  function statusText() {
    return String(document.getElementById('runStatus')?.textContent || '').trim().toLowerCase();
  }

  function isRunningStatus(value = statusText()) {
    return value.startsWith('starting') || value.startsWith('running') || value === 'finalizing' || value === 'stopping' || value === 'cancelling';
  }

  function hasReviewedCases() {
    try { return Array.isArray(testCases) && testCases.length > 0; } catch { return false; }
  }

  function hasExecutionData() {
    if (document.querySelector('#results .result')) return true;
    return Number(document.getElementById('mTotal')?.textContent || 0) > 0;
  }

  function ensureStyles() {
    if (document.getElementById('executionControlStyles')) return;
    const style = document.createElement('style');
    style.id = 'executionControlStyles';
    style.textContent = `
      .execution-run-actions{display:flex;align-items:center;gap:8px;margin-left:auto;flex-wrap:wrap;justify-content:flex-end}
      .runbar .execution-run-actions .btn{margin-left:0!important}
      #stopExecutionBtn,#resetExecutionBtn{display:none;white-space:nowrap}
      #stopExecutionBtn{border-color:#fecaca;color:#b91c1c;background:#fff7f7}
      #stopExecutionBtn:hover{background:#fee2e2}
      #resetExecutionBtn{border-color:#dbe3ef;background:#f8fafc;color:#334155}
      #resetExecutionBtn:hover{background:#eef2f7}
      #resetExecutionBtn:disabled,#stopExecutionBtn:disabled{opacity:.5;cursor:not-allowed}
      @media(max-width:760px){.runbar{align-items:flex-start;flex-direction:column}.execution-run-actions{width:100%;margin-left:0;justify-content:flex-start}}
    `;
    document.head.appendChild(style);
  }

  function setRunLabel(text, force = false) {
    const button = document.getElementById('runBtn');
    if (!button) return;
    button.dataset.oldText = text;
    if (force || !button.disabled) button.textContent = text;
  }

  function clearExecutionUi() {
    ['mTotal', 'mPassed', 'mFailed'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = '0';
    });
    const rate = document.getElementById('mRate');
    if (rate) rate.textContent = '0%';
    const results = document.getElementById('results');
    if (results) results.innerHTML = '<div class="empty">Waiting for execution.</div>';
    const analysis = document.getElementById('analysis');
    if (analysis) analysis.innerHTML = '';
    document.getElementById('analysisStreamShell')?.remove();
    const reportBox = document.getElementById('reportBox');
    if (reportBox) reportBox.style.display = 'none';
    const reportLink = document.getElementById('reportLink');
    if (reportLink) reportLink.removeAttribute('href');
    const reportActions = document.getElementById('executionReportActions');
    if (reportActions) reportActions.style.display = 'none';
    try { if (typeof clearError === 'function') clearError(); } catch {}
  }

  function ensureControls() {
    ensureStyles();
    const runBtn = document.getElementById('runBtn');
    const runbar = runBtn?.closest('.runbar');
    if (!runBtn || !runbar) return;

    let actions = document.getElementById('executionRunActions');
    if (!actions) {
      actions = document.createElement('div');
      actions.id = 'executionRunActions';
      actions.className = 'execution-run-actions';
      runbar.appendChild(actions);
    }

    if (!document.getElementById('stopExecutionBtn')) {
      const stop = document.createElement('button');
      stop.id = 'stopExecutionBtn';
      stop.type = 'button';
      stop.className = 'btn ghost';
      stop.textContent = 'Stop Execution';
      stop.addEventListener('click', stopExecution);
      actions.appendChild(stop);
    }

    if (!document.getElementById('resetExecutionBtn')) {
      const reset = document.createElement('button');
      reset.id = 'resetExecutionBtn';
      reset.type = 'button';
      reset.className = 'btn ghost';
      reset.textContent = 'Reset Execution';
      reset.addEventListener('click', resetExecution);
      actions.appendChild(reset);
    }

    if (runBtn.parentElement !== actions) actions.appendChild(runBtn);
    refreshControls();
  }

  async function requestCancellation(session) {
    const response = await fetch(`/api/test-runs/cancel/${encodeURIComponent(session)}`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: '{}',
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.reply || 'Could not stop the automation execution.');
    return data;
  }

  async function requestStopUntilAccepted(session) {
    let data = null;
    for (let attempt = 0; attempt < 16; attempt += 1) {
      data = await requestCancellation(session);
      if (data.cancelled) return data;
      if (String(data.state || '').toUpperCase() !== 'RUNNING') return data;
      await delay(250);
    }
    if (!data?.cancelled && String(data?.state || '').toUpperCase() === 'RUNNING') {
      throw new Error('The execution is still preparing. Try Stop Execution again in a moment.');
    }
    return data;
  }

  async function stopExecution() {
    const session = sid();
    if (!session || cancellationRequested || resetting) return;
    if (!window.confirm('Stop the currently running execution? Any unfinished test cases will stop, while the reviewed test suite will remain available for re-test.')) return;

    const button = document.getElementById('stopExecutionBtn');
    cancellationRequested = true;
    if (button) { button.disabled = true; button.textContent = 'Stopping…'; }
    try {
      try { if (typeof setActivityStatus === 'function') setActivityStatus('Stopping', true); } catch {}
      await requestStopUntilAccepted(session);
      finishStopped();
    } catch (err) {
      cancellationRequested = false;
      try { if (typeof showError === 'function') showError(err.message); } catch {}
      if (button) { button.disabled = false; button.textContent = 'Stop Execution'; }
      refreshControls();
    }
  }

  function finishStopped() {
    cancellationRequested = false;
    hasCompletedExecution = true;
    const stop = document.getElementById('stopExecutionBtn');
    if (stop) { stop.disabled = false; stop.textContent = 'Stop Execution'; stop.style.display = 'none'; }
    try { if (typeof clearError === 'function') clearError(); } catch {}
    try { if (typeof setActivityStatus === 'function') setActivityStatus('Stopped', false); } catch {}
    const results = document.getElementById('results');
    if (results) results.innerHTML = '<div class="empty">Execution stopped. Reviewed test cases remain available for re-test.</div>';
    const runBtn = document.getElementById('runBtn');
    if (runBtn && hasReviewedCases()) runBtn.disabled = checkedIds().length === 0;
    setRunLabel(RETEST_LABEL, true);
    refreshControls();
  }

  async function requestReset(session) {
    const response = await fetch(`/api/test-runs/reset/${encodeURIComponent(session)}`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: '{}',
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  }

  async function resetExecution() {
    if (resetting) return;
    const session = sid();
    if (!session) return;

    const running = isRunningStatus();
    const prompt = running
      ? 'Stop the current execution and reset Execution & Analytics? Reviewed test cases and run history will be preserved.'
      : 'Reset the current Execution & Analytics view? Reviewed test cases and run history will be preserved.';
    if (!window.confirm(prompt)) return;

    const button = document.getElementById('resetExecutionBtn');
    resetting = true;
    if (button) { button.disabled = true; button.textContent = running ? 'Stopping & resetting…' : 'Resetting…'; }

    try {
      if (running) {
        cancellationRequested = false;
        try { if (typeof setActivityStatus === 'function') setActivityStatus('Stopping', true); } catch {}
        await requestStopUntilAccepted(session);
      }

      let result = null;
      for (let attempt = 0; attempt < 32; attempt += 1) {
        result = await requestReset(session);
        if (result.ok) break;
        if (result.status !== 409) throw new Error(result.data.reply || 'Could not reset Execution & Analytics.');
        await delay(250);
      }
      if (!result?.ok) throw new Error(result?.data?.reply || 'Execution is still stopping. Try Reset Execution again in a moment.');

      const data = result.data || {};
      if (Array.isArray(data.approvedIds) && data.approvedIds.length) lastApprovedIds = [...data.approvedIds];
      clearExecutionUi();
      applyApprovedIds(lastApprovedIds);
      hasCompletedExecution = false;
      try { if (typeof setActivityStatus === 'function') setActivityStatus(hasReviewedCases() ? 'Ready' : 'Idle', false); } catch {}
      const runBtn = document.getElementById('runBtn');
      if (runBtn) runBtn.disabled = !hasReviewedCases() || checkedIds().length === 0;
      setRunLabel(START_LABEL, true);
    } catch (err) {
      try { if (typeof showError === 'function') showError(err.message); } catch {}
    } finally {
      cancellationRequested = false;
      resetting = false;
      if (button) { button.disabled = false; button.textContent = 'Reset Execution'; }
      refreshControls();
    }
  }

  function refreshControls() {
    const current = statusText();
    const running = isRunningStatus(current);
    const generating = current === 'generating';
    const completed = current.startsWith('completed') || current === 'done' || current === 'analysis complete';
    const stopped = current === 'stopped' || current === 'cancelled';
    const errored = current === 'error';
    const ready = current === 'ready';
    const stop = document.getElementById('stopExecutionBtn');
    const reset = document.getElementById('resetExecutionBtn');
    const runBtn = document.getElementById('runBtn');

    if (completed || stopped || (errored && hasExecutionData())) hasCompletedExecution = true;

    if (stop) {
      stop.style.display = running ? 'inline-flex' : 'none';
      if (!running) { stop.disabled = false; stop.textContent = 'Stop Execution'; }
    }

    if (reset) {
      const showReset = running || hasCompletedExecution || hasExecutionData();
      reset.style.display = showReset ? 'inline-flex' : 'none';
      reset.disabled = generating || resetting;
    }

    if (runBtn) {
      runBtn.style.display = running ? 'none' : 'inline-flex';
      if (!running) {
        if (hasCompletedExecution) {
          setRunLabel(RETEST_LABEL, true);
          runBtn.disabled = !hasReviewedCases() || checkedIds().length === 0;
        } else if (ready || hasReviewedCases()) {
          setRunLabel(START_LABEL, true);
          // Readiness code may temporarily keep the button locked. Only explicitly unlock when all visible checked cases are already enabled.
          const checked = checkedIds();
          const readinessPending = Array.from(document.querySelectorAll('.case-check')).some((box) => box.disabled && box.checked);
          if (!readinessPending) runBtn.disabled = checked.length === 0;
        }
      }
    }

    if (cancellationRequested && current === 'error' && !resetting) finishStopped();
  }

  function bindLifecycle() {
    if (document.body.dataset.executionLifecycleBound === '1') return;
    document.body.dataset.executionLifecycleBound = '1';

    document.addEventListener('click', (event) => {
      const runBtn = event.target.closest('#runBtn');
      if (!runBtn) return;
      const approved = hasCompletedExecution && lastApprovedIds.length ? lastApprovedIds : checkedIds();
      if (approved.length) {
        lastApprovedIds = [...approved];
        if (hasCompletedExecution) applyApprovedIds(lastApprovedIds);
      }
      cancellationRequested = false;
      setTimeout(refreshControls, 0);
    }, true);

    const generateBtn = document.getElementById('generateBtn');
    if (generateBtn) {
      generateBtn.addEventListener('click', () => {
        cancellationRequested = false;
        hasCompletedExecution = false;
        lastApprovedIds = [];
        setRunLabel(START_LABEL, true);
        setTimeout(refreshControls, 0);
      }, true);
    }

    window.addEventListener('testnexus:execution-starting', (event) => {
      const approvedIds = event.detail?.approvedIds;
      if (Array.isArray(approvedIds) && approvedIds.length) lastApprovedIds = [...approvedIds];
      hasCompletedExecution = false;
      setTimeout(refreshControls, 0);
    });
    window.addEventListener('testnexus:execution-started', refreshControls);
    window.addEventListener('testnexus:execution-completed', (event) => {
      const approvedIds = event.detail?.approvedIds;
      if (Array.isArray(approvedIds) && approvedIds.length) lastApprovedIds = [...approvedIds];
      hasCompletedExecution = true;
      const runBtn = document.getElementById('runBtn');
      if (runBtn) runBtn.disabled = false;
      setRunLabel(RETEST_LABEL, true);
      setTimeout(refreshControls, 0);
    });
    window.addEventListener('testnexus:execution-failed', (event) => {
      if (event.detail?.executionStarted) hasCompletedExecution = true;
      setTimeout(refreshControls, 0);
    });

    const status = document.getElementById('runStatus');
    if (status) new MutationObserver(refreshControls).observe(status, { childList: true, characterData: true, subtree: true, attributes: true });
    const results = document.getElementById('results');
    if (results) new MutationObserver(refreshControls).observe(results, { childList: true, subtree: true });
  }

  function start() {
    ensureControls();
    bindLifecycle();
    setRunLabel(START_LABEL, true);
    let attempts = 0;
    const timer = setInterval(() => {
      ensureControls();
      refreshControls();
      if (++attempts > 120) clearInterval(timer);
    }, 250);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();

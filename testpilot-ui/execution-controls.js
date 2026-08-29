(function () {
  if (window.__testNexusExecutionControls) return;
  window.__testNexusExecutionControls = true;

  let cancellationRequested = false;
  let resetting = false;

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

  function ensureStyles() {
    if (document.getElementById('executionControlStyles')) return;
    const style = document.createElement('style');
    style.id = 'executionControlStyles';
    style.textContent = `
      .execution-control-actions{display:flex;align-items:center;gap:7px;margin-left:auto}
      #cancelExecutionBtn{display:none;border-color:#fecaca;color:#b91c1c;background:#fff7f7}
      #cancelExecutionBtn:hover{background:#fee2e2}
      #resetExecutionBtn{white-space:nowrap}
      #resetExecutionBtn:disabled,#cancelExecutionBtn:disabled{opacity:.5;cursor:not-allowed}
    `;
    document.head.appendChild(style);
  }

  function setRunLabel(text) {
    const button = document.getElementById('runBtn');
    if (!button) return;
    button.dataset.oldText = text;
    if (!button.disabled) button.textContent = text;
  }

  function hasReviewedCases() {
    try { return Array.isArray(testCases) && testCases.length > 0; } catch { return false; }
  }

  function hasExecutionData() {
    const statusText = String(document.getElementById('runStatus')?.textContent || '').trim().toLowerCase();
    if (!['', 'idle', 'ready', 'review required'].includes(statusText)) return true;
    if (document.querySelector('#results .result')) return true;
    return Number(document.getElementById('mTotal')?.textContent || 0) > 0;
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
    if (runbar && !document.getElementById('cancelExecutionBtn')) {
      const cancel = document.createElement('button');
      cancel.id = 'cancelExecutionBtn';
      cancel.type = 'button';
      cancel.className = 'btn ghost';
      cancel.textContent = 'Cancel Run';
      runbar.insertBefore(cancel, runBtn);
      cancel.addEventListener('click', cancelRun);
    }

    const status = document.getElementById('runStatus');
    const head = status?.closest('.section-head');
    if (head && !document.getElementById('resetExecutionBtn')) {
      const actions = document.createElement('div');
      actions.className = 'execution-control-actions';
      const reset = document.createElement('button');
      reset.id = 'resetExecutionBtn';
      reset.type = 'button';
      reset.className = 'btn ghost';
      reset.textContent = 'Reset Execution & Analytics';
      actions.appendChild(reset);
      head.insertBefore(actions, status);
      reset.addEventListener('click', resetExecution);
    }

    refreshControls();
  }

  async function requestCancellation(session) {
    const response = await fetch(`/api/test-runs/cancel/${encodeURIComponent(session)}`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: '{}',
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.reply || 'Could not cancel the automation run.');
    return data;
  }

  async function cancelRun() {
    const session = sid();
    if (!session || cancellationRequested) return;
    const button = document.getElementById('cancelExecutionBtn');
    cancellationRequested = true;
    if (button) { button.disabled = true; button.textContent = 'Cancelling…'; }
    try {
      try { if (typeof setActivityStatus === 'function') setActivityStatus('Cancelling', true); } catch {}
      let data = null;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        data = await requestCancellation(session);
        if (data.cancelled) break;
        if (String(data.state || '').toUpperCase() !== 'RUNNING') break;
        await delay(250);
      }
      if (!data?.cancelled && String(data?.state || '').toUpperCase() === 'RUNNING') {
        throw new Error('The run is still preparing. Try Cancel Run again in a moment.');
      }
      if (!data?.cancelled) finishCancellation();
    } catch (err) {
      cancellationRequested = false;
      try { if (typeof showError === 'function') showError(err.message); } catch {}
      const cancel = document.getElementById('cancelExecutionBtn');
      if (cancel) { cancel.disabled = false; cancel.textContent = 'Cancel Run'; }
      refreshControls();
    }
  }

  function finishCancellation() {
    cancellationRequested = false;
    const cancel = document.getElementById('cancelExecutionBtn');
    if (cancel) { cancel.disabled = false; cancel.textContent = 'Cancel Run'; cancel.style.display = 'none'; }
    try { if (typeof clearError === 'function') clearError(); } catch {}
    try { if (typeof setActivityStatus === 'function') setActivityStatus('Cancelled', false); } catch {}
    const results = document.getElementById('results');
    if (results) results.innerHTML = '<div class="empty">Run cancelled. Reviewed test cases remain available for re-run.</div>';
    const runBtn = document.getElementById('runBtn');
    if (runBtn && hasReviewedCases()) runBtn.disabled = false;
    setRunLabel('Re-run Approved Tests');
    refreshControls();
  }

  async function resetExecution() {
    if (resetting) return;
    const session = sid();
    if (!session) return;
    if (!window.confirm('Reset the current Execution & Analytics view? Reviewed test cases and run history will be preserved.')) return;

    const button = document.getElementById('resetExecutionBtn');
    resetting = true;
    if (button) { button.disabled = true; button.textContent = 'Resetting…'; }
    try {
      const response = await fetch(`/api/test-runs/reset/${encodeURIComponent(session)}`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: '{}',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.reply || 'Could not reset Execution & Analytics.');
      clearExecutionUi();
      try { if (typeof setActivityStatus === 'function') setActivityStatus(hasReviewedCases() ? 'Ready' : 'Idle', false); } catch {}
      const runBtn = document.getElementById('runBtn');
      if (runBtn) runBtn.disabled = !hasReviewedCases();
      setRunLabel('Run Approved Tests');
    } catch (err) {
      try { if (typeof showError === 'function') showError(err.message); } catch {}
    } finally {
      resetting = false;
      if (button) { button.disabled = false; button.textContent = 'Reset Execution & Analytics'; }
      refreshControls();
    }
  }

  function refreshControls() {
    const statusText = String(document.getElementById('runStatus')?.textContent || '').trim().toLowerCase();
    const running = statusText === 'running' || statusText === 'cancelling';
    const generating = statusText === 'generating';
    const completed = statusText === 'completed' || statusText === 'analysis complete';
    const cancelled = statusText === 'cancelled';
    const cancel = document.getElementById('cancelExecutionBtn');
    const reset = document.getElementById('resetExecutionBtn');

    if (cancel) {
      cancel.style.display = running ? 'inline-flex' : 'none';
      if (!running) { cancel.disabled = false; cancel.textContent = 'Cancel Run'; }
    }
    if (reset) reset.disabled = running || generating || resetting || !hasExecutionData();

    if (completed || cancelled) setRunLabel('Re-run Approved Tests');

    if (cancellationRequested && statusText === 'error') finishCancellation();
  }

  function bindLifecycle() {
    const runBtn = document.getElementById('runBtn');
    if (runBtn && runBtn.dataset.executionControlsBound !== '1') {
      runBtn.dataset.executionControlsBound = '1';
      runBtn.addEventListener('click', () => {
        cancellationRequested = false;
        const cancel = document.getElementById('cancelExecutionBtn');
        if (cancel) { cancel.disabled = false; cancel.textContent = 'Cancel Run'; cancel.style.display = 'inline-flex'; }
        const reset = document.getElementById('resetExecutionBtn');
        if (reset) reset.disabled = true;
      }, true);
    }

    const generateBtn = document.getElementById('generateBtn');
    if (generateBtn && generateBtn.dataset.executionControlsBound !== '1') {
      generateBtn.dataset.executionControlsBound = '1';
      generateBtn.addEventListener('click', () => {
        cancellationRequested = false;
        setRunLabel('Run Approved Tests');
      }, true);
    }

    const status = document.getElementById('runStatus');
    if (status) new MutationObserver(refreshControls).observe(status, { childList: true, characterData: true, subtree: true, attributes: true });

    const results = document.getElementById('results');
    if (results) new MutationObserver(refreshControls).observe(results, { childList: true, subtree: true });

    const errorBox = document.getElementById('errorBox');
    if (errorBox) {
      new MutationObserver(() => {
        if (!cancellationRequested) return;
        if (/cancel/i.test(String(errorBox.textContent || ''))) finishCancellation();
      }).observe(errorBox, { childList: true, characterData: true, subtree: true, attributes: true });
    }
  }

  function start() {
    ensureControls();
    bindLifecycle();
    let attempts = 0;
    const timer = setInterval(() => {
      ensureControls();
      refreshControls();
      if (++attempts > 40) clearInterval(timer);
    }, 250);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();

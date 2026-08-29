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
      const health = await fetch('/health').then((r) => r.json());
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
  if (window.__aiTestPilotIncrementalExecution) return;
  window.__aiTestPilotIncrementalExecution = true;

  const esc = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

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

    const status = document.getElementById('runStatus');
    if (status) {
      status.textContent = progress.complete ? 'Finalizing' : `Running ${completed}/${total}`;
      status.classList.add('activity-pill');
    }

    const results = document.getElementById('results');
    if (!results) return;
    const rows = Array.isArray(progress.tests) ? progress.tests.map((test) => {
      const duration = test.durationMs == null ? '' : `<div class="expected">Duration: ${esc(test.durationMs)} ms</div>`;
      const error = test.err?.message ? `<div class="expected">${esc(test.err.message).slice(0, 260)}</div>` : '';
      return `<div class="result"><div class="result-title">${esc(test.title)}${duration}${error}</div><span class="badge ${test.pass ? 'pass' : 'fail'}">${test.pass ? 'PASS' : 'FAIL'}</span></div>`;
    }).join('') : '';
    const remaining = Math.max(0, total - completed);
    const waiting = remaining > 0
      ? `<div class="empty" style="padding:18px 12px">${remaining} test${remaining === 1 ? '' : 's'} remaining · same controlled browser session continues…</div>`
      : '';
    results.innerHTML = rows + waiting;
  }

  async function pollProgress(activeRef) {
    let lastCompleted = -1;
    while (activeRef.active) {
      try {
        const response = await fetch(`/api/test-runs/progress/${encodeURIComponent(sessionId)}`, { cache: 'no-store' });
        const data = await response.json();
        const progress = data?.progress;
        if (response.ok && progress && Number(progress.completed || 0) !== lastCompleted) {
          lastCompleted = Number(progress.completed || 0);
          renderLiveProgress(progress);
        }
        if (progress?.complete && data.state !== 'RUNNING') break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  function install() {
    const oldButton = document.getElementById('runBtn');
    if (!oldButton || oldButton.dataset.incrementalExecution === '1') return;

    const runButton = oldButton.cloneNode(true);
    runButton.dataset.incrementalExecution = '1';
    oldButton.replaceWith(runButton);

    runButton.addEventListener('click', async () => {
      clearError();
      const approved = [...document.querySelectorAll('.case-check:checked')].map((el) => el.value);
      if (!approved.length) {
        showError('Select at least one test case.');
        return;
      }

      setBusy(runButton, true, 'Running tests…');
      setActivityStatus('Starting browser', true);
      const results = document.getElementById('results');
      if (results) results.innerHTML = `<div class="activity-alert">Starting controlled browser execution…<small>${approved.length} approved test${approved.length === 1 ? '' : 's'} will report results one-by-one while Chrome remains open for the run.</small></div>`;
      const analysis = document.getElementById('analysis');
      if (analysis) analysis.innerHTML = '';
      const reportBox = document.getElementById('reportBox');
      if (reportBox) reportBox.style.display = 'none';

      const activeRef = { active: true };
      const pollPromise = pollProgress(activeRef);

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            message: 'approve reviewed cases',
            approvedIds: approved,
            reviewedTestCases: testCases,
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.reply || 'Execution failed.');

        activeRef.active = false;
        await pollPromise;
        if (typeof window.renderResults === 'function') window.renderResults(data.summary, data.failureAnalyses || []);
        else if (typeof renderResults === 'function') renderResults(data.summary, data.failureAnalyses || []);

        if (data.reportUrl) {
          const link = document.getElementById('reportLink');
          const box = document.getElementById('reportBox');
          if (link) link.href = data.reportUrl;
          if (box) box.style.display = 'block';
        }
        setActivityStatus('Completed', false);
      } catch (err) {
        activeRef.active = false;
        await pollPromise;
        showError(err.message || 'Execution failed.');
        setActivityStatus('Error', false);
      } finally {
        setBusy(runButton, false, '');
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();
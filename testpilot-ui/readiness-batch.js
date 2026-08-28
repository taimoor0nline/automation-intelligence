(function () {
  if (window.__aiTestPilotReadinessBatching) return;
  window.__aiTestPilotReadinessBatching = true;

  const BATCH_SIZE = 10;
  const BATCH_TIMEOUT_MS = 12000;
  const previousFetch = window.fetch.bind(window);
  let batchActive = false;
  let progress = { completed: 0, total: 0, batch: 0, batches: 0 };

  function pathOf(input) {
    try {
      const raw = typeof input === 'string' ? input : String(input?.url || '');
      return new URL(raw, window.location.origin).pathname;
    } catch {
      return String(input || '').split('?')[0];
    }
  }

  function setProgress(completed, total, batch, batches) {
    progress = { completed, total, batch, batches };
    const hint = document.getElementById('runHint');
    if (hint) {
      hint.textContent = total
        ? `Checking automation readiness ${Math.min(completed, total)}/${total} · batch ${Math.min(batch + 1, batches)}/${batches} · review controls locked`
        : 'Checking automation readiness · review controls locked';
    }
    const subtitle = document.getElementById('caseSubtitle');
    if (subtitle && total) subtitle.textContent = `All test cases are visible · validating readiness in batches of ${BATCH_SIZE} · ${Math.min(completed, total)}/${total} checked`;
  }

  function lockReviewControls() {
    if (!batchActive) return;
    document.querySelectorAll('#cases .case-check, #cases .case-actions button, #cases .readiness-actions button').forEach((el) => {
      el.disabled = true;
      el.setAttribute('aria-disabled', 'true');
    });
    const runBtn = document.getElementById('runBtn');
    if (runBtn) runBtn.disabled = true;
    const addBtn = document.getElementById('addCaseBtn');
    if (addBtn) addBtn.disabled = true;
  }

  const casesRoot = document.getElementById('cases');
  const observer = casesRoot ? new MutationObserver(() => lockReviewControls()) : null;
  if (casesRoot && observer) observer.observe(casesRoot, { childList: true, subtree: true });

  function mergeBatchIntoVisibleCases(assessedCases) {
    if (!Array.isArray(assessedCases) || !assessedCases.length || !Array.isArray(testCases)) return;
    const byId = new Map(assessedCases.map((tc) => [String(tc?.id || '').toUpperCase(), tc]));
    testCases = testCases.map((current) => {
      const assessed = byId.get(String(current?.id || '').toUpperCase());
      return assessed ? { ...current, ...assessed, automationReadiness: assessed.automationReadiness } : current;
    });
    renderCases();
    lockReviewControls();
  }

  function markRemainingForRetry(candidates, reason) {
    const ids = new Set(candidates.map((tc) => String(tc?.id || '').toUpperCase()));
    testCases = testCases.map((tc) => {
      if (!ids.has(String(tc?.id || '').toUpperCase()) || tc.automationReadiness) return tc;
      return {
        ...tc,
        automationReadiness: {
          status: 'READINESS_ERROR',
          reasonCode: 'READINESS_BATCH_RETRY_REQUIRED',
          reason: reason || 'This readiness batch did not return in time. Retry readiness validation; the test has not been executed.',
          resolutionType: 'SYSTEM_RETRY_REQUIRED',
          canSuggestAssertion: false,
        },
      };
    });
  }

  function ensureRetryButton() {
    let btn = document.getElementById('retryReadinessBtn');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'retryReadinessBtn';
      btn.type = 'button';
      btn.className = 'btn ghost';
      btn.style.marginLeft = '8px';
      btn.textContent = 'Retry readiness';
      btn.addEventListener('click', () => {
        btn.remove();
        testCases = testCases.map((tc) => tc?.automationReadiness?.reasonCode === 'READINESS_BATCH_RETRY_REQUIRED' ? { ...tc, automationReadiness: null } : tc);
        renderCases();
        window.refreshTestReadiness?.();
      });
    }
    const hint = document.getElementById('runHint');
    if (hint?.parentElement && !btn.isConnected) hint.insertAdjacentElement('afterend', btn);
  }

  async function fetchBatch(url, init, payload, batchCases, batchIndex, batchCount) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), BATCH_TIMEOUT_MS);
    try {
      const body = JSON.stringify({
        ...payload,
        testCases: batchCases,
        batchIndex,
        batchCount,
      });
      return await previousFetch(url, { ...init, body, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  window.fetch = async function batchedReadinessFetch(input, init = {}) {
    if (pathOf(input) !== '/api/test-cases/revalidate' || init?.method !== 'POST' || typeof init.body !== 'string') {
      return previousFetch(input, init);
    }

    let payload;
    try { payload = JSON.parse(init.body); } catch { return previousFetch(input, init); }
    if (!Array.isArray(payload.testCases) || !payload.testCases.length || payload.__skipReadinessBatching) return previousFetch(input, init);

    const hasPending = payload.testCases.some((tc) => !tc?.automationReadiness);
    const candidates = hasPending ? payload.testCases.filter((tc) => !tc?.automationReadiness) : payload.testCases;
    const batches = [];
    for (let i = 0; i < candidates.length; i += BATCH_SIZE) batches.push(candidates.slice(i, i + BATCH_SIZE));
    if (!batches.length) return previousFetch(input, init);

    batchActive = true;
    document.body.classList.add('readiness-batch-active');
    const retry = document.getElementById('retryReadinessBtn');
    retry?.remove();
    setProgress(0, candidates.length, 0, batches.length);
    lockReviewControls();

    let completed = 0;
    let lastAutomationReadiness = null;
    try {
      for (let index = 0; index < batches.length; index += 1) {
        const batch = batches[index];
        setProgress(completed, candidates.length, index, batches.length);
        const response = await fetchBatch(input, init, payload, batch, index, batches.length);
        const data = await response.json();
        if (!response.ok || !Array.isArray(data?.testCases)) throw new Error(data?.reply || `Readiness batch ${index + 1}/${batches.length} failed.`);
        mergeBatchIntoVisibleCases(data.testCases);
        completed += data.testCases.length;
        lastAutomationReadiness = data.automationReadiness || lastAutomationReadiness;
        setProgress(completed, candidates.length, index, batches.length);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      batchActive = false;
      document.body.classList.remove('readiness-batch-active');
      const ready = testCases.filter((tc) => tc?.automationReadiness?.status === 'READY').length;
      const blocked = testCases.length - ready;
      const hint = document.getElementById('runHint');
      if (hint) hint.textContent = `${ready} Automation Ready · ${blocked} action/manual`;
      const subtitle = document.getElementById('caseSubtitle');
      if (subtitle) subtitle.textContent = `Automation readiness completed in ${batches.length} batch${batches.length === 1 ? '' : 'es'} · ${testCases.length} case(s) reviewed`;

      return new Response(JSON.stringify({
        ok: true,
        testCases,
        automationReadiness: lastAutomationReadiness,
        readinessPending: false,
        batching: { batchSize: BATCH_SIZE, batches: batches.length, validated: completed },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch (err) {
      const message = err?.name === 'AbortError'
        ? `Readiness batch timed out after ${Math.round(BATCH_TIMEOUT_MS / 1000)} seconds. ${completed}/${candidates.length} case(s) were validated; remaining cases were not executed.`
        : `${err.message || 'Readiness validation failed.'} ${completed}/${candidates.length} case(s) were validated.`;
      markRemainingForRetry(candidates, message);
      batchActive = false;
      document.body.classList.remove('readiness-batch-active');
      renderCases();
      const hint = document.getElementById('runHint');
      if (hint) hint.textContent = `Readiness paused · ${completed}/${candidates.length} validated`;
      ensureRetryButton();
      console.warn('[readiness-batch]', message);
      return new Response(JSON.stringify({ ok: false, reply: message, readinessPending: true, testCases }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  };
})();

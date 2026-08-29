(function () {
  if (window.__aiTestPilotExecutionReportActions) return;
  window.__aiTestPilotExecutionReportActions = true;

  let lastSummary = null;
  let lastReportUrl = '';
  let generatingReport = false;

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

  function statusText() {
    return String(document.getElementById('runStatus')?.textContent || '').trim().toLowerCase();
  }

  function ensureStyles() {
    if (document.getElementById('executionReportActionStyles')) return;
    const style = document.createElement('style');
    style.id = 'executionReportActionStyles';
    style.textContent = `
      #executionReportActions{display:none;margin-top:12px}
      #generateAiAnalysisReportBtn{width:100%;min-height:42px;background:linear-gradient(135deg,#2f5bff,#4f7cff);color:#fff;border:0;box-shadow:0 7px 18px rgba(47,91,255,.18)}
      #generateAiAnalysisReportBtn:hover{filter:brightness(.98);box-shadow:0 9px 22px rgba(47,91,255,.24)}
      #generateAiAnalysisReportBtn small{display:block;font-size:9.5px;font-weight:600;opacity:.82;margin-top:2px}
    `;
    document.head.appendChild(style);
  }

  function removeLegacyActions() {
    const reportBox = document.getElementById('reportBox');
    if (reportBox) reportBox.style.display = 'none';
    const legacyAnalysis = document.getElementById('analyzeResultsBox');
    if (legacyAnalysis) legacyAnalysis.remove();
    const legacyExcel = document.getElementById('exportExecutionExcelBtn');
    if (legacyExcel) legacyExcel.remove();
    const analysis = document.getElementById('analysis');
    if (analysis && !analysis.dataset.reportOnlyAnalysis) {
      analysis.dataset.reportOnlyAnalysis = '1';
      analysis.innerHTML = '';
      analysis.style.display = 'none';
    }
    document.getElementById('analysisStreamShell')?.remove();
  }

  function ensure() {
    ensureStyles();
    let box = document.getElementById('executionReportActions');
    if (box) return box;

    const analysis = document.getElementById('analysis');
    const results = document.getElementById('results');
    if (!analysis && !results) return null;

    box = document.createElement('div');
    box.id = 'executionReportActions';
    box.innerHTML = '<button id="generateAiAnalysisReportBtn" class="btn secondary" type="button">Generate AI Analysis Report<small>Creates the report now; failed cases analyze live inside it</small></button>';
    (analysis || results).insertAdjacentElement('afterend', box);

    document.getElementById('generateAiAnalysisReportBtn')?.addEventListener('click', generateAndOpenReport);
    return box;
  }

  async function generateAndOpenReport() {
    const id = sid();
    if (!id || generatingReport) return;

    const button = document.getElementById('generateAiAnalysisReportBtn');
    const popup = window.open('', '_blank');
    if (popup) {
      try { popup.opener = null; } catch {}
      try {
        popup.document.write('<!doctype html><title>Generating report…</title><body style="font-family:Segoe UI,Arial,sans-serif;padding:40px;color:#334155">Generating AI analysis report…</body>');
      } catch {}
    }

    generatingReport = true;
    if (button) {
      button.disabled = true;
      button.innerHTML = 'Generating report…<small>Execution rows will open immediately; failed-case AI continues over SSE</small>';
    }

    try {
      const response = await fetch(`/api/reports/${encodeURIComponent(id)}/generate`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: '{}',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.reply || 'Could not generate the AI analysis report.');

      lastReportUrl = data.reportUrl || `/api/reports/${encodeURIComponent(id)}`;
      if (popup) popup.location.replace(lastReportUrl);
      else window.open(lastReportUrl, '_blank', 'noopener');
    } catch (err) {
      try { if (popup && !popup.closed) popup.close(); } catch {}
      if (typeof showError === 'function') showError(err.message || 'Could not generate the AI analysis report.');
    } finally {
      generatingReport = false;
      refresh();
    }
  }

  function capture(summary) {
    if (summary) lastSummary = summary;
    refresh();
  }

  function refresh() {
    removeLegacyActions();
    const box = ensure();
    if (!box) return;

    const current = statusText();
    const completed = current.startsWith('completed');
    const total = Number(lastSummary?.total || document.getElementById('mTotal')?.textContent || 0);
    box.style.display = completed && total > 0 ? 'block' : 'none';

    const button = document.getElementById('generateAiAnalysisReportBtn');
    if (button && !generatingReport) {
      const failed = Number(lastSummary?.failed || document.getElementById('mFailed')?.textContent || 0);
      button.disabled = false;
      button.innerHTML = `Generate AI Analysis Report<small>${failed > 0 ? `Report opens immediately · ${failed} failed case${failed === 1 ? '' : 's'} analyze live` : 'No failures — creates the execution report without AI calls'}</small>`;
    }
  }

  function wrapRenderResults() {
    const original = window.renderResults;
    if (typeof original !== 'function' || original.__reportActionWrapped) return;
    function wrapped(summary) {
      const out = original.apply(this, arguments);
      capture(summary);
      return out;
    }
    wrapped.__reportActionWrapped = true;
    window.renderResults = wrapped;
    try { renderResults = wrapped; } catch {}
  }

  function start() {
    ensure();
    wrapRenderResults();
    removeLegacyActions();

    window.addEventListener('testnexus:execution-starting', () => {
      lastSummary = null;
      lastReportUrl = '';
      refresh();
    });
    window.addEventListener('testnexus:execution-completed', (event) => capture(event.detail?.summary));
    window.addEventListener('testnexus:execution-failed', refresh);

    const status = document.getElementById('runStatus');
    if (status) new MutationObserver(refresh).observe(status, { childList: true, characterData: true, subtree: true, attributes: true });
    const results = document.getElementById('results');
    if (results) new MutationObserver(refresh).observe(results, { childList: true, subtree: true });

    let attempts = 0;
    const timer = setInterval(() => {
      wrapRenderResults();
      refresh();
      if (++attempts > 80) clearInterval(timer);
    }, 250);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
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
      #generateAiAnalysisReportBtn:disabled{opacity:.62;cursor:wait}
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
    box.innerHTML = '<button id="generateAiAnalysisReportBtn" class="btn secondary" type="button">Generate AI Analysis Report</button>';
    (analysis || results).insertAdjacentElement('afterend', box);

    document.getElementById('generateAiAnalysisReportBtn')?.addEventListener('click', generateAndOpenReport);
    return box;
  }

  function writePopup(popup, title, message, isError) {
    if (!popup || popup.closed) return;
    try {
      popup.document.open();
      popup.document.write(`<!doctype html><html><head><title>${title}</title></head><body style="font-family:Segoe UI,Arial,sans-serif;padding:40px;background:#f8fafc;color:#334155"><div style="max-width:760px;margin:auto;background:white;border:1px solid #e2e8f0;border-radius:14px;padding:24px"><h2 style="margin-top:0;color:${isError ? '#b91c1c' : '#1d4ed8'}">${title}</h2><p style="line-height:1.55">${String(message || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p></div></body></html>`);
      popup.document.close();
    } catch {}
  }

  async function readJsonResponse(response) {
    const text = await response.text();
    if (!text) return {};
    try { return JSON.parse(text); }
    catch { return { reply: text.slice(0, 1000) }; }
  }

  async function verifyReport(url) {
    const response = await fetch(url, { method: 'GET', headers: authHeaders(), cache: 'no-store' });
    if (!response.ok) throw new Error(`The report was generated but could not be opened (${response.status}).`);
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('text/html')) throw new Error('The generated report URL did not return HTML.');
    return true;
  }

  async function generateAndOpenReport() {
    const id = sid();
    if (!id || generatingReport) {
      if (!id && typeof showError === 'function') showError('The current execution session could not be identified. Re-run the test or refresh the page and try again.');
      return;
    }

    const button = document.getElementById('generateAiAnalysisReportBtn');
    const popup = window.open('', '_blank');
    if (popup) {
      try { popup.opener = null; } catch {}
      writePopup(popup, 'Generating AI analysis report…', 'The execution results are being prepared. Failed-case AI analysis will continue live after the report opens.', false);
    }

    generatingReport = true;
    if (button) {
      button.disabled = true;
      button.textContent = 'Generate AI Analysis Report';
    }

    try {
      const response = await fetch(`/api/reports/${encodeURIComponent(id)}/generate`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: '{}',
        cache: 'no-store',
      });
      const data = await readJsonResponse(response);
      if (!response.ok || data.ok === false) throw new Error(data.reply || `Could not generate the AI analysis report (${response.status}).`);

      lastReportUrl = data.reportUrl || `/api/reports/${encodeURIComponent(id)}`;
      await verifyReport(lastReportUrl);

      if (popup && !popup.closed) popup.location.replace(lastReportUrl);
      else window.location.assign(lastReportUrl);
    } catch (err) {
      const message = err.message || 'Could not generate the AI analysis report.';
      writePopup(popup, 'AI analysis report could not be generated', message, true);
      if (typeof showError === 'function') showError(message);
      else console.error('[report-generation]', err);
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
    const total = Number(lastSummary?.total || document.getElementById('mTotal')?.textContent || 0);
    const summaryComplete = Boolean(lastSummary && total > 0);
    const statusComplete = current.startsWith('completed') || current === 'done' || current === 'analysis complete';
    const stillRunning = current.startsWith('starting') || current.startsWith('running') || current === 'finalizing' || current === 'stopping' || current === 'cancelling';
    const completed = !stillRunning && (summaryComplete || statusComplete);
    box.style.display = completed && total > 0 ? 'block' : 'none';

    const button = document.getElementById('generateAiAnalysisReportBtn');
    if (button && !generatingReport) {
      button.disabled = !completed;
      button.textContent = 'Generate AI Analysis Report';
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

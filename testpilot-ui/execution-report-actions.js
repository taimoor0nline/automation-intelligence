(function () {
  if (window.__aiTestPilotExecutionReportActions) return;
  window.__aiTestPilotExecutionReportActions = true;

  let lastSummary = null;
  let lastReportUrl = '';

  function sid() {
    try {
      if (window.sessionId) return window.sessionId;
      if (typeof sessionId !== 'undefined') return sessionId;
    } catch {}
    return '';
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
    box.innerHTML = '<button id="generateAiAnalysisReportBtn" class="btn secondary" type="button">Generate AI Analysis Report<small>Opens the report and analyzes failed cases only</small></button>';
    (analysis || results).insertAdjacentElement('afterend', box);

    document.getElementById('generateAiAnalysisReportBtn')?.addEventListener('click', openReport);
    return box;
  }

  function reportUrl() {
    const id = sid();
    if (!id) return '';
    const link = document.getElementById('reportLink');
    const href = link?.getAttribute('href') || '';
    if (lastReportUrl) return lastReportUrl;
    if (href && href !== '#') return href;
    return `/api/reports/${encodeURIComponent(id)}`;
  }

  function openReport() {
    const url = reportUrl();
    if (!url) return;
    window.open(url, '_blank', 'noopener');
  }

  function capture(summary, reportUrlValue) {
    if (summary) lastSummary = summary;
    if (reportUrlValue) lastReportUrl = reportUrlValue;
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
    if (button) {
      const failed = Number(lastSummary?.failed || document.getElementById('mFailed')?.textContent || 0);
      button.innerHTML = `Generate AI Analysis Report<small>${failed > 0 ? `${failed} failed case${failed === 1 ? '' : 's'} will be analyzed live` : 'No failures — opens the execution report without AI calls'}</small>`;
    }
  }

  function wrapRenderResults() {
    const original = window.renderResults;
    if (typeof original !== 'function' || original.__reportActionWrapped) return;
    function wrapped(summary) {
      const out = original.apply(this, arguments);
      capture(summary, null);
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
    window.addEventListener('testnexus:execution-completed', (event) => {
      const detail = event.detail || {};
      capture(detail.summary, detail.reportUrl);
    });
    window.addEventListener('testnexus:execution-failed', refresh);

    const status = document.getElementById('runStatus');
    if (status) new MutationObserver(refresh).observe(status, { childList: true, characterData: true, subtree: true, attributes: true });
    const results = document.getElementById('results');
    if (results) new MutationObserver(refresh).observe(results, { childList: true, subtree: true });
    const reportLink = document.getElementById('reportLink');
    if (reportLink) new MutationObserver(() => {
      const href = reportLink.getAttribute('href');
      if (href && href !== '#') lastReportUrl = href;
      refresh();
    }).observe(reportLink, { attributes: true, attributeFilter: ['href'] });

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

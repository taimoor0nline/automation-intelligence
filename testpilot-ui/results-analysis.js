(function () {
  if (window.__testNexusReportOnlyFailureAnalysis) return;
  window.__testNexusReportOnlyFailureAnalysis = true;

  function cleanupMainPageAnalysis() {
    document.getElementById('analyzeResultsBox')?.remove();
    document.getElementById('analysisStreamShell')?.remove();
    const analysis = document.getElementById('analysis');
    if (analysis) {
      analysis.innerHTML = '';
      analysis.style.display = 'none';
      analysis.dataset.reportOnlyAnalysis = '1';
    }
    const reportBox = document.getElementById('reportBox');
    if (reportBox) reportBox.style.display = 'none';
  }

  function start() {
    cleanupMainPageAnalysis();
    const results = document.getElementById('results');
    const analysis = document.getElementById('analysis');
    const observer = new MutationObserver(cleanupMainPageAnalysis);
    if (results) observer.observe(results, { childList: true, subtree: true });
    if (analysis) observer.observe(analysis, { childList: true, subtree: true });

    window.addEventListener('testnexus:execution-starting', cleanupMainPageAnalysis);
    window.addEventListener('testnexus:execution-completed', cleanupMainPageAnalysis);

    let attempts = 0;
    const timer = setInterval(() => {
      cleanupMainPageAnalysis();
      if (++attempts > 80) clearInterval(timer);
    }, 250);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();

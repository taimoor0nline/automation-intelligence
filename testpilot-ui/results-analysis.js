(function () {
  let lastExecutionSummary = null;
  let analysisInFlight = false;

  function ensureAnalysisControls() {
    const analysis = document.getElementById('analysis');
    if (!analysis || document.getElementById('analyzeResultsBox')) return;

    const box = document.createElement('div');
    box.id = 'analyzeResultsBox';
    box.style.display = 'none';
    box.style.marginTop = '12px';
    box.innerHTML =
      '<button id="analyzeResultsBtn" class="btn secondary" type="button" style="width:100%">Analyze Test Results with AI</button>' +
      '<div id="analyzeResultsHint" class="sub" style="margin-top:7px;text-align:center">Browser execution is complete. AI analysis runs only when you request it.</div>';
    analysis.insertAdjacentElement('beforebegin', box);

    document.getElementById('analyzeResultsBtn').addEventListener('click', analyzeResults);
  }

  async function analyzeResults() {
    if (!sessionId || !lastExecutionSummary || analysisInFlight) return;
    const btn = document.getElementById('analyzeResultsBtn');
    const hint = document.getElementById('analyzeResultsHint');
    analysisInFlight = true;
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Analyzing failed results with AI…';
    }
    if (hint) hint.textContent = 'Sending completed failure evidence to the selected AI profile. No browser execution is occurring now.';
    setActivityStatus('Analyzing results', true);

    try {
      const response = await fetch('/api/test-results/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.reply || 'AI result analysis failed.');

      const summary = data.summary || lastExecutionSummary;
      const analyses = data.failureAnalyses || [];
      if (typeof window.renderResults === 'function') window.renderResults(summary, analyses);
      if (data.reportUrl) {
        document.getElementById('reportLink').href = data.reportUrl;
        document.getElementById('reportBox').style.display = 'block';
      }
      if (hint) hint.textContent = analyses.length ? 'AI analysis completed for the failed test cases.' : 'There were no failed tests requiring AI analysis.';
      if (btn) btn.style.display = 'none';
      setActivityStatus('Analysis complete', false);
    } catch (err) {
      showError(err.message);
      if (hint) hint.textContent = 'AI analysis did not complete. Browser test results remain available above.';
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Retry AI Result Analysis';
      }
      setActivityStatus('Completed · analysis pending', false);
    } finally {
      analysisInFlight = false;
    }
  }

  ensureAnalysisControls();

  const sectionHeading = [...document.querySelectorAll('.section-head h2')].find((el) => el.textContent.includes('Execution'));
  const sectionSub = sectionHeading?.parentElement?.querySelector('.sub');
  if (sectionSub) {
    sectionSub.textContent = 'The automation system executes approved tests deterministically. AI failure analysis runs only after execution and only when you request it.';
  }

  const originalRenderResults = window.renderResults;
  if (typeof originalRenderResults === 'function') {
    window.renderResults = function (summary, analyses) {
      lastExecutionSummary = summary || lastExecutionSummary;
      originalRenderResults(summary, analyses || []);
      ensureAnalysisControls();

      const box = document.getElementById('analyzeResultsBox');
      const btn = document.getElementById('analyzeResultsBtn');
      const hint = document.getElementById('analyzeResultsHint');
      const failed = Number(summary?.failed || 0);
      const hasAnalyses = Array.isArray(analyses) && analyses.length > 0;

      if (box) box.style.display = failed > 0 ? 'block' : 'none';
      if (failed > 0 && !hasAnalyses && btn) {
        btn.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Analyze Test Results with AI';
        if (hint) hint.textContent = `${failed} failed test(s) are ready for optional AI analysis. Browser execution has already finished.`;
      } else if (hasAnalyses && btn) {
        btn.style.display = 'none';
        if (hint) hint.textContent = 'AI analysis completed for the failed test cases.';
      }
    };
    // Keep the classic-script global binding aligned with the wrapped function.
    try { renderResults = window.renderResults; } catch {}
  }
})();

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
      '<button id="analyzeResultsBtn" class="btn secondary" type="button" style="width:100%">Analyze Failed Tests with AI</button>' +
      '<div id="analyzeResultsHint" class="sub" style="margin-top:7px;text-align:center">Browser execution is complete. AI analysis runs only for failed tests and only when you request it.</div>';
    analysis.insertAdjacentElement('beforebegin', box);

    document.getElementById('analyzeResultsBtn').addEventListener('click', analyzeResults);
  }

  function markReadyForRerun(summary) {
    if (!summary) return;
    // Defer one tick because the base run handler restores its original button text
    // in finally after renderResults returns.
    setTimeout(() => {
      const runBtn = document.getElementById('runBtn');
      const runHint = document.getElementById('runHint');
      if (!runBtn) return;
      runBtn.textContent = 'Run Again';
      runBtn.disabled = false;
      if (runHint) {
        runHint.textContent = `${summary.passed || 0} passed · ${summary.failed || 0} failed · adjust selections or run the approved set again`;
      }
    }, 0);
  }

  async function analyzeResults() {
    if (!sessionId || !lastExecutionSummary || analysisInFlight) return;
    const btn = document.getElementById('analyzeResultsBtn');
    const hint = document.getElementById('analyzeResultsHint');
    analysisInFlight = true;
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Analyzing failed tests with AI…';
    }
    if (hint) hint.textContent = 'Sending only completed failed-test evidence to the selected AI profile. No browser execution is occurring now.';
    setActivityStatus('Analyzing failures', true);

    try {
      const response = await fetch('/api/test-results/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.reply || 'AI failure analysis failed.');

      const summary = data.summary || lastExecutionSummary;
      const analyses = data.failureAnalyses || [];
      if (typeof window.renderResults === 'function') window.renderResults(summary, analyses);
      if (data.reportUrl) {
        document.getElementById('reportLink').href = data.reportUrl;
        document.getElementById('reportBox').style.display = 'block';
      }
      if (hint) hint.textContent = analyses.length ? 'AI analysis completed for the failed tests.' : 'There were no failed tests requiring AI analysis.';
      if (btn) btn.style.display = 'none';
      setActivityStatus('Analysis complete', false);
      markReadyForRerun(summary);
    } catch (err) {
      showError(err.message);
      if (hint) hint.textContent = 'AI analysis did not complete. Browser test results remain available above and you can still run again.';
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Retry Failed-Test AI Analysis';
      }
      setActivityStatus('Completed · analysis pending', false);
      markReadyForRerun(lastExecutionSummary);
    } finally {
      analysisInFlight = false;
    }
  }

  ensureAnalysisControls();

  const sectionHeading = [...document.querySelectorAll('.section-head h2')].find((el) => el.textContent.includes('Execution'));
  const sectionSub = sectionHeading?.parentElement?.querySelector('.sub');
  if (sectionSub) {
    sectionSub.textContent = 'The automation system executes approved tests deterministically. Failed-test AI analysis is optional and runs only after execution completes.';
  }

  const originalRenderResults = window.renderResults;
  if (typeof originalRenderResults === 'function') {
    window.renderResults = function (summary, analyses) {
      lastExecutionSummary = summary || lastExecutionSummary;
      originalRenderResults(summary, analyses || []);
      ensureAnalysisControls();
      markReadyForRerun(summary);

      const box = document.getElementById('analyzeResultsBox');
      const btn = document.getElementById('analyzeResultsBtn');
      const hint = document.getElementById('analyzeResultsHint');
      const failed = Number(summary?.failed || 0);
      const hasAnalyses = Array.isArray(analyses) && analyses.length > 0;

      if (box) box.style.display = failed > 0 ? 'block' : 'none';
      if (failed > 0 && !hasAnalyses && btn) {
        btn.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Analyze Failed Tests with AI';
        if (hint) hint.textContent = `${failed} failed test(s) are available for optional AI analysis. Browser execution has already finished.`;
        setTimeout(() => {
          const reportBox = document.getElementById('reportBox');
          if (reportBox) reportBox.style.display = 'none';
        }, 0);
      } else if (hasAnalyses && btn) {
        btn.style.display = 'none';
        if (hint) hint.textContent = 'AI analysis completed for the failed tests.';
      }
    };
    try { renderResults = window.renderResults; } catch {}
  }
})();

(function () {
  let lastExecutionSummary = null;
  let analysisInFlight = false;

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function ownerLabel(value) {
    const labels = {
      APPLICATION_TEAM: 'Application team',
      TEST_AUTOMATION_TEAM: 'Test automation team',
      TEST_DATA_OWNER: 'Test data owner',
      ENVIRONMENT_TEAM: 'Environment / DevOps team',
      BUSINESS_ANALYST: 'Business analyst / product owner',
      MANUAL_REVIEW: 'Manual review'
    };
    return labels[value] || String(value || 'Manual review').replaceAll('_', ' ');
  }

  function ensureResolutionStyles() {
    if (document.getElementById('aiResolutionStyles')) return;
    const style = document.createElement('style');
    style.id = 'aiResolutionStyles';
    style.textContent = `
      .ai-resolution-card{border:1px solid #fde2e2;background:#fffafa;border-radius:10px;padding:12px;margin-top:9px}
      .ai-resolution-top{display:flex;gap:7px;align-items:center;flex-wrap:wrap;font-size:10.5px;font-weight:800;color:#b91c1c}
      .ai-resolution-meta{font-size:10px;padding:3px 6px;border-radius:999px;background:#f3f4f6;color:#475569}
      .ai-resolution-summary{font-size:11.5px;color:#6b7385;line-height:1.45;margin-top:7px}
      .ai-resolution-box{margin-top:10px;padding:10px 11px;border:1px solid #bfdbfe;border-radius:9px;background:#f8fbff}
      .ai-resolution-head{font-size:10.5px;font-weight:900;color:#1d4ed8;text-transform:uppercase;letter-spacing:.03em}
      .ai-resolution-review{display:inline-block;margin-left:6px;padding:2px 5px;border-radius:5px;background:#fef3c7;color:#92400e;font-size:8.8px}
      .ai-resolution-text{font-size:11.5px;color:#334155;line-height:1.45;margin-top:7px}
      .ai-resolution-detail{font-size:11px;color:#475569;line-height:1.45;margin-top:6px}
      .ai-resolution-detail b{color:#1f2937}
      .ai-resolution-steps{margin:5px 0 0 18px;padding:0}.ai-resolution-steps li{margin:3px 0}
      .ai-resolution-warning{margin-top:8px;padding-top:7px;border-top:1px solid #dbeafe;font-size:10px;color:#64748b;line-height:1.4}
    `;
    document.head.appendChild(style);
  }

  function renderRichAnalyses(analyses) {
    const target = document.getElementById('analysis');
    if (!target || !Array.isArray(analyses) || !analyses.length) return;
    ensureResolutionStyles();
    target.innerHTML = '<div class="sub"><b>AI failure analysis & resolution guidance</b><br>Recommendations are advisory. Human review and a successful re-run are required before a failure is considered resolved.</div>' + analyses.map((a) => {
      const confidence = Math.round((Number(a.confidence) || 0) * 100);
      const steps = Array.isArray(a.verificationSteps) && a.verificationSteps.length
        ? '<ol class="ai-resolution-steps">' + a.verificationSteps.map((step) => '<li>' + esc(step) + '</li>').join('') + '</ol>'
        : '';
      const resolution = a.resolutionComment || a.recommendedFix || steps
        ? '<div class="ai-resolution-box">' +
            '<div class="ai-resolution-head">AI resolution guidance <span class="ai-resolution-review">Human review required</span></div>' +
            (a.resolutionComment ? '<div class="ai-resolution-text">' + esc(a.resolutionComment) + '</div>' : '') +
            (a.recommendedFix ? '<div class="ai-resolution-detail"><b>Recommended fix:</b> ' + esc(a.recommendedFix) + '</div>' : '') +
            (a.recommendedOwner ? '<div class="ai-resolution-detail"><b>Suggested owner:</b> ' + esc(ownerLabel(a.recommendedOwner)) + '</div>' : '') +
            (steps ? '<div class="ai-resolution-detail"><b>Verify after correction:</b>' + steps + '</div>' : '') +
            '<div class="ai-resolution-warning">The AI has not changed the application or test. Do not close the defect or weaken the assertion from this recommendation; re-run the original approved test after the human-reviewed correction.</div>' +
          '</div>'
        : '';
      return '<div class="ai-resolution-card">' +
        '<div class="ai-resolution-top">' + esc(a.testCase) + ' · ' + esc(a.classification) +
          '<span class="ai-resolution-meta">Severity: ' + esc(a.severity || 'medium') + '</span>' +
          '<span class="ai-resolution-meta">Confidence: ' + confidence + '%</span>' +
        '</div>' +
        '<div class="ai-resolution-summary">' + esc(a.summary || '') + '</div>' +
        (a.probableCause ? '<div class="ai-resolution-detail"><b>Probable cause:</b> ' + esc(a.probableCause) + '</div>' : '') +
        resolution +
      '</div>';
    }).join('');
  }

  function ensureAnalysisControls() {
    const analysis = document.getElementById('analysis');
    if (!analysis || document.getElementById('analyzeResultsBox')) return;
    ensureResolutionStyles();

    const box = document.createElement('div');
    box.id = 'analyzeResultsBox';
    box.style.display = 'none';
    box.style.marginTop = '12px';
    box.innerHTML =
      '<button id="analyzeResultsBtn" class="btn secondary" type="button" style="width:100%">Analyze & Suggest Resolution with AI</button>' +
      '<div id="analyzeResultsHint" class="sub" style="margin-top:7px;text-align:center">Browser execution is complete. AI analysis and remediation guidance run only for failed tests and only when you request it.</div>';
    analysis.insertAdjacentElement('beforebegin', box);

    document.getElementById('analyzeResultsBtn').addEventListener('click', analyzeResults);
  }

  function markReadyForRerun(summary) {
    if (!summary) return;
    setTimeout(() => {
      const runBtn = document.getElementById('runBtn');
      const runHint = document.getElementById('runHint');
      if (!runBtn) return;
      runBtn.textContent = 'Run Again';
      runBtn.disabled = false;
      if (runHint) {
        runHint.textContent = `${summary.passed || 0} passed · ${summary.failed || 0} failed · apply reviewed corrections, adjust selections, or run the approved set again`;
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
      btn.textContent = 'Analyzing failures & preparing resolution guidance…';
    }
    if (hint) hint.textContent = 'Sending only completed failed-test evidence to the selected AI profile. No browser execution or application modification is occurring now.';
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
      renderRichAnalyses(analyses);
      if (data.reportUrl) {
        document.getElementById('reportLink').href = data.reportUrl;
        document.getElementById('reportBox').style.display = 'block';
      }
      if (hint) hint.textContent = analyses.length ? 'AI analysis and advisory resolution guidance completed for the failed tests.' : 'There were no failed tests requiring AI analysis.';
      if (btn) btn.style.display = 'none';
      setActivityStatus('Analysis complete', false);
      markReadyForRerun(summary);
    } catch (err) {
      showError(err.message);
      if (hint) hint.textContent = 'AI analysis did not complete. Browser test results remain available above and you can still run again.';
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Retry AI Analysis & Resolution Guidance';
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
    sectionSub.textContent = 'The automation system executes approved tests deterministically. Failed-test AI analysis and remediation guidance are optional and run only after execution completes.';
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

      if (hasAnalyses) renderRichAnalyses(analyses);
      if (box) box.style.display = failed > 0 ? 'block' : 'none';
      if (failed > 0 && !hasAnalyses && btn) {
        btn.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Analyze & Suggest Resolution with AI';
        if (hint) hint.textContent = `${failed} failed test(s) are available for optional AI analysis and remediation guidance. Browser execution has already finished.`;
        setTimeout(() => {
          const reportBox = document.getElementById('reportBox');
          if (reportBox) reportBox.style.display = 'none';
        }, 0);
      } else if (hasAnalyses && btn) {
        btn.style.display = 'none';
        if (hint) hint.textContent = 'AI analysis and advisory resolution guidance completed for the failed tests.';
      }
    };
    try { renderResults = window.renderResults; } catch {}
  }
})();

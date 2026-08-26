const fs = require("fs");
const path = require("path");

const REPORT_DIR = path.join(__dirname, "..", "..", "automation-system", "artifacts", "reports");

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function pct(passed, total) {
  if (!total) return 0;
  return Math.round((passed / total) * 100);
}

function tcIdFromTitle(title) {
  return String(title || "").match(/TC(?:\d{3}|-H\d{3})/)?.[0] || "—";
}

function evidenceLinks(test) {
  if (!test.fail) return "—";
  const links = [];
  if (test.evidence?.videoUrl) {
    links.push(`<a class="evidence-link" href="${esc(test.evidence.videoUrl)}" target="_blank" rel="noopener">▶ Video</a>`);
  }
  if (test.evidence?.screenshotUrl) {
    links.push(`<a class="evidence-link" href="${esc(test.evidence.screenshotUrl)}" target="_blank" rel="noopener">▣ Screenshot</a>`);
  }
  return links.length ? `<div class="evidence-links">${links.join("")}</div>` : "—";
}

function ownerLabel(value) {
  const labels = {
    APPLICATION_TEAM: "Application team",
    TEST_AUTOMATION_TEAM: "Test automation team",
    TEST_DATA_OWNER: "Test data owner",
    ENVIRONMENT_TEAM: "Environment / DevOps team",
    BUSINESS_ANALYST: "Business analyst / product owner",
    MANUAL_REVIEW: "Manual review",
  };
  return labels[value] || String(value || "Manual review").replaceAll("_", " ");
}

function analysisHtml(analysis, test) {
  if (!analysis) {
    return test.err?.message
      ? `<span class="muted">${esc(test.err.message).slice(0, 700)}</span>`
      : "—";
  }

  const classificationClass = analysis.classification === "APPLICATION_DEFECT"
    ? "classification defect"
    : analysis.classification === "AUTOMATION_DEFECT"
      ? "classification automation"
      : "classification";

  const details = [];
  if (analysis.expected) details.push(`<div class="analysis-detail"><b>Expected:</b> ${esc(analysis.expected)}</div>`);
  if (analysis.actual) details.push(`<div class="analysis-detail"><b>Observed:</b> ${esc(analysis.actual)}</div>`);
  if (analysis.probableCause) details.push(`<div class="analysis-detail"><b>Probable cause:</b> ${esc(analysis.probableCause)}</div>`);

  let developer = "";
  if (analysis.classification === "APPLICATION_DEFECT" && (analysis.developerReviewArea || analysis.developerImplementationHint || analysis.developerExampleFix || analysis.regressionChecks?.length)) {
    const regression = Array.isArray(analysis.regressionChecks) && analysis.regressionChecks.length
      ? `<ol>${analysis.regressionChecks.map((step) => `<li>${esc(step)}</li>`).join("")}</ol>`
      : "";
    developer = `<div class="developer-box">
      <div class="developer-head">Developer fix suggestion</div>
      ${analysis.developerReviewArea ? `<div class="analysis-detail"><b>Where to inspect:</b> ${esc(analysis.developerReviewArea)}</div>` : ""}
      ${analysis.developerImplementationHint ? `<div class="analysis-detail"><b>Implementation hint:</b> ${esc(analysis.developerImplementationHint)}</div>` : ""}
      ${analysis.developerExampleFix ? `<div class="analysis-detail"><b>Illustrative fix pattern:</b></div><pre>${esc(analysis.developerExampleFix)}</pre>` : ""}
      ${regression ? `<div class="analysis-detail"><b>Regression checks:</b>${regression}</div>` : ""}
      <div class="developer-warning">Developer aid only. Unless source code was explicitly supplied to the analysis, this is not a verified source patch and must be reviewed against the real implementation.</div>
    </div>`;
  }

  let resolution = "";
  if (analysis.resolutionComment || analysis.recommendedFix || analysis.verificationSteps?.length || developer) {
    const verification = Array.isArray(analysis.verificationSteps) && analysis.verificationSteps.length
      ? `<ol>${analysis.verificationSteps.map((step) => `<li>${esc(step)}</li>`).join("")}</ol>`
      : "";
    resolution = `<div class="resolution-box">
      <div class="resolution-head">AI resolution guidance <span>Human review required</span></div>
      ${analysis.resolutionComment ? `<div class="resolution-comment">${esc(analysis.resolutionComment)}</div>` : ""}
      ${analysis.recommendedFix ? `<div class="analysis-detail"><b>Recommended fix:</b> ${esc(analysis.recommendedFix)}</div>` : ""}
      ${analysis.recommendedOwner ? `<div class="analysis-detail"><b>Suggested owner:</b> ${esc(ownerLabel(analysis.recommendedOwner))}</div>` : ""}
      ${developer}
      ${verification ? `<div class="analysis-detail"><b>Verify after correction:</b>${verification}</div>` : ""}
      <div class="resolution-warning">Advisory only — this does not modify the application, weaken the test, close the defect, or mark the test resolved. Resolution is proven only by a successful re-run.</div>
    </div>`;
  }

  return `<span class="${classificationClass}">${esc(analysis.classification)}</span>` +
    `<div class="analysis-summary">${esc(analysis.summary || "")}</div>` +
    details.join("") + resolution;
}

function reportFileName(sessionId) {
  const safe = String(sessionId || "run").replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${safe}.html`;
}

function saveReportHtml(sessionId, html) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const filePath = path.join(REPORT_DIR, reportFileName(sessionId));
  fs.writeFileSync(filePath, html, "utf8");
  return filePath;
}

function buildAnalyticsReport({ sessionId, story, targetUrl, environment, summary, analyses }) {
  const successRate = pct(summary.passed, summary.total);
  const defectCount = (analyses || []).filter((a) => a?.classification === "APPLICATION_DEFECT").length;
  const analysisById = new Map((analyses || []).map((a) => [a.testCase, a]));

  const rows = (summary.tests || []).map((t) => {
    const id = tcIdFromTitle(t.title);
    const analysis = analysisById.get(id);
    const outcomeLabel = t.pass ? "PASS" : "FAIL";
    const defectDetected = !t.pass && analysis?.classification === "APPLICATION_DEFECT";
    return `
      <tr>
        <td><code>${esc(id)}</code></td>
        <td>${esc(t.title)}</td>
        <td>
          <span class="status ${t.pass ? "pass" : "fail"}">${outcomeLabel}</span>
          ${defectDetected ? '<div class="detected">Application defect detected</div>' : ''}
        </td>
        <td>${t.durationMs == null ? "—" : `${esc(t.durationMs)} ms`}</td>
        <td>${evidenceLinks(t)}</td>
        <td>${analysisHtml(analysis, t)}</td>
      </tr>`;
  }).join("");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI TestPilot Analytics</title>
<style>
  :root{--bg:#f6f8fb;--panel:#fff;--border:#e6eaf1;--text:#10141c;--muted:#6b7385;--blue:#2f5bff;--green:#15803d;--red:#b91c1c;--amber:#92400e}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,Segoe UI,Arial,sans-serif}
  .wrap{max-width:1420px;margin:0 auto;padding:30px 22px 50px}.hero{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;margin-bottom:24px}
  h1{margin:0 0 6px;font-size:28px}.muted{color:var(--muted);font-size:13px;line-height:1.45}.meta{font-size:12px;color:var(--muted);text-align:right}
  .cards{display:grid;grid-template-columns:repeat(5,1fr);gap:14px;margin:20px 0}.card{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:18px}.metric{font-size:30px;font-weight:800;margin-top:6px}.label{font-size:12px;color:var(--muted)}
  .story{white-space:pre-wrap;line-height:1.55}.section-title{margin:26px 0 10px;font-size:16px}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--border);border-radius:14px;overflow:hidden}th,td{padding:12px 13px;border-bottom:1px solid var(--border);text-align:left;vertical-align:top;font-size:13px}th{background:#fafbfd;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.04em}.status{display:inline-block;padding:4px 8px;border-radius:999px;font-weight:700;font-size:11px}.pass{background:#dcfce7;color:var(--green)}.fail{background:#fee2e2;color:var(--red)}code{font-family:Consolas,monospace;color:var(--blue)}
  .evidence-links{display:flex;gap:7px;flex-wrap:wrap}.evidence-link{display:inline-block;text-decoration:none;border:1px solid #dbe3ff;background:#f5f7ff;color:var(--blue);padding:5px 8px;border-radius:7px;font-size:11px;font-weight:700}.evidence-link:hover{background:#edf1ff}
  .readiness-note{border-left:4px solid var(--blue);background:#f5f7ff}.readiness-note strong{display:block;margin-bottom:5px}.detected{margin-top:5px;font-size:11px;font-weight:700;color:var(--red)}
  .classification{display:inline-block;font-size:11px;font-weight:800;padding:4px 7px;border-radius:6px;background:#eef2ff;color:#3730a3}.classification.defect{background:#fee2e2;color:var(--red)}.classification.automation{background:#fef3c7;color:var(--amber)}
  .analysis-summary{margin-top:7px;line-height:1.45;color:var(--muted)}.analysis-detail{margin-top:6px;line-height:1.4;font-size:12px}.analysis-detail b{color:var(--text)}
  .resolution-box{margin-top:10px;padding:11px 12px;border-radius:9px;border:1px solid #bfdbfe;background:#f8fbff}.resolution-head{font-size:11px;font-weight:900;color:#1d4ed8;text-transform:uppercase;letter-spacing:.03em}.resolution-head span{margin-left:6px;padding:2px 5px;border-radius:5px;background:#fef3c7;color:#92400e;font-size:9px}.resolution-comment{margin-top:7px;line-height:1.45;font-size:12px;color:#334155}.resolution-box ol{margin:5px 0 0 18px;padding:0}.resolution-box li{margin:3px 0}.resolution-warning{margin-top:9px;padding-top:7px;border-top:1px solid #dbeafe;color:#64748b;font-size:10.5px;line-height:1.4}
  .developer-box{margin-top:10px;padding:11px;border-radius:9px;border:1px solid #c7d2fe;background:#fff}.developer-head{font-size:11px;font-weight:900;color:#4338ca;text-transform:uppercase;letter-spacing:.03em}.developer-box pre{margin:7px 0 0;padding:10px;border-radius:7px;background:#111827;color:#e5e7eb;font-family:Consolas,monospace;font-size:11px;line-height:1.45;white-space:pre-wrap;overflow:auto}.developer-warning{margin-top:8px;padding-top:7px;border-top:1px solid #e0e7ff;color:#64748b;font-size:10.5px;line-height:1.4}
  @media(max-width:1050px){.cards{grid-template-columns:repeat(3,1fr)}}@media(max-width:800px){.cards{grid-template-columns:repeat(2,1fr)}.hero{display:block}.meta{text-align:left;margin-top:14px}table{display:block;overflow:auto}}
</style>
</head>
<body><div class="wrap">
  <div class="hero">
    <div><h1>AI TestPilot Analytics</h1><div class="muted">Story-driven AI automation execution report</div></div>
    <div class="meta">Run: ${esc(sessionId)}<br>Generated: ${esc(new Date().toLocaleString())}</div>
  </div>
  <div class="cards">
    <div class="card"><div class="label">Tests</div><div class="metric">${esc(summary.total)}</div></div>
    <div class="card"><div class="label">Passed</div><div class="metric" style="color:var(--green)">${esc(summary.passed)}</div></div>
    <div class="card"><div class="label">Failed</div><div class="metric" style="color:var(--red)">${esc(summary.failed)}</div></div>
    <div class="card"><div class="label">Defects detected</div><div class="metric" style="color:var(--red)">${esc(defectCount)}</div></div>
    <div class="card"><div class="label">Execution pass rate</div><div class="metric" style="color:var(--blue)">${successRate}%</div></div>
  </div>
  <div class="card readiness-note">
    <strong>Automation Ready ≠ Test Passed</strong>
    <div class="muted">Automation Ready means the reviewed test was grounded against discovered application evidence and successfully compiled into the deterministic Cypress contract. PASS or FAIL is determined only after browser execution. A FAIL classified as APPLICATION_DEFECT means the automation worked and detected application behavior that did not satisfy the expected requirement.</div>
  </div>
  <div class="card" style="margin-top:14px"><div class="label">Target</div><strong>${esc(targetUrl)}</strong><div class="muted" style="margin-top:4px">Environment: ${esc(environment || "Test")}${summary.browser ? ` · Browser: ${esc(summary.browser)}` : ""}</div></div>
  <h2 class="section-title">Business story</h2>
  <div class="card story">${esc(story)}</div>
  <h2 class="section-title">Execution results</h2>
  <table><thead><tr><th>Case</th><th>Test</th><th>Execution outcome</th><th>Duration</th><th>Evidence</th><th>Failure analysis & developer guidance</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="muted" style="margin-top:12px">Every row shown here passed the automation-readiness gate before execution. Developer suggestions are advisory and require human review. A defect is considered resolved only after the responsible change is made and the original approved test passes on re-run.</div>
</div></body></html>`;

  saveReportHtml(sessionId, html);
  return html;
}

module.exports = { buildAnalyticsReport, REPORT_DIR, reportFileName };

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

function buildAnalyticsReport({ sessionId, story, targetUrl, environment, summary, analyses, model }) {
  const successRate = pct(summary.passed, summary.total);
  const analysisById = new Map((analyses || []).map((a) => [a.testCase, a]));

  const rows = (summary.tests || []).map((t) => {
    const id = tcIdFromTitle(t.title);
    const analysis = analysisById.get(id);
    return `
      <tr>
        <td><code>${esc(id)}</code></td>
        <td>${esc(t.title)}</td>
        <td><span class="status ${t.pass ? "pass" : "fail"}">${t.pass ? "PASS" : "FAIL"}</span></td>
        <td>${t.durationMs == null ? "—" : `${esc(t.durationMs)} ms`}</td>
        <td>${evidenceLinks(t)}</td>
        <td>${analysis ? `<strong>${esc(analysis.classification)}</strong><br><span class="muted">${esc(analysis.summary)}</span>` : (t.err?.message ? `<span class="muted">${esc(t.err.message).slice(0, 500)}</span>` : "—")}</td>
      </tr>`;
  }).join("");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI TestPilot Analytics</title>
<style>
  :root{--bg:#f6f8fb;--panel:#fff;--border:#e6eaf1;--text:#10141c;--muted:#6b7385;--blue:#2f5bff;--green:#15803d;--red:#b91c1c}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,Segoe UI,Arial,sans-serif}
  .wrap{max-width:1280px;margin:0 auto;padding:30px 22px 50px}.hero{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;margin-bottom:24px}
  h1{margin:0 0 6px;font-size:28px}.muted{color:var(--muted);font-size:13px;line-height:1.45}.meta{font-size:12px;color:var(--muted);text-align:right}
  .cards{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:20px 0}.card{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:18px}.metric{font-size:30px;font-weight:800;margin-top:6px}.label{font-size:12px;color:var(--muted)}
  .story{white-space:pre-wrap;line-height:1.55}.section-title{margin:26px 0 10px;font-size:16px}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--border);border-radius:14px;overflow:hidden}th,td{padding:12px 13px;border-bottom:1px solid var(--border);text-align:left;vertical-align:top;font-size:13px}th{background:#fafbfd;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.04em}.status{display:inline-block;padding:4px 8px;border-radius:999px;font-weight:700;font-size:11px}.pass{background:#dcfce7;color:var(--green)}.fail{background:#fee2e2;color:var(--red)}code{font-family:Consolas,monospace;color:var(--blue)}
  .evidence-links{display:flex;gap:7px;flex-wrap:wrap}.evidence-link{display:inline-block;text-decoration:none;border:1px solid #dbe3ff;background:#f5f7ff;color:var(--blue);padding:5px 8px;border-radius:7px;font-size:11px;font-weight:700}.evidence-link:hover{background:#edf1ff}
  @media(max-width:800px){.cards{grid-template-columns:repeat(2,1fr)}.hero{display:block}.meta{text-align:left;margin-top:14px}table{display:block;overflow:auto}}
</style>
</head>
<body><div class="wrap">
  <div class="hero">
    <div><h1>AI TestPilot Analytics</h1><div class="muted">Story-driven AI automation execution report</div></div>
    <div class="meta">Run: ${esc(sessionId)}<br>Model: ${esc(model)}<br>Generated: ${esc(new Date().toLocaleString())}</div>
  </div>
  <div class="cards">
    <div class="card"><div class="label">Tests</div><div class="metric">${esc(summary.total)}</div></div>
    <div class="card"><div class="label">Passed</div><div class="metric" style="color:var(--green)">${esc(summary.passed)}</div></div>
    <div class="card"><div class="label">Failed</div><div class="metric" style="color:var(--red)">${esc(summary.failed)}</div></div>
    <div class="card"><div class="label">Success rate</div><div class="metric" style="color:var(--blue)">${successRate}%</div></div>
  </div>
  <div class="card"><div class="label">Target</div><strong>${esc(targetUrl)}</strong><div class="muted" style="margin-top:4px">Environment: ${esc(environment || "Test")}${summary.browser ? ` · Browser: ${esc(summary.browser)}` : ""}</div></div>
  <h2 class="section-title">Business story</h2>
  <div class="card story">${esc(story)}</div>
  <h2 class="section-title">Execution results</h2>
  <table><thead><tr><th>Case</th><th>Test</th><th>Status</th><th>Duration</th><th>Evidence</th><th>AI analysis / error</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="muted" style="margin-top:12px">This optimized branch runs all approved cases in one generated spec. Failed cases keep individual screenshots; Video links, when enabled, point to the shared full-run recording.</div>
</div></body></html>`;

  saveReportHtml(sessionId, html);
  return html;
}

module.exports = { buildAnalyticsReport, REPORT_DIR, reportFileName };

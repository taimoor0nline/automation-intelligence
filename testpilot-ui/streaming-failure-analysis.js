(function () {
  if (window.__testNexusStreamingFailureAnalysis) return;
  window.__testNexusStreamingFailureAnalysis = true;

  let active = false;
  let analyses = [];
  let summary = null;
  let currentSource = null;

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function token() {
    try { return sessionStorage.getItem("aiTestPilotToken") || ""; } catch { return ""; }
  }

  function session() {
    try {
      if (window.sessionId) return window.sessionId;
      if (typeof sessionId !== "undefined") return sessionId;
    } catch {}
    return "default";
  }

  function ensureStyles() {
    if (document.getElementById("streamingFailureAnalysisStyles")) return;
    const style = document.createElement("style");
    style.id = "streamingFailureAnalysisStyles";
    style.textContent = `
      .analysis-stream-shell{margin-top:12px;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc;overflow:hidden}
      .analysis-stream-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border-bottom:1px solid #e2e8f0;background:#fff}
      .analysis-stream-title{font-size:11.5px;font-weight:900;color:#0f172a}.analysis-stream-progress{font-size:10.5px;font-weight:800;color:#475569}
      .analysis-stream-bar{height:4px;background:#e2e8f0}.analysis-stream-bar>span{display:block;height:100%;width:0;background:#2f5bff;transition:width .2s ease}
      .analysis-stream-list{max-height:520px;overflow:auto;padding:8px}
      .analysis-stream-row{padding:10px;border:1px solid #e2e8f0;border-radius:9px;background:#fff;margin-bottom:7px}
      .analysis-stream-row:last-child{margin-bottom:0}.analysis-stream-top{display:flex;justify-content:space-between;gap:8px;align-items:center}
      .analysis-stream-id{font-size:10.5px;font-weight:900;color:#1e40af}.analysis-stream-state{font-size:9.5px;font-weight:900;border-radius:999px;padding:3px 7px;background:#eff6ff;color:#1d4ed8}
      .analysis-stream-state.done{background:#dcfce7;color:#166534}.analysis-stream-state.error{background:#fee2e2;color:#b91c1c}
      .analysis-stream-summary{margin-top:6px;font-size:11px;line-height:1.45;color:#475569}.analysis-stream-meta{margin-top:5px;font-size:10px;color:#64748b}
    `;
    document.head.appendChild(style);
  }

  function ensureShell(totalFailed) {
    ensureStyles();
    let shell = document.getElementById("analysisStreamShell");
    if (!shell) {
      shell = document.createElement("div");
      shell.id = "analysisStreamShell";
      shell.className = "analysis-stream-shell";
      shell.innerHTML = `
        <div class="analysis-stream-head">
          <div class="analysis-stream-title">Live AI failure analysis</div>
          <div id="analysisStreamProgress" class="analysis-stream-progress">0 / 0 analyzed</div>
        </div>
        <div class="analysis-stream-bar"><span id="analysisStreamBar"></span></div>
        <div id="analysisStreamList" class="analysis-stream-list"></div>`;
      const analysis = document.getElementById("analysis");
      if (analysis) analysis.insertAdjacentElement("beforebegin", shell);
    }
    shell.style.display = "block";
    updateProgress(0, totalFailed || 0);
    return shell;
  }

  function updateProgress(completed, total) {
    const label = document.getElementById("analysisStreamProgress");
    const bar = document.getElementById("analysisStreamBar");
    if (label) label.textContent = `${completed} / ${total} analyzed`;
    if (bar) bar.style.width = `${total ? Math.round((completed / total) * 100) : 0}%`;
  }

  function rowId(testCase) { return `analysis-stream-${String(testCase || "unknown").replace(/[^A-Za-z0-9_-]/g, "-")}`; }

  function setStarted(event) {
    const list = document.getElementById("analysisStreamList");
    if (!list) return;
    let row = document.getElementById(rowId(event.testCase));
    if (!row) {
      row = document.createElement("div");
      row.id = rowId(event.testCase);
      row.className = "analysis-stream-row";
      list.appendChild(row);
    }
    row.innerHTML = `<div class="analysis-stream-top"><span class="analysis-stream-id">${esc(event.testCase)} · ${esc(event.title || "Failed test")}</span><span class="analysis-stream-state">Analyzing</span></div><div class="analysis-stream-summary">AI analysis queued on worker ${esc(event.workerNumber || "")}. Execution evidence remains unchanged.</div>`;
  }

  function setCompleted(event, failed) {
    const analysis = event.analysis || {};
    const list = document.getElementById("analysisStreamList");
    if (!list) return;
    let row = document.getElementById(rowId(event.testCase));
    if (!row) {
      row = document.createElement("div");
      row.id = rowId(event.testCase);
      row.className = "analysis-stream-row";
      list.appendChild(row);
    }
    row.innerHTML = `<div class="analysis-stream-top"><span class="analysis-stream-id">${esc(event.testCase)} · ${esc(event.title || "Failed test")}</span><span class="analysis-stream-state ${failed ? "error" : "done"}">${failed ? "Analysis error" : "Analyzed"}</span></div><div class="analysis-stream-summary">${esc(analysis.summary || analysis.probableCause || "Analysis completed.")}</div><div class="analysis-stream-meta">${esc(analysis.classification || "UNKNOWN")}${analysis.severity ? ` · Severity ${esc(analysis.severity)}` : ""}${analysis.confidence != null ? ` · Confidence ${Math.round(Number(analysis.confidence || 0) * 100)}%` : ""}</div>`;
  }

  function publishProgress(total) {
    window.dispatchEvent(new CustomEvent("testnexus:analysis-progress", {
      detail: { summary, analyses: [...analyses], totalFailed: total }
    }));
  }

  function handleEvent(type, event) {
    const total = Number(event.totalFailed || 0);
    if (type === "ANALYSIS_STARTED") {
      ensureShell(total);
      updateProgress(0, total);
    } else if (type === "ANALYSIS_ITEM_STARTED") {
      setStarted(event);
    } else if (type === "ANALYSIS_ITEM_COMPLETED" || type === "ANALYSIS_ITEM_FAILED") {
      analyses = analyses.filter((item) => String(item.testCase).toUpperCase() !== String(event.testCase).toUpperCase());
      if (event.analysis) analyses.push(event.analysis);
      setCompleted(event, type === "ANALYSIS_ITEM_FAILED");
      updateProgress(Number(event.completed || analyses.length), total);
      publishProgress(total);
    } else if (type === "ANALYSIS_COMPLETED") {
      analyses = Array.isArray(event.failureAnalyses) ? event.failureAnalyses : analyses;
      summary = event.summary || summary;
      updateProgress(Number(event.completed || analyses.length), total);
      publishProgress(total);
      if (typeof window.renderResults === "function" && summary) window.renderResults(summary, analyses);
      const reportBox = document.getElementById("reportBox"), reportLink = document.getElementById("reportLink");
      if (event.reportUrl && reportLink) reportLink.href = event.reportUrl;
      if (reportBox) reportBox.style.display = "block";
      finish("Analysis complete");
    } else if (type === "ANALYSIS_CANCELLED") {
      active = false;
      try { currentSource?.close?.(); } catch {}
      currentSource = null;
      document.getElementById("analysisStreamShell")?.remove();
    } else if (type === "ANALYSIS_FAILED") {
      finish("Analysis failed", true);
    }
  }

  function parseSseChunk(buffer, onEvent) {
    const blocks = buffer.split(/\r?\n\r?\n/);
    const tail = blocks.pop() || "";
    for (const block of blocks) {
      if (!block.trim() || block.startsWith(":")) continue;
      let type = "message", data = "";
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith("event:")) type = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) continue;
      try { onEvent(type, JSON.parse(data)); } catch {}
    }
    return tail;
  }

  async function consumeFetchStream(url) {
    const headers = {};
    const auth = token();
    if (auth) headers.Authorization = `Bearer ${auth}`;
    const response = await fetch(url, { headers });
    if (!response.ok || !response.body) throw new Error("Could not open analysis event stream.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = parseSseChunk(buffer, handleEvent);
    }
  }

  function consumeEventSource(url) {
    return new Promise((resolve, reject) => {
      const source = new EventSource(url);
      currentSource = source;
      const types = ["ANALYSIS_STARTED","ANALYSIS_ITEM_STARTED","ANALYSIS_ITEM_COMPLETED","ANALYSIS_ITEM_FAILED","ANALYSIS_CHECKPOINT","ANALYSIS_CANCEL_REQUESTED","ANALYSIS_CANCELLED","ANALYSIS_COMPLETED","ANALYSIS_FAILED"];
      types.forEach((type) => source.addEventListener(type, (event) => {
        try {
          const data = JSON.parse(event.data);
          handleEvent(type, data);
          if (type === "ANALYSIS_COMPLETED" || type === "ANALYSIS_CANCELLED") { source.close(); currentSource = null; resolve(); }
          if (type === "ANALYSIS_FAILED") { source.close(); currentSource = null; reject(new Error(data.error || "Analysis failed.")); }
        } catch {}
      }));
      source.onerror = () => {
        if (!active) return;
        source.close(); currentSource = null;
        reject(new Error("Analysis event stream disconnected."));
      };
    });
  }

  function finish(text, failed) {
    active = false;
    const btn = document.getElementById("analyzeResultsBtn");
    const hint = document.getElementById("analyzeResultsHint");
    if (btn) {
      btn.disabled = false;
      btn.style.display = failed ? "block" : "none";
      btn.textContent = failed ? "Retry AI Failure Analysis" : "Analysis complete";
    }
    if (hint) hint.textContent = text;
    try { if (typeof setActivityStatus === "function") setActivityStatus(text, false); } catch {}
  }

  async function startAnalysis(event) {
    event?.preventDefault?.();
    event?.stopImmediatePropagation?.();
    if (active) return;
    const sid = session();
    const btn = document.getElementById("analyzeResultsBtn");
    const hint = document.getElementById("analyzeResultsHint");
    active = true;
    analyses = [];
    if (btn) { btn.disabled = true; btn.textContent = "Starting AI failure analysis…"; }
    if (hint) hint.textContent = "Failed tests are analyzed through a bounded worker queue. Results appear here as each case completes.";
    try {
      const headers = { "Content-Type": "application/json" };
      const auth = token();
      if (auth) headers.Authorization = `Bearer ${auth}`;
      const response = await fetch("/api/test-results/analyze/start", {
        method: "POST",
        headers,
        body: JSON.stringify({ sessionId: sid }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.reply || "Could not start AI failure analysis.");
      if (data.analysisNeeded === false) { finish("No failed tests require analysis."); return; }
      ensureShell(Number(data.totalFailed || 0));
      if (btn) btn.textContent = `Analyzing 0/${Number(data.totalFailed || 0)} failures…`;
      if (auth) await consumeFetchStream(data.eventsUrl);
      else await consumeEventSource(data.eventsUrl);
    } catch (err) {
      if (!active) return;
      try { if (typeof showError === "function") showError(err.message); } catch {}
      finish("AI analysis did not complete. Execution results remain available.", true);
    }
  }

  function bind() {
    const old = document.getElementById("analyzeResultsBtn");
    if (!old || old.dataset.streamingBound === "1") return Boolean(old);
    const button = old.cloneNode(true);
    button.dataset.streamingBound = "1";
    old.replaceWith(button);
    button.addEventListener("click", startAnalysis, true);
    return true;
  }

  function start() {
    let attempts = 0;
    const timer = setInterval(() => {
      if (bind() || ++attempts > 80) clearInterval(timer);
    }, 250);
    bind();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();

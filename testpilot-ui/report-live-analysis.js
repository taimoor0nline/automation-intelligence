(function () {
  const body = document.body;
  const sessionId = body?.dataset?.reportSessionId || "";
  if (!sessionId) return;

  const cells = new Map(
    Array.from(document.querySelectorAll("[data-analysis-case]"))
      .map((cell) => [String(cell.dataset.analysisCase || "").toUpperCase(), cell])
      .filter(([id]) => id)
  );
  const failedIds = new Set(
    Array.from(document.querySelectorAll('[data-analysis-failed="true"]'))
      .map((cell) => String(cell.dataset.analysisCase || "").toUpperCase())
      .filter(Boolean)
  );

  if (!failedIds.size) return;

  let activeJobId = null;
  let stopped = false;
  let reconnectTimer = null;
  let currentAbort = null;
  const analyses = new Map();

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function authHeaders(extra) {
    const headers = { ...(extra || {}) };
    try {
      const token = sessionStorage.getItem("aiTestPilotToken") || "";
      if (token) headers.Authorization = `Bearer ${token}`;
    } catch {}
    return headers;
  }

  function waitingHtml() {
    return '<div class="analysis-live pending"><div class="analysis-live-head"><span class="analysis-live-dot"></span><strong>Waiting for AI response…</strong></div><div class="analysis-live-note">Execution has finished. This failed case is queued for failed-only AI analysis; the PASS/FAIL result and evidence remain unchanged.</div></div>';
  }

  function analyzingHtml() {
    return '<div class="analysis-live running"><div class="analysis-live-head"><span class="analysis-live-dot"></span><strong>AI analysis in progress…</strong></div><div class="analysis-live-note">The analysis worker is reviewing this failed case. Other failed cases continue through the bounded queue independently.</div></div>';
  }

  function errorHtml(message) {
    return `<div class="analysis-live error"><div class="analysis-live-head"><strong>AI analysis unavailable</strong></div><div class="analysis-live-note">${esc(message || "The AI analysis stream did not complete for this case. Execution results remain valid.")}</div></div>`;
  }

  function setCell(testCase, html) {
    const id = String(testCase || "").toUpperCase();
    const cell = cells.get(id);
    if (!cell || !failedIds.has(id)) return;
    cell.innerHTML = html || waitingHtml();
  }

  function updateDefectMetric() {
    const metric = document.getElementById("defectMetric");
    if (!metric) return;
    const count = Array.from(analyses.values()).filter((item) => item?.classification === "APPLICATION_DEFECT").length;
    metric.textContent = String(count);
  }

  function applyItem(item) {
    if (!item?.testCase) return;
    const id = String(item.testCase).toUpperCase();
    if (item.analysis) analyses.set(id, item.analysis);
    setCell(id, item.analysisHtml || errorHtml("Analysis completed, but the detailed HTML fragment was unavailable."));
    updateDefectMetric();
  }

  function applySnapshot(data) {
    for (const id of failedIds) {
      if (!analyses.has(id)) setCell(id, waitingHtml());
    }
    for (const item of data?.items || []) applyItem(item);
    for (const id of data?.startedTestCases || []) {
      const key = String(id || "").toUpperCase();
      if (!analyses.has(key)) setCell(key, analyzingHtml());
    }
  }

  function parseSseChunk(buffer, onEvent) {
    const blocks = buffer.split(/\r?\n\r?\n/);
    const tail = blocks.pop() || "";
    for (const block of blocks) {
      if (!block.trim() || block.startsWith(":")) continue;
      let type = "message";
      let data = "";
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith("event:")) type = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) continue;
      try { onEvent(type, JSON.parse(data)); } catch {}
    }
    return tail;
  }

  function onAnalysisEvent(type, event) {
    if (type === "ANALYSIS_ITEM_STARTED") {
      const id = String(event.testCase || "").toUpperCase();
      if (!analyses.has(id)) setCell(id, analyzingHtml());
      return;
    }
    if (type === "ANALYSIS_ITEM_COMPLETED" || type === "ANALYSIS_ITEM_FAILED") {
      if (event.analysis) analyses.set(String(event.testCase || "").toUpperCase(), event.analysis);
      setCell(event.testCase, event.analysisHtml || (type === "ANALYSIS_ITEM_FAILED" ? errorHtml(event.error) : errorHtml()));
      updateDefectMetric();
      return;
    }
    if (type === "ANALYSIS_COMPLETED") {
      stopped = true;
      activeJobId = null;
      clearTimeout(reconnectTimer);
      return;
    }
    if (type === "ANALYSIS_FAILED") {
      activeJobId = null;
      scheduleDiscovery(1800);
    }
  }

  async function consumeFetchStream(url) {
    currentAbort?.abort?.();
    currentAbort = new AbortController();
    const response = await fetch(url, {
      headers: authHeaders(),
      signal: currentAbort.signal,
      cache: "no-store",
    });
    if (!response.ok || !response.body) throw new Error("Could not open the live AI analysis stream.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (!stopped) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = parseSseChunk(buffer, onAnalysisEvent);
    }
  }

  function scheduleDiscovery(delay) {
    if (stopped) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(discover, delay || 1500);
  }

  async function connect(job) {
    if (!job?.eventsUrl || !job?.jobId || stopped) return;
    if (activeJobId === job.jobId) return;
    activeJobId = job.jobId;
    try {
      await consumeFetchStream(job.eventsUrl);
      if (!stopped) {
        activeJobId = null;
        scheduleDiscovery(1200);
      }
    } catch (err) {
      if (err?.name === "AbortError" || stopped) return;
      activeJobId = null;
      scheduleDiscovery(1800);
    }
  }

  async function discover() {
    if (stopped) return;
    try {
      const response = await fetch(`/api/test-results/analyze/current/${encodeURIComponent(sessionId)}`, {
        headers: authHeaders(),
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Could not read AI analysis status.");
      const data = await response.json();
      applySnapshot(data);

      if (data.state === "COMPLETED" || data.state === "NOT_REQUIRED") {
        stopped = true;
        return;
      }
      if (data.jobId && data.eventsUrl) {
        connect(data);
        return;
      }
      scheduleDiscovery(1500);
    } catch {
      scheduleDiscovery(2500);
    }
  }

  window.addEventListener("beforeunload", () => {
    stopped = true;
    clearTimeout(reconnectTimer);
    currentAbort?.abort?.();
  });

  for (const id of failedIds) setCell(id, waitingHtml());
  discover();
})();

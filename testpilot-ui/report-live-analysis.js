(function () {
  const body = document.body;
  const sessionId = body?.dataset?.reportSessionId || '';
  if (!sessionId) return;

  const cells = new Map(
    Array.from(document.querySelectorAll('[data-analysis-case]'))
      .map((cell) => [String(cell.dataset.analysisCase || '').toUpperCase(), cell])
      .filter(([id]) => id)
  );
  const failedIds = new Set(
    Array.from(document.querySelectorAll('[data-analysis-failed="true"]'))
      .map((cell) => String(cell.dataset.analysisCase || '').toUpperCase())
      .filter(Boolean)
  );

  if (!failedIds.size) return;

  let activeJobId = null;
  let stopped = false;
  let reconnectTimer = null;
  let currentAbort = null;
  let startRequested = false;
  const analyses = new Map();

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function authHeaders(extra) {
    const headers = { ...(extra || {}) };
    try {
      const token = sessionStorage.getItem('aiTestPilotToken') || '';
      if (token) headers.Authorization = `Bearer ${token}`;
    } catch {}
    return headers;
  }

  function ensureLiveStatus() {
    let status = document.getElementById('reportAiLiveStatus');
    if (status) return status;
    const actions = document.querySelector('.hero-actions');
    if (!actions) return null;
    status = document.createElement('span');
    status.id = 'reportAiLiveStatus';
    status.style.cssText = 'display:inline-flex;align-items:center;gap:7px;border:1px solid #bfdbfe;background:#eff6ff;color:#1d4ed8;border-radius:9px;padding:8px 10px;font-size:10.5px;font-weight:800;white-space:nowrap';
    actions.insertBefore(status, actions.firstChild);
    return status;
  }

  function updateLiveStatus(text, mode) {
    const status = ensureLiveStatus();
    if (!status) return;
    status.textContent = text;
    if (mode === 'done') {
      status.style.background = '#dcfce7';
      status.style.borderColor = '#bbf7d0';
      status.style.color = '#166534';
    } else if (mode === 'error') {
      status.style.background = '#fff7f7';
      status.style.borderColor = '#fecaca';
      status.style.color = '#b91c1c';
    } else {
      status.style.background = '#eff6ff';
      status.style.borderColor = '#bfdbfe';
      status.style.color = '#1d4ed8';
    }
  }

  function updateProgressStatus(prefix) {
    const completed = analyses.size;
    const total = failedIds.size;
    updateLiveStatus(`${prefix || 'Live AI analysis'} · ${completed}/${total} failed cases`, completed >= total ? 'done' : 'running');
  }

  function waitingHtml() {
    return '<div class="analysis-live pending"><div class="analysis-live-head"><span class="analysis-live-dot"></span><strong>Waiting for AI response…</strong></div><div class="analysis-live-note">This failed case is queued for AI analysis. Execution evidence and the PASS/FAIL result remain unchanged.</div></div>';
  }

  function analyzingHtml() {
    return '<div class="analysis-live running"><div class="analysis-live-head"><span class="analysis-live-dot"></span><strong>AI analysis in progress…</strong></div><div class="analysis-live-note">The failed-case worker is reviewing this result. Other failed cases continue independently through the bounded queue.</div></div>';
  }

  function errorHtml(message) {
    return `<div class="analysis-live error"><div class="analysis-live-head"><strong>AI analysis unavailable</strong></div><div class="analysis-live-note">${esc(message || 'The AI analysis stream did not complete for this case. Execution results remain valid.')}</div></div>`;
  }

  function setCell(testCase, html) {
    const id = String(testCase || '').toUpperCase();
    const cell = cells.get(id);
    if (!cell || !failedIds.has(id)) return;
    cell.innerHTML = html || waitingHtml();
  }

  function updateDefectMetric() {
    const metric = document.getElementById('defectMetric');
    if (!metric) return;
    const count = Array.from(analyses.values()).filter((item) => item?.classification === 'APPLICATION_DEFECT').length;
    metric.textContent = String(count);
  }

  function applyItem(item) {
    if (!item?.testCase) return;
    const id = String(item.testCase).toUpperCase();
    if (item.analysis) analyses.set(id, item.analysis);
    setCell(id, item.analysisHtml || errorHtml('Analysis completed, but the detailed HTML fragment was unavailable.'));
    updateDefectMetric();
    updateProgressStatus('Live AI analysis');
  }

  function applySnapshot(data) {
    for (const id of failedIds) {
      if (!analyses.has(id)) setCell(id, waitingHtml());
    }
    for (const item of data?.items || []) applyItem(item);
    for (const id of data?.startedTestCases || []) {
      const key = String(id || '').toUpperCase();
      if (!analyses.has(key)) setCell(key, analyzingHtml());
    }
    updateProgressStatus(data?.state === 'COMPLETED' ? 'AI analysis complete' : 'Live AI analysis');
  }

  function parseSseChunk(buffer, onEvent) {
    const blocks = buffer.split(/\r?\n\r?\n/);
    const tail = blocks.pop() || '';
    for (const block of blocks) {
      if (!block.trim() || block.startsWith(':')) continue;
      let type = 'message';
      let data = '';
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith('event:')) type = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!data) continue;
      try { onEvent(type, JSON.parse(data)); } catch {}
    }
    return tail;
  }

  function onAnalysisEvent(type, event) {
    if (type === 'ANALYSIS_STARTED') {
      updateLiveStatus(`Analyzing ${failedIds.size} failed case${failedIds.size === 1 ? '' : 's'}…`, 'running');
      return;
    }
    if (type === 'ANALYSIS_ITEM_STARTED') {
      const id = String(event.testCase || '').toUpperCase();
      if (!analyses.has(id)) setCell(id, analyzingHtml());
      updateProgressStatus('Live AI analysis');
      return;
    }
    if (type === 'ANALYSIS_ITEM_COMPLETED' || type === 'ANALYSIS_ITEM_FAILED') {
      if (event.analysis) analyses.set(String(event.testCase || '').toUpperCase(), event.analysis);
      setCell(event.testCase, event.analysisHtml || (type === 'ANALYSIS_ITEM_FAILED' ? errorHtml(event.error) : errorHtml()));
      updateDefectMetric();
      updateProgressStatus('Live AI analysis');
      return;
    }
    if (type === 'ANALYSIS_COMPLETED') {
      stopped = true;
      activeJobId = null;
      clearTimeout(reconnectTimer);
      updateLiveStatus(`AI analysis complete · ${analyses.size}/${failedIds.size} failed cases`, 'done');
      return;
    }
    if (type === 'ANALYSIS_FAILED') {
      activeJobId = null;
      startRequested = false;
      for (const id of failedIds) {
        if (!analyses.has(id)) setCell(id, errorHtml('The AI analysis job stopped before this case completed.'));
      }
      updateLiveStatus('AI analysis interrupted · execution results remain valid', 'error');
      scheduleDiscovery(5000);
      return;
    }
    if (type === 'ANALYSIS_CANCELLED') {
      activeJobId = null;
      stopped = true;
      updateLiveStatus('AI analysis stopped', 'error');
    }
  }

  async function consumeFetchStream(url) {
    currentAbort?.abort?.();
    currentAbort = new AbortController();
    const response = await fetch(url, {
      headers: authHeaders(),
      signal: currentAbort.signal,
      cache: 'no-store',
    });
    if (!response.ok || !response.body) throw new Error('Could not open the live AI analysis stream.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
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
      if (err?.name === 'AbortError' || stopped) return;
      activeJobId = null;
      scheduleDiscovery(1800);
    }
  }

  async function startAnalysis() {
    if (startRequested || stopped) return;
    startRequested = true;
    updateLiveStatus(`Starting AI analysis · 0/${failedIds.size} failed cases`, 'running');
    try {
      const response = await fetch('/api/test-results/analyze/start', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ sessionId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.reply || 'Could not start AI failure analysis.');
      if (data.analysisNeeded === false) {
        stopped = true;
        updateLiveStatus('No failed cases require AI analysis', 'done');
        return;
      }
      if (data.jobId && data.eventsUrl) {
        connect(data);
        return;
      }
      scheduleDiscovery(500);
    } catch (err) {
      startRequested = false;
      updateLiveStatus('Waiting to start AI analysis…', 'error');
      scheduleDiscovery(2500);
    }
  }

  async function discover() {
    if (stopped) return;
    try {
      const response = await fetch(`/api/test-results/analyze/current/${encodeURIComponent(sessionId)}`, {
        headers: authHeaders(),
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('Could not read AI analysis status.');
      const data = await response.json();
      applySnapshot(data);

      if (data.state === 'COMPLETED' || data.state === 'NOT_REQUIRED') {
        stopped = true;
        updateLiveStatus(data.state === 'COMPLETED' ? `AI analysis complete · ${analyses.size}/${failedIds.size} failed cases` : 'No AI analysis required', 'done');
        return;
      }
      if (data.state === 'FAILED') {
        activeJobId = null;
        startRequested = false;
        for (const id of failedIds) {
          if (!analyses.has(id)) setCell(id, errorHtml('The previous AI analysis job stopped before this case completed.'));
        }
        updateLiveStatus('AI analysis needs retry', 'error');
        scheduleDiscovery(5000);
        return;
      }
      if (data.jobId && data.eventsUrl) {
        startRequested = true;
        connect(data);
        return;
      }
      if (data.state === 'PENDING') {
        startAnalysis();
        return;
      }
      scheduleDiscovery(1500);
    } catch {
      scheduleDiscovery(2500);
    }
  }

  window.addEventListener('beforeunload', () => {
    stopped = true;
    clearTimeout(reconnectTimer);
    currentAbort?.abort?.();
  });

  for (const id of failedIds) setCell(id, waitingHtml());
  updateLiveStatus(`Preparing failed-only AI analysis · 0/${failedIds.size}`, 'running');
  discover();
})();

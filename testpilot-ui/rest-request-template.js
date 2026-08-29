(function () {
  const TOKEN_KEY = 'aiTestPilotToken';
  const SENSITIVE_HEADER = /^(authorization|proxy-authorization|x-api-key|api-key)$/i;
  const $ = (id) => document.getElementById(id);

  function authHeaders(extra = {}) {
    const token = sessionStorage.getItem(TOKEN_KEY) || '';
    return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
  }

  async function api(url, init = {}) {
    const response = await fetch(url, { ...init, headers: authHeaders(init.headers || {}) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.reply || `Request failed (${response.status})`);
    return data;
  }

  function parseObject(id, label) {
    const raw = String($(id)?.value || '').trim();
    if (!raw) return {};
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { throw new Error(`${label} must be valid JSON.`); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${label} must be a JSON object.`);
    return parsed;
  }

  function parseBody() {
    const raw = String($('manualBody')?.value || '').trim();
    if (!raw) return { supplied: false, value: null };
    try { return { supplied: true, value: JSON.parse(raw) }; }
    catch { throw new Error('Request body must be valid JSON.'); }
  }

  function validateHeaders(headers) {
    for (const name of Object.keys(headers)) {
      if (SENSITIVE_HEADER.test(name)) {
        throw new Error(`${name} is authentication-sensitive. Use Runtime authentication instead of saving it in the endpoint template.`);
      }
    }
  }

  function injectFields() {
    const button = $('addOperation');
    if (!button || $('manualHeaders')) return;
    const section = button.closest('.section');
    if (!section) return;

    const box = document.createElement('div');
    box.innerHTML = `
      <div class="field">
        <label>Headers (JSON)</label>
        <textarea id="manualHeaders" spellcheck="false" placeholder='{"Accept":"application/json","X-Tenant-Id":"tenant-01"}'></textarea>
        <div class="sub">Ordinary request headers only. Authorization/API-key secrets stay in Runtime authentication.</div>
      </div>
      <div class="two">
        <div class="field">
          <label>Query parameters (JSON)</label>
          <textarea id="manualQuery" spellcheck="false" placeholder='{"page":1,"pageSize":20}'></textarea>
        </div>
        <div class="field">
          <label>Path parameters (JSON)</label>
          <textarea id="manualPathParams" spellcheck="false" placeholder='{"id":"123"}'></textarea>
        </div>
      </div>
      <div class="field">
        <label>Request body (JSON)</label>
        <textarea id="manualBody" spellcheck="false" placeholder='{"name":"Example customer","email":"qa@example.com"}'></textarea>
        <div class="sub">This is the grounded baseline body. AI may vary it only when the requirement or schema supports that test scenario.</div>
      </div>`;
    section.insertBefore(box, button);

    const style = document.createElement('style');
    style.textContent = '#manualHeaders,#manualQuery,#manualPathParams,#manualBody{min-height:76px;font:10.5px Consolas,monospace}';
    document.head.appendChild(style);

    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const status = $('manualStatus');
      try {
        if (status) { status.textContent = 'Saving endpoint request template…'; status.className = 'status'; }
        const targetId = $('target')?.value || '';
        if (!targetId) throw new Error('Select or create a REST target first.');
        const method = $('manualMethod')?.value || 'GET';
        const path = String($('manualPath')?.value || '').trim();
        if (!path) throw new Error('Endpoint path is required.');
        const headers = parseObject('manualHeaders', 'Headers');
        const query = parseObject('manualQuery', 'Query parameters');
        const pathParams = parseObject('manualPathParams', 'Path parameters');
        validateHeaders(headers);
        const body = parseBody();
        const payload = {
          method,
          path,
          summary: String($('manualSummary')?.value || '').trim(),
          headers,
          query,
          pathParams,
        };
        if (body.supplied) payload.body = body.value;
        await api(`/api/rest-targets/${encodeURIComponent(targetId)}/operations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (status) { status.textContent = 'Endpoint and request template saved.'; status.className = 'status ok'; }
        ['manualPath','manualSummary','manualHeaders','manualQuery','manualPathParams','manualBody'].forEach((id) => { if ($(id)) $(id).value = ''; });
        $('target')?.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (err) {
        if (status) { status.textContent = err.message; status.className = 'status bad'; }
      }
    }, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectFields);
  else injectFields();
})();

(function () {
  if (window.__aiTestPilotRestIsolatedExecution) return;
  window.__aiTestPilotRestIsolatedExecution = true;

  const TOKEN_KEY = 'aiTestPilotToken';
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
  let activeSessionId = '';

  function authHeaders(extra = {}) {
    const token = sessionStorage.getItem(TOKEN_KEY) || '';
    return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
  }

  async function apiJson(url, init = {}) {
    const response = await fetch(url, { ...init, headers: authHeaders(init.headers || {}) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.reply || `Request failed (${response.status})`);
    return data;
  }

  function captureRestSessionId() {
    if (window.__aiTestPilotRestSessionCaptureInstalled) return;
    window.__aiTestPilotRestSessionCaptureInstalled = true;
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async function (input, init) {
      const url = typeof input === 'string' ? input : input?.url || '';
      const response = await nativeFetch(input, init);
      const match = String(url).match(/^\/api\/(?:rest-demo|rest)\/sessions\/([^/]+)\/generate(?:\?|$)/);
      if (match && response.ok) {
        try { activeSessionId = decodeURIComponent(match[1]); }
        catch { activeSessionId = match[1]; }
      }
      return response;
    };
  }

  function reviewedCases() {
    return [...document.querySelectorAll('[data-json]')].map((textarea) => {
      try { return JSON.parse(textarea.value); }
      catch { throw new Error('One edited REST test case contains invalid JSON.'); }
    });
  }

  function approvedIds(allCases) {
    return [...document.querySelectorAll('[data-case]:checked')]
      .map((checkbox) => allCases[Number(checkbox.dataset.case)]?.id)
      .filter(Boolean);
  }

  function runtimeAuth() {
    const type = String($('authType')?.value || 'NONE').toUpperCase();
    return {
      type,
      username: type === 'BASIC' ? String($('runtimeUser')?.value || '') : '',
      secret: type === 'NONE' ? '' : String($('runtimeSecret')?.value || ''),
      headerName: type === 'API_KEY_HEADER' ? String($('apiKeyHeader')?.value || '') : '',
    };
  }

  function setStatus(message, bad = false) {
    const status = $('generationStatus');
    if (!status) return;
    status.textContent = message;
    status.className = bad ? 'status bad' : 'status ok';
  }

  function renderProgress(progress) {
    const total = Number(progress?.total || 0);
    const completed = Number(progress?.completed || 0);
    const passed = Number(progress?.passed || 0);
    const failed = Number(progress?.failed || 0);
    if ($('mTotal')) $('mTotal').textContent = total;
    if ($('mPassed')) $('mPassed').textContent = passed;
    if ($('mFailed')) $('mFailed').textContent = failed;
    if ($('mRate')) $('mRate').textContent = completed ? `${Math.round((passed * 100) / completed)}%` : '—';
    if ($('runState')) $('runState').textContent = progress?.status === 'DONE' ? 'Complete' : `Running ${completed}/${total}`;

    const rows = Array.isArray(progress?.tests) ? progress.tests.map((test) =>
      `<div class="result"><span>${esc(test.testCaseId || '')} · ${esc(test.title || '')}${test.durationMs != null ? `<div class="sub">${esc(test.durationMs)} ms</div>` : ''}${test.err?.message ? `<div class="sub">${esc(test.err.message)}</div>` : ''}</span><span class="${test.pass ? 'pass' : 'fail'}">${test.pass ? 'PASS' : 'FAIL'}</span></div>`
    ).join('') : '';
    const remaining = Math.max(0, total - completed);
    if ($('results')) $('results').innerHTML = rows + (remaining ? `<div class="sub" style="padding:9px 0">${remaining} REST test${remaining === 1 ? '' : 's'} remaining…</div>` : '');
  }

  async function openStream(sessionId) {
    const response = await fetch(`/api/test-runs/events/${encodeURIComponent(sessionId)}`, {
      headers: authHeaders({ Accept: 'text/event-stream' }),
      cache: 'no-store',
    });
    if (!response.ok || !response.body) throw new Error(`Could not open execution stream (${response.status}).`);
    return response.body.getReader();
  }

  async function consumeStream(reader) {
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          if (!block || block.startsWith(':')) continue;
          let eventType = 'MESSAGE';
          const dataLines = [];
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) eventType = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
          }
          if (!dataLines.length) continue;
          let event;
          try { event = JSON.parse(dataLines.join('\n')); }
          catch { continue; }
          renderProgress(event);
          if (eventType === 'RUN_FAILED') throw new Error(event.error || 'REST execution failed.');
          if (eventType === 'RUN_COMPLETED') return event;
        }
      }
    } finally {
      try { await reader.cancel(); } catch {}
    }
    return null;
  }

  function renderFinal(summary) {
    const total = Number(summary?.total || 0);
    const passed = Number(summary?.passed || 0);
    const failed = Number(summary?.failed || 0);
    if ($('mTotal')) $('mTotal').textContent = total;
    if ($('mPassed')) $('mPassed').textContent = passed;
    if ($('mFailed')) $('mFailed').textContent = failed;
    if ($('mRate')) $('mRate').textContent = total ? `${Math.round((passed * 100) / total)}%` : '—';
    if ($('results')) $('results').innerHTML = (summary?.tests || []).map((test) =>
      `<div class="result"><span>${esc(test.testCaseId || '')} · ${esc(test.title || '')}${test.durationMs != null ? `<div class="sub">Duration: ${esc(test.durationMs)} ms</div>` : ''}${test.err?.message ? `<div class="sub">${esc(test.err.message)}</div>` : ''}</span><span class="${test.pass ? 'pass' : 'fail'}">${test.pass ? 'PASS' : 'FAIL'}</span></div>`
    ).join('') || '<div class="sub">No test results.</div>';
  }

  function installRunHandler() {
    const oldRun = $('run');
    if (!oldRun || oldRun.dataset.isolatedExecution === '1') return;
    const runButton = oldRun.cloneNode(true);
    runButton.dataset.isolatedExecution = '1';
    oldRun.replaceWith(runButton);

    runButton.addEventListener('click', async () => {
      let reader = null;
      runButton.disabled = true;
      if ($('analyze')) $('analyze').disabled = true;
      if ($('report')) $('report').classList.add('hidden');
      try {
        if (!activeSessionId) throw new Error('Generate REST test cases before execution.');
        const allCases = reviewedCases();
        const approved = approvedIds(allCases);
        if (!approved.length) throw new Error('Select at least one REST test.');

        setStatus('Starting isolated REST execution…');
        if ($('runState')) $('runState').textContent = 'Starting';
        if ($('results')) $('results').innerHTML = '<div class="sub">Opening one execution stream. REST tests will report one-by-one without visible browser pauses.</div>';

        reader = await openStream(activeSessionId);
        const started = await apiJson('/api/test-runs/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: activeSessionId,
            approvedIds: approved,
            reviewedTestCases: allCases,
            apiAuth: runtimeAuth(),
          }),
        });
        setStatus(`REST run #${started.runNumber} accepted · ${started.total} test(s) · isolated execution.`);
        await consumeStream(reader);
        reader = null;

        const result = await apiJson(`/api/test-runs/result/${encodeURIComponent(activeSessionId)}`, { cache: 'no-store' });
        renderFinal(result.summary);
        if ($('runState')) $('runState').textContent = 'Complete';
        if ($('analyze')) $('analyze').disabled = !(Number(result.summary?.failed || 0) > 0);
        if ($('report')) {
          $('report').href = result.reportUrl || `/api/reports/${encodeURIComponent(activeSessionId)}`;
          $('report').classList.remove('hidden');
        }
        setStatus(`REST run #${result.runNumber} complete: ${result.summary?.passed || 0} passed, ${result.summary?.failed || 0} failed.`);
      } catch (err) {
        if (reader) { try { await reader.cancel(); } catch {} }
        setStatus(err.message || 'REST execution failed.', true);
        if ($('runState')) $('runState').textContent = 'Failed';
      } finally {
        runButton.disabled = false;
      }
    });
  }

  function start() {
    captureRestSessionId();
    installRunHandler();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();

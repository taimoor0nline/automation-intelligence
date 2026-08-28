(function () {
  if (window.__aiTestPilotStableReadiness) return;
  window.__aiTestPilotStableReadiness = true;

  let readinessInFlight = false;
  let readinessTimer = null;
  let readinessPaused = false;
  let lastGenerationMeta = null;

  const DEFAULT_BATCH_SIZE = 2;
  const MAX_BATCH_SIZE = 50;
  const BATCH_SIZE_KEY = 'aiTestPilotReadinessBatchSize';
  const BATCH_TIMEOUT_MS = 12000;

  const credentialsPayload = () => ({
    username: document.getElementById('username')?.value || '',
    password: document.getElementById('password')?.value || '',
  });

  const readinessLabel = (status) => status === 'READY'
    ? 'Automation Ready'
    : status === 'NEEDS_PREFLIGHT'
      ? 'Checking readiness'
      : String(status || 'NEEDS_PREFLIGHT').replaceAll('_', ' ');

  const readinessClass = (status) => status === 'READY'
    ? 'ready'
    : status === 'NEEDS_PREFLIGHT'
      ? 'preflight'
      : 'blocked';

  function normalizeBatchSize(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return DEFAULT_BATCH_SIZE;
    return Math.max(1, Math.min(MAX_BATCH_SIZE, parsed));
  }

  function storedBatchSize() {
    try {
      const stored = sessionStorage.getItem(BATCH_SIZE_KEY);
      return stored == null ? DEFAULT_BATCH_SIZE : normalizeBatchSize(stored);
    } catch {
      return DEFAULT_BATCH_SIZE;
    }
  }

  function currentBatchSize() {
    return normalizeBatchSize(document.getElementById('readinessBatchSize')?.value || storedBatchSize());
  }

  function lockRun(message) {
    const runBtn = document.getElementById('runBtn');
    const runHint = document.getElementById('runHint');
    if (runBtn) runBtn.disabled = true;
    if (runHint && message) runHint.textContent = message;
  }

  function ensureControls() {
    const passwordField = document.getElementById('password')?.closest('.field');
    if (!passwordField) return;

    let anchor = passwordField;

    if (!document.getElementById('aiModelTier')) {
      const quality = document.createElement('div');
      quality.className = 'field';
      quality.innerHTML = '<label>AI quality profile</label><select id="aiModelTier"><option value="fast">Fast</option><option value="balanced">Balanced</option><option value="strong">Strong</option></select><small>Fast prioritizes response time. Balanced and Strong use progressively more capable server-side models configured on the server.</small>';
      anchor.insertAdjacentElement('afterend', quality);
      anchor = quality;
      document.getElementById('aiModelTier').value = 'fast';
    } else {
      anchor = document.getElementById('aiModelTier').closest('.field') || anchor;
    }

    if (!document.getElementById('bypassDiscoveryCache')) {
      const discovery = document.createElement('div');
      discovery.className = 'field';
      discovery.innerHTML = '<label style="font-weight:600"><input id="bypassDiscoveryCache" type="checkbox" style="width:auto;margin:0 6px 0 0">Fresh page discovery</label><small>Ignore cached discovery data for the next generation.</small>';
      anchor.insertAdjacentElement('afterend', discovery);
      anchor = discovery;
    } else {
      anchor = document.getElementById('bypassDiscoveryCache').closest('.field') || anchor;
    }

    if (!document.getElementById('readinessBatchSize')) {
      const batch = document.createElement('div');
      batch.className = 'field';
      batch.innerHTML = '<label for="readinessBatchSize">Readiness validation batch size</label><input id="readinessBatchSize" type="number" min="1" max="50" step="1" value="2" inputmode="numeric"><small>Number of test cases processed by each deterministic readiness request. Default: 2.</small>';
      anchor.insertAdjacentElement('afterend', batch);
    }

    const input = document.getElementById('readinessBatchSize');
    if (input) {
      input.value = String(storedBatchSize());
      if (input.dataset.bound !== '1') {
        input.dataset.bound = '1';
        input.addEventListener('change', () => {
          const value = normalizeBatchSize(input.value);
          input.value = String(value);
          try { sessionStorage.setItem(BATCH_SIZE_KEY, String(value)); } catch {}
        });
      }
    }
  }

  async function withTimeout(promiseFactory) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BATCH_TIMEOUT_MS);
    try {
      return await promiseFactory(controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  function mergeCases(updatedCases) {
    const byId = new Map((updatedCases || []).map((tc) => [String(tc?.id || '').toUpperCase(), tc]));
    testCases = testCases.map((current) => {
      const updated = byId.get(String(current?.id || '').toUpperCase());
      return updated ? { ...current, ...updated } : current;
    });
  }

  async function validateBatch(batch, batchIndex, batchCount) {
    return withTimeout(async (signal) => {
      const response = await fetch('/api/test-cases/revalidate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          sessionId,
          testCases: batch,
          credentials: credentialsPayload(),
          batchIndex,
          batchCount,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.reply || `Readiness batch ${batchIndex + 1}/${batchCount} failed.`);
      if (!Array.isArray(data.testCases)) throw new Error('Readiness response did not contain test cases.');
      return data.testCases;
    });
  }

  async function refreshReadiness() {
    if (!sessionId || !Array.isArray(testCases) || !testCases.length || readinessInFlight) return;

    const pending = testCases.filter((tc) => !tc.automationReadiness);
    if (!pending.length) {
      renderCases();
      return;
    }

    readinessInFlight = true;
    readinessPaused = false;
    clearTimeout(readinessTimer);
    readinessTimer = null;

    const input = document.getElementById('readinessBatchSize');
    if (input) input.disabled = true;

    const batchSize = currentBatchSize();
    const batches = [];
    for (let i = 0; i < pending.length; i += batchSize) batches.push(pending.slice(i, i + batchSize));

    let completed = 0;
    try {
      for (let i = 0; i < batches.length; i += 1) {
        lockRun(`Checking automation readiness ${completed}/${pending.length} · batch ${i + 1}/${batches.length}`);
        const assessed = await validateBatch(batches[i], i, batches.length);
        mergeCases(assessed);
        completed += assessed.length;
        renderCases();
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } catch (err) {
      readinessPaused = true;
      const message = err?.name === 'AbortError'
        ? `Readiness validation timed out after ${Math.round(BATCH_TIMEOUT_MS / 1000)} seconds for one batch. ${completed}/${pending.length} case(s) were validated.`
        : `Readiness validation paused after ${completed}/${pending.length} case(s). ${err.message || ''}`;
      console.warn('[readiness] validation paused', err);
      lockRun(message);
      if (typeof showError === 'function') showError(message);
    } finally {
      readinessInFlight = false;
      if (input) input.disabled = false;
      renderCases();
    }
  }

  function scheduleReadiness(delayMs = 500) {
    if (readinessInFlight) return;
    clearTimeout(readinessTimer);
    readinessTimer = setTimeout(() => {
      readinessTimer = null;
      refreshReadiness();
    }, delayMs);
  }

  window.refreshTestReadiness = function () {
    readinessPaused = false;
    testCases = testCases.map((tc) => ({ ...tc, automationReadiness: null }));
    renderCases();
    scheduleReadiness(50);
  };

  const baseRenderCases = window.renderCases || renderCases;

  window.renderCases = renderCases = function () {
    const count = document.getElementById('caseCount');
    const addCaseBtn = document.getElementById('addCaseBtn');
    const container = document.getElementById('cases');
    const runBtn = document.getElementById('runBtn');
    const runHint = document.getElementById('runHint');

    if (count) count.textContent = Array.isArray(testCases) ? testCases.length : 0;
    if (addCaseBtn) addCaseBtn.disabled = !sessionId || readinessInFlight;

    if (!Array.isArray(testCases) || !testCases.length) {
      if (container) container.innerHTML = '<div class="empty">No test cases returned.</div>';
      if (runBtn) runBtn.disabled = true;
      return;
    }

    let ready = 0;
    let blocked = 0;
    let pending = 0;

    container.innerHTML = testCases.map((tc, i) => {
      const expected = (tc.expectedResults || []).slice(0, 2).join(' · ');
      const source = String(tc.source || 'ai').toLowerCase();
      const type = String(tc.type || 'functional').toLowerCase();
      const allowedTypes = new Set(['negative', 'positive', 'functional', 'boundary', 'custom']);
      const typeClass = allowedTypes.has(type) ? `type-${type}` : 'type-functional';
      const readiness = tc.automationReadiness || null;
      const status = readiness?.status || 'NEEDS_PREFLIGHT';
      const isReady = status === 'READY';
      const isPending = !readiness || status === 'NEEDS_PREFLIGHT';
      if (isReady) ready += 1;
      else if (isPending) pending += 1;
      else blocked += 1;

      const cls = readinessClass(status);
      const label = readinessLabel(status);
      const reason = readiness?.reason || 'Waiting for deterministic readiness validation.';
      const reasonCode = readiness?.reasonCode || '';
      const resolution = readiness?.resolutionType || '';
      const sourceLabel = source === 'human' ? 'Human' : source === 'ai-on-demand' ? 'AI · On-demand' : source === 'ai-repaired' ? 'AI · Repaired' : 'AI / Reviewed';
      const selectable = isReady && !readinessInFlight;

      let actions = '';
      if (resolution === 'AI_REPAIRABLE') actions += `<button class="btn ghost" type="button" onclick="repairCaseWithAI(${i})">Fix with AI</button>`;
      if (resolution === 'USER_INPUT_REQUIRED') actions += `<button class="btn ghost" type="button" onclick="focusRequiredInput(${i})">Provide required input</button>`;

      return `<div class="case ${typeClass}">
        <input class="case-check" type="checkbox" value="${escapeHtml(tc.id)}" ${selectable ? 'checked' : ''} ${selectable ? '' : 'disabled'}>
        <div>
          <div class="case-title">${escapeHtml(tc.id)} — ${escapeHtml(tc.title)}</div>
          <div class="case-meta">
            <span class="tag ${typeClass}">${escapeHtml(type)}</span>
            <span class="tag">${escapeHtml(tc.priority || 'medium')}</span>
            <span class="tag ${source === 'human' ? 'human' : ''}">${escapeHtml(sourceLabel)}</span>
            <span class="tag ${cls}">${escapeHtml(label)}</span>
            <span>${(tc.steps || []).length} steps</span>
          </div>
          ${expected ? `<div class="expected">Expected: ${escapeHtml(expected)}</div>` : ''}
          <div class="readiness ${cls}"><b>${escapeHtml(label)}</b> — ${escapeHtml(reason)}${reasonCode ? `<span class="readiness-code">Reason: ${escapeHtml(reasonCode)} · Resolution: ${escapeHtml(resolution || 'NONE')}</span>` : ''}${actions ? `<div class="readiness-actions">${actions}</div>` : ''}</div>
        </div>
        <div class="case-actions"><button class="btn ghost" ${readinessInFlight ? 'disabled' : ''} onclick="openEditor(${i})">Edit</button><button class="btn ghost danger" ${readinessInFlight ? 'disabled' : ''} onclick="deleteCase(${i})">Delete</button></div>
      </div>`;
    }).join('');

    if (readinessInFlight) {
      lockRun(`Checking automation readiness · ${ready}/${testCases.length} ready`);
    } else if (pending > 0) {
      lockRun(`${pending} case(s) checking readiness · Run Approved Tests locked`);
      if (!readinessPaused) scheduleReadiness(500);
    } else {
      if (runHint) runHint.textContent = `${ready} Automation Ready · ${blocked} action/manual`;
      if (runBtn) runBtn.disabled = ready === 0;
    }
  };

  window.focusRequiredInput = function (index) {
    const readiness = testCases[index]?.automationReadiness;
    const required = readiness?.requiredInputs || [];
    if (required.includes('username')) document.getElementById('username')?.focus();
    else if (required.includes('password')) document.getElementById('password')?.focus();
    if (typeof showError === 'function') showError(readiness?.reason || 'Provide the required execution input.');
  };

  window.repairCaseWithAI = async function (index) {
    const tc = testCases[index];
    if (!tc || readinessInFlight) return;
    try {
      const response = await fetch('/api/test-cases/repair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, testCase: tc, credentials: credentialsPayload() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.reply || 'The test case could not be repaired safely.');
      if (data.testCase) {
        testCases[index] = data.testCase;
        renderCases();
      }
    } catch (err) {
      if (typeof showError === 'function') showError(err.message);
    }
  };

  ['username', 'password'].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', () => {
      if (!sessionId || !Array.isArray(testCases) || !testCases.length || readinessInFlight) return;
      readinessPaused = false;
      testCases = testCases.map((tc) => ({ ...tc, automationReadiness: null }));
      renderCases();
      scheduleReadiness(350);
    });
  });

  ensureControls();
})();

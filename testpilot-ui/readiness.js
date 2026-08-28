(function () {
  let readinessRefreshInFlight = false;
  let readinessTimer = null;
  let pendingGeneratedCase = null;
  let lastGenerationMeta = null;
  let readinessPaused = false;

  const DEFAULT_BATCH_SIZE = 2;
  const MAX_BATCH_SIZE = 50;
  const BATCH_SIZE_KEY = 'aiTestPilotReadinessBatchSize';
  const BATCH_TIMEOUT_MS = 12000;

  const credentialsPayload = () => ({ username: $('username').value, password: $('password').value });
  const readinessLabel = (status) => status === 'READY' ? 'Automation Ready' : status === 'NEEDS_PREFLIGHT' ? 'Checking readiness' : String(status || 'NEEDS_PREFLIGHT').replaceAll('_', ' ');
  const readinessClass = (status) => status === 'READY' ? 'ready' : status === 'NEEDS_PREFLIGHT' ? 'preflight' : 'blocked';

  function normalizeBatchSize(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return DEFAULT_BATCH_SIZE;
    return Math.max(1, Math.min(MAX_BATCH_SIZE, parsed));
  }

  function storedBatchSize() {
    try { return normalizeBatchSize(sessionStorage.getItem(BATCH_SIZE_KEY)); }
    catch { return DEFAULT_BATCH_SIZE; }
  }

  function currentBatchSize() {
    return normalizeBatchSize($('readinessBatchSize')?.value || storedBatchSize());
  }

  function lockRunForReadiness(message = 'Automation readiness is being checked. Run Approved Tests will unlock after validation completes.') {
    const runBtn = $('runBtn');
    if (runBtn) runBtn.disabled = true;
    const hint = $('runHint');
    if (hint) hint.textContent = message;
  }

  function removeReadinessRetryButton() {
    document.getElementById('retryReadinessBtn')?.remove();
  }

  function ensureReadinessRetryButton() {
    if (document.getElementById('retryReadinessBtn')) return;
    const hint = $('runHint');
    if (!hint?.parentElement) return;
    const button = document.createElement('button');
    button.id = 'retryReadinessBtn';
    button.type = 'button';
    button.className = 'btn ghost';
    button.style.marginLeft = '8px';
    button.textContent = 'Retry readiness';
    button.addEventListener('click', () => {
      readinessPaused = false;
      removeReadinessRetryButton();
      refreshReadiness();
    });
    hint.insertAdjacentElement('afterend', button);
  }

  // Add provider-neutral AI quality controls and readiness batch size in Section 1.
  const passwordField = $('password')?.closest('.field');
  if (passwordField && !$('aiModelTier')) {
    const controls = document.createElement('div');
    controls.innerHTML = '<div class="field"><label>AI quality profile</label><select id="aiModelTier"><option value="fast">Fast</option><option value="balanced">Balanced</option><option value="strong">Strong</option></select><small>Fast prioritizes response time. Balanced and Strong use progressively more capable server-side models configured in .env.</small></div><div class="field" style="margin-top:9px"><label style="font-weight:600"><input id="bypassDiscoveryCache" type="checkbox" style="width:auto;margin:0 6px 0 0">Fresh page discovery</label><small>Enable this to ignore the in-memory discovery cache for this generation.</small></div><div class="field" style="margin-top:9px"><label for="readinessBatchSize">Readiness validation batch size</label><input id="readinessBatchSize" type="number" min="1" max="50" step="1" value="2" inputmode="numeric"><small>Number of test cases validated in each deterministic readiness request. Default: 2.</small></div>';
    passwordField.insertAdjacentElement('afterend', controls);
    if ($('aiModelTier')) $('aiModelTier').value = 'strong';
    if ($('readinessBatchSize')) {
      $('readinessBatchSize').value = String(storedBatchSize());
      $('readinessBatchSize').addEventListener('change', () => {
        const value = currentBatchSize();
        $('readinessBatchSize').value = String(value);
        try { sessionStorage.setItem(BATCH_SIZE_KEY, String(value)); } catch {}
      });
    }
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input?.url;
    let nextInit = init;
    let initialGeneration = false;
    if (url === '/api/chat' && init?.method === 'POST' && typeof init.body === 'string') {
      try {
        const payload = JSON.parse(init.body);
        initialGeneration = payload.message !== 'approve reviewed cases';
        if (initialGeneration) {
          payload.aiModelTier = $('aiModelTier')?.value || 'strong';
          payload.bypassDiscoveryCache = Boolean($('bypassDiscoveryCache')?.checked);
        }
        nextInit = { ...init, body: JSON.stringify(payload) };
      } catch {}
    }

    const response = await nativeFetch(input, nextInit);
    if (initialGeneration) {
      response.clone().json().then((data) => {
        if (data?.generationTiming) lastGenerationMeta = data.generationTiming;
      }).catch(() => {});
    }
    return response;
  };

  function mergeReadinessBatch(assessedCases) {
    const byId = new Map((assessedCases || []).map((tc) => [String(tc?.id || '').toUpperCase(), tc]));
    testCases = testCases.map((current) => {
      const assessed = byId.get(String(current?.id || '').toUpperCase());
      return assessed ? { ...current, ...assessed, automationReadiness: assessed.automationReadiness } : current;
    });
  }

  async function validateReadinessBatch(batch, batchIndex, batchCount) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), BATCH_TIMEOUT_MS);
    try {
      const response = await nativeFetch('/api/test-cases/revalidate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          sessionId,
          testCases: batch,
          credentials: credentialsPayload(),
          batchIndex,
          batchCount,
        }),
      });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.testCases)) throw new Error(data.reply || `Readiness batch ${batchIndex + 1}/${batchCount} failed.`);
      return data.testCases;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function refreshReadiness() {
    if (!sessionId || !testCases.length || readinessRefreshInFlight || readinessPaused) return;
    readinessRefreshInFlight = true;
    removeReadinessRetryButton();
    clearTimeout(readinessTimer);
    readinessTimer = null;

    const pending = testCases.filter((tc) => !tc.automationReadiness);
    const candidates = pending.length ? pending : [...testCases];
    const batchSize = currentBatchSize();
    const batches = [];
    for (let i = 0; i < candidates.length; i += batchSize) batches.push(candidates.slice(i, i + batchSize));

    lockRunForReadiness(`Checking automation readiness 0/${candidates.length} · batch size ${batchSize}`);
    if ($('readinessBatchSize')) $('readinessBatchSize').disabled = true;

    let completed = 0;
    try {
      for (let index = 0; index < batches.length; index += 1) {
        lockRunForReadiness(`Checking automation readiness ${completed}/${candidates.length} · batch ${index + 1}/${batches.length} · ${batchSize} at a time`);
        const assessed = await validateReadinessBatch(batches[index], index, batches.length);
        mergeReadinessBatch(assessed);
        completed += assessed.length;
        renderCases();
        lockRunForReadiness(`Checking automation readiness ${completed}/${candidates.length} · batch ${index + 1}/${batches.length}`);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      readinessPaused = false;
    } catch (err) {
      readinessPaused = true;
      const message = err?.name === 'AbortError'
        ? `Readiness validation paused because a batch exceeded ${Math.round(BATCH_TIMEOUT_MS / 1000)} seconds. ${completed}/${candidates.length} case(s) were validated.`
        : `Readiness validation paused. ${completed}/${candidates.length} case(s) were validated. ${err.message || ''}`;
      console.warn('[readiness] batch validation failed', err);
      lockRunForReadiness(message);
      showError(message);
      ensureReadinessRetryButton();
    } finally {
      readinessRefreshInFlight = false;
      if ($('readinessBatchSize')) $('readinessBatchSize').disabled = false;
      renderCases();
    }
  }

  function scheduleReadiness(delayMs = 180) {
    if (readinessRefreshInFlight || readinessPaused) return;
    clearTimeout(readinessTimer);
    lockRunForReadiness();
    readinessTimer = setTimeout(refreshReadiness, delayMs);
  }

  window.refreshTestReadiness = function () {
    readinessPaused = false;
    removeReadinessRetryButton();
    return refreshReadiness();
  };

  renderCases = function () {
    $('caseCount').textContent = testCases.length;
    $('addCaseBtn').disabled = !sessionId || readinessRefreshInFlight;
    if (!testCases.length) {
      $('cases').innerHTML = '<div class="empty">No test cases returned.</div>';
      lockRunForReadiness('Generate test cases before running automation.');
      return;
    }

    let ready = 0, blocked = 0, preflight = 0, needsRefresh = false;
    $('cases').innerHTML = testCases.map((tc, i) => {
      const expected = (tc.expectedResults || []).slice(0, 2).join(' · ');
      const source = (tc.source || 'ai').toLowerCase();
      const type = (tc.type || 'functional').toLowerCase();
      const allowedTypes = new Set(['negative', 'positive', 'functional', 'boundary', 'custom']);
      const typeClass = allowedTypes.has(type) ? 'type-' + type : 'type-functional';
      const readiness = tc.automationReadiness || null;
      const status = readiness?.status || 'NEEDS_PREFLIGHT';
      if (!readiness) needsRefresh = true;
      const isReady = status === 'READY';
      const isPreflight = status === 'NEEDS_PREFLIGHT';
      if (isReady) ready++; else if (isPreflight) preflight++; else blocked++;
      const cls = readinessClass(status);
      const label = readinessLabel(status);
      const reason = readiness?.reason || (isPreflight ? 'The automation system is validating this test against discovered application evidence and compiling its deterministic automation plan.' : '');
      const reasonCode = readiness?.reasonCode || '';
      const resolution = readiness?.resolutionType || '';
      const selectable = isReady && !readinessRefreshInFlight;
      const checked = selectable ? 'checked' : '';
      const disabled = selectable ? '' : 'disabled';
      let actions = '';
      if (resolution === 'AI_REPAIRABLE') actions += '<button class="btn ghost" type="button" onclick="repairCaseWithAI(' + i + ')">Fix with AI</button>';
      else if (resolution === 'USER_INPUT_REQUIRED') actions += '<button class="btn ghost" type="button" onclick="focusRequiredInput(' + i + ')">Provide required input</button>';
      if (readiness?.canSuggestAssertion) actions += '<button class="btn ghost" type="button" onclick="suggestAssertionWithAI(' + i + ')">Suggest assertion with AI</button>';
      const sourceLabel = source === 'human' ? 'Human' : source === 'ai-on-demand' ? 'AI · On-demand' : source === 'ai-repaired' ? 'AI · Repaired' : 'AI / Reviewed';
      const actionDisabled = readinessRefreshInFlight ? ' disabled aria-disabled="true"' : '';

      return '<div class="case ' + typeClass + '">' +
        '<input class="case-check" type="checkbox" value="' + escapeHtml(tc.id) + '" ' + checked + ' ' + disabled + '>' +
        '<div><div class="case-title">' + escapeHtml(tc.id) + ' — ' + escapeHtml(tc.title) + '</div>' +
        '<div class="case-meta"><span class="tag ' + typeClass + '">' + escapeHtml(type) + '</span><span class="tag">' + escapeHtml(tc.priority || 'medium') + '</span><span class="tag ' + (source === 'human' ? 'human' : '') + '">' + escapeHtml(sourceLabel) + '</span><span class="tag ' + cls + '">' + escapeHtml(label) + '</span><span>' + ((tc.steps || []).length) + ' steps</span></div>' +
        (expected ? '<div class="expected">Expected: ' + escapeHtml(expected) + '</div>' : '') +
        '<div class="readiness ' + cls + '"><b>' + escapeHtml(label) + '</b> — ' + escapeHtml(reason) +
        (reasonCode ? '<span class="readiness-code">Reason: ' + escapeHtml(reasonCode) + ' · Resolution: ' + escapeHtml(resolution || 'NONE') + '</span>' : '') +
        (actions ? '<div class="readiness-actions">' + actions + '</div>' : '') + '</div></div>' +
        '<div class="case-actions"><button class="btn ghost"' + actionDisabled + ' onclick="openEditor(' + i + ')">Edit</button><button class="btn ghost danger"' + actionDisabled + ' onclick="deleteCase(' + i + ')">Delete</button></div></div>';
    }).join('');

    if (readinessRefreshInFlight) {
      lockRunForReadiness('Automation readiness is being validated in batches · review controls locked');
    } else if (readinessPaused) {
      lockRunForReadiness('Readiness validation is paused · use Retry readiness to continue');
    } else if (preflight > 0 || needsRefresh) {
      lockRunForReadiness(preflight + ' case(s) checking readiness · Run Approved Tests locked');
    } else {
      $('runHint').textContent = ready + ' Automation Ready · ' + blocked + ' action/manual';
      $('runBtn').disabled = ready === 0;
    }

    if (needsRefresh && !readinessRefreshInFlight && !readinessPaused) {
      setTimeout(() => {
        const cacheText = lastGenerationMeta?.discoveryCacheBypassed ? ' · fresh discovery' : lastGenerationMeta?.discoveryCacheHit ? ' · discovery cache used' : '';
        $('caseSubtitle').textContent = 'AI test cases generated · applying automation readiness checks…' + cacheText;
      }, 0);
      scheduleReadiness(500);
    } else if (!readinessRefreshInFlight && !readinessPaused && !needsRefresh) {
      setTimeout(() => {
        const profile = $('aiModelTier')?.selectedOptions?.[0]?.textContent || 'Strong';
        const timing = lastGenerationMeta?.totalMs ? ' · generated in ' + (lastGenerationMeta.totalMs / 1000).toFixed(1) + 's' : '';
        $('caseSubtitle').textContent = profile + ' AI profile · automation readiness completed' + timing;
      }, 0);
    }
  };

  window.focusRequiredInput = function (index) {
    const r = testCases[index]?.automationReadiness;
    const required = r?.requiredInputs || [];
    if (required.includes('username')) $('username').focus();
    else if (required.includes('password')) $('password').focus();
    showError(r?.reason || 'Provide the required execution input and the test will be revalidated automatically.');
  };

  window.repairCaseWithAI = async function (index) {
    const tc = testCases[index];
    if (!tc) return;
    clearError();
    lockRunForReadiness('AI repair in progress. Readiness will be rechecked before execution.');
    const button = document.querySelector('.case:nth-child(' + (index + 1) + ') .readiness-actions button');
    if (button) { button.disabled = true; button.textContent = 'Repairing…'; }
    try {
      const r = await fetch('/api/test-cases/repair', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, testCase: tc, credentials: credentialsPayload() })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.reply || 'The test case could not be repaired safely.');
      if (data.testCase) { testCases[index] = data.testCase; renderCases(); }
    } catch (err) { showError(err.message); renderCases(); }
  };

  window.suggestAssertionWithAI = async function (index) {
    const tc = testCases[index];
    if (!tc) return;
    clearError();
    const buttons = document.querySelectorAll('.case:nth-child(' + (index + 1) + ') .readiness-actions button');
    const button = Array.from(buttons).find((item) => item.textContent.includes('Suggest assertion'));
    if (button) { button.disabled = true; button.textContent = 'Thinking…'; }
    try {
      const r = await fetch('/api/test-cases/assertion-suggestion', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, testCase: tc, credentials: credentialsPayload() })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.reply || 'AI could not suggest an assertion capability.');
      const s = data.suggestion || {};
      const dependency = s.dependency ? ' Dependency: ' + s.dependency + '.' : '';
      showError('AI assertion suggestion — ' + (s.kind || 'REVIEW') + (s.operation ? ' · ' + s.operation : '') + ': ' + (s.rationale || '') + ' Cypress approach: ' + (s.cypressStrategy || '') + dependency);
    } catch (err) {
      showError(err.message);
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Suggest assertion with AI'; }
    }
  };

  ['username', 'password'].forEach((id) => $(id).addEventListener('input', () => {
    if (sessionId && testCases.length) {
      readinessPaused = false;
      removeReadinessRetryButton();
      testCases = testCases.map((tc) => ({ ...tc, automationReadiness: null }));
      lockRunForReadiness('Execution inputs changed · rechecking automation readiness…');
      scheduleReadiness(350);
    }
  }));

  const modalCard = $('editorModal')?.querySelector('.modal-card');
  if (modalCard && !$('editorReadiness')) {
    const box = document.createElement('div');
    box.id = 'editorReadiness';
    box.className = 'editor-readiness';
    box.innerHTML = '<strong>Automation readiness</strong><div>Save or validate this test case to see its deterministic readiness result.</div>';
    modalCard.querySelector('.section-head')?.insertAdjacentElement('afterend', box);
  }
  if (modalCard && !$('editorAiGenerator')) {
    const aiBox = document.createElement('div');
    aiBox.id = 'editorAiGenerator';
    aiBox.className = 'editor-ai-generator';
    aiBox.style.display = 'none';
    aiBox.innerHTML = '<div class="title">Generate this test case with AI</div><div class="note">Describe one specific scenario. AI will propose one grounded test case inside this editor; nothing is added until you review it and click Save Test Case.</div><textarea id="editorAiPrompt" placeholder="Example: Test login with an empty password and verify the required-field validation."></textarea><div class="actions"><button id="editorAiGenerateBtn" class="btn secondary" type="button">Generate</button><span id="editorAiStatus" class="status"></span></div>';
    $('editorReadiness')?.insertAdjacentElement('afterend', aiBox);
  }

  function showEditorReadiness(index, candidate = null) {
    const box = $('editorReadiness');
    if (!box) return;
    const tc = candidate || (index >= 0 ? testCases[index] : null);
    const r = tc?.automationReadiness;
    const history = tc?.repairHistory || [];
    if (!r) {
      box.innerHTML = '<strong>Checking required</strong><div>This new or edited test must pass deterministic automation readiness before it can be selected for execution.</div>';
      return;
    }
    const historyHtml = history.length ? '<div class="history"><b>Repair history</b><br>' + history.map((x) => 'Attempt ' + escapeHtml(x.attempt) + ': ' + escapeHtml(x.reasonCode || x.originalStatus) + ' → ' + escapeHtml(x.result || 'review')).join('<br>') + '</div>' : '';
    const suggestionHtml = r.canSuggestAssertion ? '<div><b>Assertion coverage:</b> One or more expectations can be strengthened through an AI assertion suggestion.</div>' : '';
    box.innerHTML = '<strong>' + escapeHtml(readinessLabel(r.status)) + '</strong><div><b>Reason code:</b> ' + escapeHtml(r.reasonCode || '—') + '</div><div><b>Reason:</b> ' + escapeHtml(r.reason || '—') + '</div><div><b>Resolution:</b> ' + escapeHtml(r.resolutionType || 'NONE') + '</div><div><b>Validation:</b> Deterministic automation-system check</div>' + suggestionHtml + historyHtml;
  }

  function fillEditorFromCandidate(tc) {
    $('editId').value = tc.id || $('editId').value;
    $('editTitle').value = tc.title || '';
    $('editType').value = tc.type || 'functional';
    $('editPriority').value = tc.priority || 'medium';
    $('editPreconditions').value = (tc.preconditions || []).join('\n');
    $('editSteps').value = (tc.steps || []).map(stepToLine).join('\n');
    $('editExpected').value = (tc.expectedResults || []).join('\n');
    updateTypeHelp();
    showEditorReadiness(-1, tc);
  }

  const originalOpenEditor = window.openEditor;
  window.openEditor = function (index) {
    originalOpenEditor(index);
    pendingGeneratedCase = null;
    showEditorReadiness(index);
    const generator = $('editorAiGenerator');
    if (generator) {
      generator.style.display = index < 0 ? 'block' : 'none';
      if (index < 0) {
        $('editorAiPrompt').value = '';
        $('editorAiStatus').textContent = '';
        $('editorAiGenerateBtn').textContent = 'Generate';
      }
    }
  };
  openEditor = window.openEditor;

  $('editorAiGenerateBtn')?.addEventListener('click', async () => {
    const request = $('editorAiPrompt').value.trim();
    if (!request) {
      $('editorAiStatus').className = 'status bad';
      $('editorAiStatus').textContent = 'Describe the test case first.';
      return;
    }
    const btn = $('editorAiGenerateBtn');
    btn.disabled = true;
    btn.textContent = pendingGeneratedCase ? 'Regenerating…' : 'Generating…';
    $('editorAiStatus').className = 'status';
    $('editorAiStatus').textContent = 'Generating a candidate from the current story and discovered application…';
    try {
      const requestedId = $('editId').value || null;
      const r = await fetch('/api/test-cases/generate-one', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, requestText: request, testCases, credentials: credentialsPayload(), requestedId })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.reply || 'The requested test case could not be generated.');
      pendingGeneratedCase = data.testCase;
      fillEditorFromCandidate(data.testCase);
      $('editorAiStatus').className = 'status ok';
      $('editorAiStatus').textContent = 'Candidate generated. Review or modify it, then click Save Test Case.';
      btn.textContent = 'Regenerate';
    } catch (err) {
      $('editorAiStatus').className = 'status bad';
      $('editorAiStatus').textContent = err.message;
      btn.textContent = pendingGeneratedCase ? 'Regenerate' : 'Generate';
    } finally { btn.disabled = false; }
  });

  $('saveEditorBtn').addEventListener('click', () => {
    const generated = pendingGeneratedCase;
    const savedId = $('editId').value;
    readinessPaused = false;
    removeReadinessRetryButton();
    lockRunForReadiness('Test case changed · rechecking automation readiness…');
    setTimeout(() => {
      if (generated) {
        const index = testCases.findIndex((tc) => tc.id === savedId);
        if (index >= 0) {
          testCases[index].source = 'ai-on-demand';
          testCases[index].createdBy = 'human-request';
          testCases[index].repairHistory = generated.repairHistory || [];
          testCases[index].automationReadiness = null;
        }
        pendingGeneratedCase = null;
      }
      scheduleReadiness(350);
    }, 40);
  });
})();
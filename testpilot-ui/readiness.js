(function () {
  let readinessRefreshInFlight = false;
  let readinessTimer = null;
  let pendingGeneratedCase = null;

  const credentialsPayload = () => ({ username: $('username').value, password: $('password').value });
  const readinessLabel = (status) => status === 'READY' ? 'Automation Ready' : status === 'NEEDS_PREFLIGHT' ? 'Checking readiness' : String(status || 'NEEDS_PREFLIGHT').replaceAll('_', ' ');
  const readinessClass = (status) => status === 'READY' ? 'ready' : status === 'NEEDS_PREFLIGHT' ? 'preflight' : 'blocked';

  async function refreshReadiness() {
    if (!sessionId || !testCases.length || readinessRefreshInFlight) return;
    readinessRefreshInFlight = true;
    try {
      const r = await fetch('/api/test-cases/revalidate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, testCases, credentials: credentialsPayload() })
      });
      const data = await r.json();
      if (r.ok && Array.isArray(data.testCases)) {
        testCases = data.testCases;
        renderCases();
      }
    } catch (err) {
      console.warn('[readiness] refresh failed', err);
    } finally {
      readinessRefreshInFlight = false;
    }
  }

  function scheduleReadiness() {
    clearTimeout(readinessTimer);
    readinessTimer = setTimeout(refreshReadiness, 180);
  }

  window.refreshTestReadiness = refreshReadiness;

  renderCases = function () {
    $('caseCount').textContent = testCases.length;
    $('addCaseBtn').disabled = !sessionId;
    if (!testCases.length) {
      $('cases').innerHTML = '<div class="empty">No test cases returned.</div>';
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
      const reason = readiness?.reason || (isPreflight ? 'The automation system is checking this test against discovered application evidence and supported capabilities.' : '');
      const reasonCode = readiness?.reasonCode || '';
      const resolution = readiness?.resolutionType || '';
      const checked = isReady || isPreflight ? 'checked' : '';
      const disabled = !isReady && !isPreflight ? 'disabled' : '';
      let actions = '';
      if (resolution === 'AI_REPAIRABLE') actions = '<button class="btn ghost" type="button" onclick="repairCaseWithAI(' + i + ')">Fix with AI</button>';
      else if (resolution === 'USER_INPUT_REQUIRED') actions = '<button class="btn ghost" type="button" onclick="focusRequiredInput(' + i + ')">Provide required input</button>';
      const sourceLabel = source === 'human' ? 'Human' : source === 'ai-on-demand' ? 'AI · On-demand' : source === 'ai-repaired' ? 'AI · Repaired' : 'AI / Reviewed';

      return '<div class="case ' + typeClass + '">' +
        '<input class="case-check" type="checkbox" value="' + escapeHtml(tc.id) + '" ' + checked + ' ' + disabled + '>' +
        '<div><div class="case-title">' + escapeHtml(tc.id) + ' — ' + escapeHtml(tc.title) + '</div>' +
        '<div class="case-meta"><span class="tag ' + typeClass + '">' + escapeHtml(type) + '</span><span class="tag">' + escapeHtml(tc.priority || 'medium') + '</span><span class="tag ' + (source === 'human' ? 'human' : '') + '">' + escapeHtml(sourceLabel) + '</span><span class="tag ' + cls + '">' + escapeHtml(label) + '</span><span>' + ((tc.steps || []).length) + ' steps</span></div>' +
        (expected ? '<div class="expected">Expected: ' + escapeHtml(expected) + '</div>' : '') +
        '<div class="readiness ' + cls + '"><b>' + escapeHtml(label) + '</b> — ' + escapeHtml(reason) +
        (reasonCode ? '<span class="readiness-code">Reason: ' + escapeHtml(reasonCode) + ' · Resolution: ' + escapeHtml(resolution || 'NONE') + '</span>' : '') +
        (actions ? '<div class="readiness-actions">' + actions + '</div>' : '') + '</div></div>' +
        '<div class="case-actions"><button class="btn ghost" onclick="openEditor(' + i + ')">Edit</button><button class="btn ghost danger" onclick="deleteCase(' + i + ')">Delete</button></div></div>';
    }).join('');

    $('runHint').textContent = ready + ' Automation Ready · ' + preflight + ' checking · ' + blocked + ' action/manual';
    $('runBtn').disabled = !(ready + preflight);
    if (needsRefresh) scheduleReadiness();
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
    try {
      const r = await fetch('/api/test-cases/repair', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, testCase: tc, credentials: credentialsPayload() })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.reply || 'The test case could not be repaired safely.');
      if (data.testCase) { testCases[index] = data.testCase; renderCases(); }
    } catch (err) { showError(err.message); }
  };

  ['username', 'password'].forEach((id) => $(id).addEventListener('input', () => { if (sessionId && testCases.length) scheduleReadiness(); }));

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
      box.innerHTML = '<strong>Automation readiness</strong><div>This new or edited test will be revalidated before execution.</div>';
      return;
    }
    const historyHtml = history.length ? '<div class="history"><b>Repair history</b><br>' + history.map((x) => 'Attempt ' + escapeHtml(x.attempt) + ': ' + escapeHtml(x.reasonCode || x.originalStatus) + ' → ' + escapeHtml(x.result || 'review')).join('<br>') + '</div>' : '';
    box.innerHTML = '<strong>' + escapeHtml(readinessLabel(r.status)) + '</strong><div><b>Reason code:</b> ' + escapeHtml(r.reasonCode || '—') + '</div><div><b>Reason:</b> ' + escapeHtml(r.reason || '—') + '</div><div><b>Resolution:</b> ' + escapeHtml(r.resolutionType || 'NONE') + '</div><div><b>Validation:</b> Deterministic automation-system check</div>' + historyHtml;
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
    $('editorAiStatus').textContent = 'Grounding against the current story and discovered application…';
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
      scheduleReadiness();
    }, 40);
  });
})();

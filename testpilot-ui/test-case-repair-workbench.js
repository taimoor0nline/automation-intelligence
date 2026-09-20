(function () {
  if (window.__testNexusRepairWorkbench) return;
  window.__testNexusRepairWorkbench = true;

  const style = document.createElement('style');
  style.textContent = `
    .repair-workbench-backdrop{position:fixed;inset:0;z-index:10040;background:rgba(15,23,42,.56);display:none;align-items:center;justify-content:center;padding:20px}
    .repair-workbench-backdrop.show{display:flex}
    .repair-workbench{width:min(820px,96vw);max-height:90vh;overflow:auto;background:#fff;border-radius:16px;box-shadow:0 24px 80px rgba(15,23,42,.28);border:1px solid #dbe3ef}
    .repair-workbench-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:16px 18px;border-bottom:1px solid #e2e8f0;background:#f8fafc}
    .repair-workbench-head strong{display:block;font-size:14px;color:#0f172a}.repair-workbench-head span{display:block;margin-top:4px;font-size:10.5px;line-height:1.45;color:#64748b}
    .repair-workbench-close{border:0;background:transparent;font-size:22px;line-height:1;color:#64748b;cursor:pointer;padding:2px 5px}
    .repair-workbench-body{padding:16px 18px}.repair-blocked-reason{padding:10px 12px;border:1px solid #fed7aa;border-radius:10px;background:#fff7ed;color:#9a3412;font-size:10.5px;line-height:1.5;margin-bottom:14px}
    .repair-paths{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.repair-path{border:1px solid #dbe3ef;border-radius:12px;padding:13px;background:#fff}.repair-path h4{margin:0 0 5px;font-size:11.5px;color:#1e293b}.repair-path p{margin:0 0 10px;font-size:10px;line-height:1.5;color:#64748b}.repair-path .btn{width:100%;justify-content:center}
    .repair-ai-rewrite{margin-top:12px;padding-top:12px;border-top:1px solid #eef2f7}.repair-ai-rewrite label{display:block;font-size:10.5px;font-weight:800;color:#334155;margin-bottom:5px}.repair-ai-rewrite textarea{width:100%;min-height:74px;border:1px solid #cbd5e1;border-radius:9px;padding:9px 10px;font:11px/1.45 inherit;resize:vertical}.repair-ai-rewrite .actions{display:flex;justify-content:flex-end;margin-top:8px}
    .repair-workbench-status{display:none;margin-top:12px;padding:9px 11px;border-radius:9px;font-size:10.5px;line-height:1.45}.repair-workbench-status.show{display:block}.repair-workbench-status.ok{background:#ecfdf5;color:#047857;border:1px solid #a7f3d0}.repair-workbench-status.bad{background:#fef2f2;color:#b91c1c;border:1px solid #fecaca}.repair-workbench-status.working{background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe}
    .repair-contract-note{margin-top:13px;padding:9px 11px;border-radius:9px;background:#f8fafc;border:1px solid #e2e8f0;font-size:9.8px;line-height:1.5;color:#64748b}.repair-contract-note b{color:#334155}
    .readiness-actions .testnexus-repair-workbench-btn{font-weight:800}
    .repair-workbench [data-ai-repair-busy="true"]{opacity:.7;cursor:wait}
    .repair-script-editor{display:none;margin-top:14px;border-top:1px solid #e2e8f0;padding-top:14px}
    .repair-script-editor.show{display:block}
    .repair-script-editor textarea{display:block;width:100%;min-height:265px;padding:12px;border:1px solid #cbd5e1;border-radius:9px;font:12px/1.6 Consolas,Monaco,monospace;white-space:pre;resize:vertical;tab-size:2}
    .repair-script-editor p{font-size:11px;line-height:1.55;color:#475569}
    .repair-script-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:9px;flex-wrap:wrap}
    .repair-confirm{display:none;margin-top:12px;padding:12px;border:1px solid #a7f3d0;border-radius:10px;background:#ecfdf5}
    .repair-confirm.show{display:block}
    .repair-confirm p{font-size:11px;line-height:1.5;color:#166534;margin:0 0 9px}
    .repair-confirm .btn{font-size:11px}
    @media(max-width:760px){.repair-paths{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);

  const modal = document.createElement('div');
  modal.className = 'repair-workbench-backdrop';
  modal.id = 'testNexusRepairWorkbench';
  modal.innerHTML = `
    <div class="repair-workbench" role="dialog" aria-modal="true" aria-labelledby="repairWorkbenchTitle">
      <div class="repair-workbench-head">
        <div><strong id="repairWorkbenchTitle">Repair blocked test case</strong><span id="repairWorkbenchSubtitle">Choose how this test definition should be corrected.</span></div>
        <button type="button" class="repair-workbench-close" aria-label="Close repair workbench">×</button>
      </div>
      <div class="repair-workbench-body">
        <div class="repair-blocked-reason" id="repairWorkbenchReason"></div>
        <div class="repair-paths">
          <div class="repair-path"><h4>Regenerate with AI</h4><p>Keep the test's current business intent/category/scenario, but regenerate its canonical actions and assertions from the current rendered application evidence.</p><button type="button" class="btn ghost" data-repair-action="regenerate">Regenerate</button></div>
          <div class="repair-path"><h4>Rewrite Test</h4><p>Edit this case using the reviewed Cypress-compatible script editor. Human-readable legacy steps cannot silently replace a validated canonical contract.</p><button type="button" class="btn ghost" data-repair-action="human">Rewrite Manually</button></div>
          <div class="repair-path"><h4>Edit Automation Script</h4><p>Advanced authoring using the supported automation command/assertion subset. Selectors and routes still have to match discovered evidence; arbitrary JavaScript is not executed.</p><button type="button" class="btn ghost" data-repair-action="automation-script">Edit Automation Script</button></div>
        </div>
        <div class="repair-ai-rewrite">
          <label for="repairAiInstruction">Or tell AI exactly how to rewrite this case</label>
          <textarea id="repairAiInstruction" placeholder="Example: Keep the invalid-login intent, but verify the visible validation message instead of assuming a 4xx response."></textarea>
          <div class="actions"><button type="button" class="btn primary" data-repair-action="rewrite-ai">Rewrite with AI</button></div>
        </div>
        <div class="repair-script-editor" id="repairScriptEditor">
          <strong>Write Automation Script · <span id="repairScriptCaseId"></span></strong>
          <p>Write Cypress-compatible <code>cy.*</code> commands, one statement per line, using exact selectors observed in rendered discovery. A supported subset is accepted; arbitrary JavaScript, test wrappers, callbacks, and undiscovered selectors are rejected. The server validates and compiles the same actions and assertions before human approval.</p>
          <textarea id="repairScriptText" spellcheck="false" aria-label="Automation Script" placeholder="cy.visit(&quot;/login&quot;);&#10;cy.get(&quot;#email&quot;).type(&quot;invalid-email&quot;);&#10;cy.get(&quot;#sign-in&quot;).click();&#10;cy.get(&quot;#email&quot;).should(&quot;match&quot;, &quot;:invalid&quot;);"></textarea>
          <p>Examples: <code>cy.visit("/login");</code> <code>cy.get("#email").type("invalid-email");</code> <code>cy.get("#sign-in").click();</code> <code>cy.get("#email").should("match", ":invalid");</code> Put final assertions after all actions. Only supported literal Cypress statements and allowlisted <code>Cypress.env("username"|"password")</code> credential references can be saved. Unsupported commands will show a line-specific error and never execute.</p>
          <div class="repair-script-actions">
            <button type="button" class="btn ghost" data-repair-action="cancel-script">Back</button>
            <button type="button" class="btn secondary" data-repair-action="save-script">Validate &amp; Save Script</button>
          </div>
        </div>
        <div class="repair-confirm" id="repairReviewConfirm">
          <p><b>Human confirmation required.</b> Review the updated steps, expected results and compiled automation before approving this new contract. Validation does not execute or approve a test.</p>
          <button type="button" class="btn primary" data-repair-action="confirm">Confirm Reviewed Contract</button>
        </div>
        <div class="repair-workbench-status" id="repairWorkbenchStatus"></div>
        <div class="repair-contract-note"><b>Contract rule:</b> every repair invalidates the previous approval seal. The repaired case must pass deterministic readiness and exact automation-artifact validation, then be reviewed again before Run/Re-run can seal it for execution.</div>
      </div>
    </div>`;
  document.body.appendChild(modal);

  let currentCaseId = '';
  let activeRepairController = null;
  let activeRepairTimeout = null;
  let scriptSaving = false;
  let confirming = false;
  function syncReviewConfirm() {
    const review = currentCase()?.review || {};
    document.getElementById('repairReviewConfirm').classList.toggle('show',
      review.status === 'PENDING_REVIEW' && currentCase()?.automationReadiness?.status === 'READY');
  }

  function cases() {
    try { if (typeof testCases !== 'undefined' && Array.isArray(testCases)) return testCases; } catch {}
    return Array.isArray(window.testCases) ? window.testCases : [];
  }

  function resolveCase(ref) {
    const list = cases();
    if (typeof ref === 'number' || /^\d+$/.test(String(ref || ''))) {
      const index = Number(ref);
      const tc = list[index] || null;
      return { tc, index };
    }
    const id = String(ref || '').trim().toUpperCase();
    const index = list.findIndex((item) => String(item?.id || '').trim().toUpperCase() === id);
    return { tc: index >= 0 ? list[index] : null, index };
  }

  function currentCaseInfo() {
    return resolveCase(currentCaseId);
  }

  function currentCase() {
    return currentCaseInfo().tc;
  }

  function setStatus(text, type) {
    const box = document.getElementById('repairWorkbenchStatus');
    box.textContent = text || '';
    box.className = `repair-workbench-status${text ? ` show ${type || ''}` : ''}`;
  }

  function setAiBusy(busy, action = '') {
    modal.querySelectorAll('[data-repair-action="regenerate"],[data-repair-action="rewrite-ai"]').forEach((button) => {
      if (!button.dataset.idleLabel) button.dataset.idleLabel = button.textContent;
      button.disabled = Boolean(busy);
      button.dataset.aiRepairBusy = busy ? 'true' : 'false';
      button.textContent = busy && button.dataset.repairAction === action
        ? (action === 'regenerate' ? 'Regenerating…' : 'Rewriting…')
        : button.dataset.idleLabel;
    });
  }

  function cancelActiveRepair() {
    if (activeRepairTimeout) clearTimeout(activeRepairTimeout);
    activeRepairTimeout = null;
    if (activeRepairController) activeRepairController.abort();
    activeRepairController = null;
    setAiBusy(false);
  }

  function close() {
    cancelActiveRepair();
    if (scriptSaving) return;
    document.getElementById('repairScriptEditor').classList.remove('show');
    modal.classList.remove('show');
    setStatus('', '');
  }

  function open(ref) {
    const resolved = resolveCase(ref);
    const tc = resolved.tc;
    if (!tc) return;
    currentCaseId = String(tc.id || '').trim().toUpperCase();
    const readiness = tc.automationReadiness || {};
    document.getElementById('repairWorkbenchTitle').textContent = `${readiness.status === 'READY' ? 'Edit automation' : 'Repair'} ${tc.id || 'test case'}`;
    document.getElementById('repairWorkbenchSubtitle').textContent = tc.title || 'Choose how this test definition should be corrected.';
    document.getElementById('repairWorkbenchReason').textContent = `${String(readiness.status || 'BLOCKED').replaceAll('_',' ')} · ${readiness.reasonCode || 'REVIEW_REQUIRED'} — ${readiness.reason || 'The case is not currently executable.'}`;
    document.getElementById('repairScriptEditor').classList.remove('show');
    document.getElementById('repairAiInstruction').value = '';
    cancelActiveRepair();
    setStatus('', '');
    modal.classList.add('show');
    syncReviewConfirm();
  }

  function credentials() {
    return {
      username: document.getElementById('username')?.value || '',
      password: document.getElementById('password')?.value || '',
    };
  }

  async function aiRepair(action) {
    const tc = currentCase();
    if (!tc || (!window.sessionId && typeof sessionId === 'undefined')) return;
    const instruction = document.getElementById('repairAiInstruction').value.trim();
    if (action === 'rewrite-ai' && !instruction) {
      setStatus('Describe how you want this test rewritten.', 'bad');
      return;
    }
    if (activeRepairController) return;

    const controller = new AbortController();
    activeRepairController = controller;
    let timedOut = false;
    activeRepairTimeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 120000);

    setStatus(action === 'regenerate'
      ? 'Regenerating from current rendered evidence… You can close this dialog to cancel.'
      : 'AI is rewriting the test contract… You can close this dialog to cancel.', 'working');
    setAiBusy(true, action);

    try {
      const sid = typeof sessionId !== 'undefined' ? sessionId : window.sessionId;
      const response = await fetch('/api/test-cases/repair-workbench', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sid, testCase: { id: tc.id }, action, instruction, credentials: credentials(), expectedRevision: Number(tc.review?.revision) || 0 }),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = Array.isArray(data.validationErrors) && data.validationErrors.length
          ? ` ${data.validationErrors[0]?.message || data.validationErrors[0]}`
          : '';
        throw new Error(`${data.reply || 'The test case could not be regenerated safely.'}${detail}`.trim());
      }
      if (!data.testCase) throw new Error('Repair returned no test case.');

      const list = cases();
      const index = list.findIndex((item) => String(item?.id || '').toUpperCase() === currentCaseId);
      if (index < 0) throw new Error(`The repaired test case ${currentCaseId} is no longer present in the review list.`);
      list[index] = data.testCase;
      currentCaseId = String(data.testCase.id || currentCaseId).toUpperCase();
      if (typeof renderCases === 'function') renderCases();
      syncReviewConfirm();

      if (data.automationReady) {
        setStatus(data.message || 'Repair validated. Review the new case before execution.', 'ok');
        // Keep the dialog open so the human can explicitly confirm the new
        // contract. Closing it used to hide the required review step.
      } else {
        setStatus(data.message || 'The rewritten case is still blocked. The repair controls remain active so you can retry, rewrite manually, or edit the automation script.', 'bad');
      }
    } catch (err) {
      if (err?.name === 'AbortError') {
        setStatus(timedOut
          ? 'AI repair timed out. The repair controls are active again; retry or use another repair path.'
          : 'AI repair was cancelled.', 'bad');
      } else {
        setStatus(`${err.message || 'Repair failed.'} The repair controls are active again.`, 'bad');
      }
    } finally {
      if (activeRepairTimeout) clearTimeout(activeRepairTimeout);
      activeRepairTimeout = null;
      activeRepairController = null;
      setAiBusy(false);
    }
  }

  function openHumanRewrite() {
    const { tc, index } = currentCaseInfo();
    if (!tc || index < 0) return;
    if (tc.canonicalIr) {
      // Legacy text-field saves do not compile or persist canonical IR and
      // must never silently change an already validated generated contract.
      openAutomationRewrite();
      return;
    }
    if (typeof openEditor !== 'function') {
      setStatus('The human test-case editor is not available. Refresh TestNexus and retry.', 'bad');
      return;
    }
    modal.classList.remove('show');
    setStatus('', '');
    openEditor(index);
    const heading = document.getElementById('editorHeading');
    if (heading) heading.textContent = `Rewrite Test Case · ${tc.id || ''}`;
  }

  function editableScript(tc) {
    if (tc?.manualCypressScript) return tc.manualCypressScript;
    const ir = tc?.canonicalIr || {};
    const plan = tc?._canonicalAutomationPlan || tc?.automationReadiness?.automationPlan || {};
    const q = value => JSON.stringify(String(value ?? ''));
    const element = (data, compiled) => compiled?.selector || data?.selector || '';
    const selector = (data, compiled) => element(data, compiled) ? 'cy.get(' + q(element(data, compiled)) + ')' : null;
    const action = (data, compiled) => {
      const target = selector(data, compiled);
      const op = String(data.operation || '').toUpperCase();
      if (op === 'NAVIGATE') return 'cy.visit(' + q(data.path) + ');';
      if (op === 'RELOAD') return 'cy.reload();';
      if (op === 'GO_BACK') return 'cy.go("back");';
      if (op === 'GO_FORWARD') return 'cy.go("forward");';
      if (op === 'TYPE_RUNTIME_CREDENTIAL') return target
        ? target + '.type(Cypress.env(' + q(data.credential) + '));'
        : 'cy.unsupported("Runtime credential requires a grounded control selector.");';
      if (!target) return 'cy.unsupported(' + q(op + ' requires a discovered selector; rewrite this statement manually') + ');';
      const method = {
        TYPE:'type',CLEAR:'clear',CLICK:'click',DBLCLICK:'dblclick',
        RIGHTCLICK:'rightclick',SELECT:'select',CHECK:'check',UNCHECK:'uncheck',
        SUBMIT:'submit',FOCUS:'focus',BLUR:'blur',SCROLL_INTO_VIEW:'scrollIntoView',
      }[op];
      if (!method) return 'cy.unsupported(' + q('Rewrite unsupported operation: ' + op) + ');';
      return target + '.' + method + '(' + (['type','select'].includes(method) ? q(data.value) : '') + ');';
    };
    const assertion = (data, compiled) => {
      const op = String(data.operation || '').toUpperCase();
      if (op === 'ASSERT_PATH_EQUALS') return 'cy.location("pathname").should("eq", ' + q(data.path) + ');';
      if (op === 'ASSERT_PATH_INCLUDES') return 'cy.location("pathname").should("include", ' + q(data.fragment) + ');';
      if (op === 'ASSERT_URL_EQUALS') return 'cy.url().should("eq", ' + q(data.url) + ');';
      if (op === 'ASSERT_URL_INCLUDES') return 'cy.url().should("include", ' + q(data.fragment) + ');';
      const target = selector(data, compiled);
      if (!target) return '// ' + op + ' needs a discovered selector; write a cy.get(...).should(...) assertion manually.';
      const shorthand = {
        ASSERT_VISIBLE:'be.visible',ASSERT_HIDDEN:'not.be.visible',
        ASSERT_EXISTS:'exist',ASSERT_NOT_EXISTS:'not.exist',
        ASSERT_ENABLED:'be.enabled',ASSERT_DISABLED:'be.disabled',
        ASSERT_CHECKED:'be.checked',ASSERT_UNCHECKED:'not.be.checked',
      }[op];
      if (shorthand) return target + '.should(' + q(shorthand) + ');';
      if (op === 'ASSERT_INVALID') return target + '.should("match", ":invalid");';
      if (op === 'ASSERT_VALID') return target + '.should("match", ":valid");';
      if (op === 'ASSERT_REQUIRED') return target + '.should("have.attr", "required");';
      if (op === 'ASSERT_OPTIONAL') return target + '.should("not.have.attr", "required");';
      if (op === 'ASSERT_VALUE_EMPTY') return target + '.should("have.value", "");';
      if (op === 'ASSERT_VALUE_NOT_EMPTY') return target + '.should("not.have.value", "");';
      if (op === 'ASSERT_TEXT_EMPTY') return target + '.should("have.text", "");';
      const named = {
        ASSERT_VALUE_EQUALS:'have.value',ASSERT_TEXT_EQUALS:'have.text',
        ASSERT_TEXT_CONTAINS:'contain.text',ASSERT_TEXT_NOT_CONTAINS:'not.contain.text',
      }[op];
      if (named) return target + '.should(' + q(named) + ', ' + q(op.includes('TEXT') ? data.text : data.value) + ');';
      return 'cy.unsupported(' + q('Rewrite unsupported assertion: ' + op) + ');';
    };
    const actions=(ir.actions || []).map((item,i)=>action(item,plan.actions?.[i]));
    const assertions=(ir.assertions || []).map((item,i)=>assertion(item,plan.assertions?.[i]));
    if(actions.length && assertions.length) return [...actions,'',...assertions].join('\n');
    return '// Write Cypress commands using selectors observed in rendered discovery.\n// Example: cy.visit("/login");\n// cy.get("#email").type("bad-email");\n// cy.get("#email").should("match", ":invalid");';
  }

  function openAutomationRewrite() {
    const tc = currentCase();
    if (!tc) return;
    document.getElementById('repairScriptEditor').classList.add('show');
    document.getElementById('repairScriptCaseId').textContent = tc.id || '';
    document.getElementById('repairScriptText').value = editableScript(tc);
    setStatus('Edit supported Cypress syntax, then validate and save. The previous test remains unchanged if validation fails.', 'working');
    document.getElementById('repairScriptText').focus();
  }

  async function saveManualScript() {
    const tc = currentCase();
    if (!tc || scriptSaving || activeRepairController) return;
    const script = document.getElementById('repairScriptText').value.trim();
    if (!script) return setStatus('Enter at least one action and one assertion.', 'bad');
    scriptSaving = true;
    const button = modal.querySelector('[data-repair-action="save-script"]');
    button.disabled = true;
    button.textContent = 'Validating…';
    setStatus('Validating the exact script against rendered evidence and the deterministic automation contract…', 'working');
    try {
      const sid = typeof sessionId !== 'undefined' ? sessionId : window.sessionId;
      if (!sid) throw new Error('Session expired. Generate a new session before editing the automation.');
      const response = await fetch('/api/test-cases/repair-workbench', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sid, testCase: { id: tc.id }, action: 'manual-script', script, credentials: credentials(), expectedRevision: Number(tc.review?.revision) || 0 }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const reasons = (data.validationErrors || []).map((item) => item?.message || item).filter(Boolean);
        throw new Error([data.reply, ...reasons].filter(Boolean).filter((item, index, array) => array.indexOf(item) === index).join(' · ') || 'Script validation failed.');
      }
      if (!data.testCase || !data.automationReady) throw new Error('The script was not Automation Ready; the original test remains unchanged.');
      const list = cases();
      const index = list.findIndex((item) => String(item?.id || '').toUpperCase() === String(tc.id || '').toUpperCase());
      if (index < 0) throw new Error('The saved case is not in the current review list. Refresh this session.');
      list[index] = data.testCase;
      if (typeof renderCases === 'function') renderCases();
      syncReviewConfirm();
      document.getElementById('repairScriptEditor').classList.remove('show');
      setStatus(data.message || 'Validated script saved. Review the new test contract before execution.', 'ok');
    } catch (err) {
      setStatus(err.message || 'The script could not be validated. The original case was not modified.', 'bad');
    } finally {
      scriptSaving = false;
      button.disabled = false;
      button.textContent = 'Validate & Save Script';
    }
  }

  async function confirmReviewedContract() {
    const tc = currentCase();
    if (!tc || confirming || scriptSaving || activeRepairController) return;
    if (tc.review?.status !== 'PENDING_REVIEW') return setStatus('Save and validate the script before confirming it.', 'bad');
    const button = modal.querySelector('[data-repair-action="confirm"]');
    confirming = true;
    button.disabled = true;
    button.textContent = 'Confirming…';
    setStatus('Verifying that the reviewed draft and compiled contract have not changed…', 'working');
    try {
      const sid = typeof sessionId !== 'undefined' ? sessionId : window.sessionId;
      if (!sid) throw new Error('Session expired. Reopen the saved test session before confirming.');
      const response = await fetch('/api/test-cases/repair-workbench', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sid,
          testCase: { id: tc.id },
          action: 'confirm',
          expectedRevision: tc.review.revision,
          reviewHash: tc.review.contractHash,
          credentials: credentials(),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.testCase) throw new Error(data.reply || 'Review confirmation failed.');
      const list = cases();
      const index = list.findIndex((item) => String(item?.id || '').toUpperCase() === String(tc.id || '').toUpperCase());
      if (index < 0) throw new Error('The saved case is no longer visible in this session.');
      list[index] = data.testCase;
      if (typeof renderCases === 'function') renderCases();
      syncReviewConfirm();
      setStatus(data.message || 'Contract confirmed. You may proceed to human approval and execution.', 'ok');
    } catch (err) {
      setStatus(err.message || 'Review could not be confirmed.', 'bad');
    } finally {
      confirming = false;
      button.disabled = false;
      button.textContent = 'Confirm Reviewed Contract';
    }
  }

  modal.addEventListener('click', (event) => {
    if (event.target === modal || event.target.closest('.repair-workbench-close')) return close();
    const button = event.target.closest('[data-repair-action]');
    if (!button) return;
    const action = button.dataset.repairAction;
    if (action === 'regenerate' || action === 'rewrite-ai') return void aiRepair(action);
    if (action === 'human') return openHumanRewrite();
    if (action === 'automation-script') return openAutomationRewrite();
    if (action === 'cancel-script') { document.getElementById('repairScriptEditor').classList.remove('show'); return setStatus('', ''); }
    if (action === 'save-script') return void saveManualScript();
    if (action === 'confirm') return void confirmReviewedContract();
  });

  window.openTestRepairWorkbench = open;
  window.openTestRepairWorkbenchById = (id) => open(String(id || ''));

  let decorating = false;
  function decorateBlockedCases() {
    if (decorating) return;
    decorating = true;
    try {
      const list = cases();
      document.querySelectorAll('#cases .case').forEach((card, index) => {
        const cardId = String(card.querySelector('.case-check')?.value || '').trim().toUpperCase();
        const tc = cardId
          ? list.find((item) => String(item?.id || '').trim().toUpperCase() === cardId)
          : list[index];
        if (!tc) return;
        const status = String(tc?.automationReadiness?.status || 'NEEDS_PREFLIGHT').toUpperCase();
        card.querySelectorAll('button[onclick*="repairCaseWithAI"],button[title="Repair test case with AI"]:not([data-repair-workbench])').forEach((button) => button.remove());
        const caseActions = card.querySelector('.case-actions');
        if (caseActions && !caseActions.querySelector('[data-script-edit]')) {
          const scriptButton = document.createElement('button');
          scriptButton.type = 'button';
          scriptButton.className = 'btn ghost';
          scriptButton.dataset.scriptEdit = '1';
          scriptButton.textContent = 'Edit Automation Script';
          scriptButton.addEventListener('click', () => { open(String(tc.id || cardId || index)); openAutomationRewrite(); });
          caseActions.appendChild(scriptButton);
        }
        if (status === 'READY' || status === 'NEEDS_PREFLIGHT') return;
        let actions = card.querySelector('.readiness-actions');
        if (!actions) {
          actions = document.createElement('div');
          actions.className = 'readiness-actions';
          card.querySelector('.readiness')?.appendChild(actions);
        }
        if (!actions || actions.querySelector('[data-repair-workbench]')) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn ghost testnexus-repair-workbench-btn';
        button.dataset.repairWorkbench = '1';
        button.textContent = 'Repair';
        button.title = 'Regenerate or rewrite this blocked test case';
        button.addEventListener('click', () => open(String(tc.id || cardId || index)));
        actions.prepend(button);
      });
    } finally {
      decorating = false;
    }
  }

  const casesRoot = document.getElementById('cases');
  if (casesRoot) new MutationObserver(() => setTimeout(decorateBlockedCases, 0)).observe(casesRoot, { childList: true, subtree: true });

  // readiness.js still owns the historical inline handler. Route it into this
  // workbench after all page scripts finish loading so there is one repair path.
  setTimeout(() => {
    window.repairCaseWithAI = function (index) { open(Number(index)); };
    decorateBlockedCases();
  }, 0);
})();

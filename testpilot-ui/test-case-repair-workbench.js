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
          <div class="repair-path"><h4>Rewrite Test</h4><p>Open the normal human test-case editor and rewrite the title, steps and expected results yourself. Saving triggers deterministic readiness again.</p><button type="button" class="btn ghost" data-repair-action="human">Rewrite Manually</button></div>
          <div class="repair-path"><h4>Edit Cypress</h4><p>Advanced authoring using the supported Cypress command/assertion subset. Selectors and routes still have to match discovered evidence; arbitrary JavaScript is not executed.</p><button type="button" class="btn ghost" data-repair-action="cypress">Edit Cypress Syntax</button></div>
        </div>
        <div class="repair-ai-rewrite">
          <label for="repairAiInstruction">Or tell AI exactly how to rewrite this case</label>
          <textarea id="repairAiInstruction" placeholder="Example: Keep the invalid-login intent, but verify the visible validation message instead of assuming a 4xx response."></textarea>
          <div class="actions"><button type="button" class="btn primary" data-repair-action="rewrite-ai">Rewrite with AI</button></div>
        </div>
        <div class="repair-workbench-status" id="repairWorkbenchStatus"></div>
        <div class="repair-contract-note"><b>Contract rule:</b> every repair invalidates the previous approval seal. The repaired case must pass deterministic readiness and exact Cypress validation, then be reviewed again before Run/Re-run can seal it for execution.</div>
      </div>
    </div>`;
  document.body.appendChild(modal);

  let currentIndex = -1;

  function cases() {
    try { if (typeof testCases !== 'undefined' && Array.isArray(testCases)) return testCases; } catch {}
    return Array.isArray(window.testCases) ? window.testCases : [];
  }

  function currentCase() {
    return currentIndex >= 0 ? cases()[currentIndex] || null : null;
  }

  function setStatus(text, type) {
    const box = document.getElementById('repairWorkbenchStatus');
    box.textContent = text || '';
    box.className = `repair-workbench-status${text ? ` show ${type || ''}` : ''}`;
  }

  function close() {
    modal.classList.remove('show');
    setStatus('', '');
  }

  function open(index) {
    const tc = cases()[Number(index)];
    if (!tc) return;
    currentIndex = Number(index);
    const readiness = tc.automationReadiness || {};
    document.getElementById('repairWorkbenchTitle').textContent = `Repair ${tc.id || 'test case'}`;
    document.getElementById('repairWorkbenchSubtitle').textContent = tc.title || 'Choose how this test definition should be corrected.';
    document.getElementById('repairWorkbenchReason').textContent = `${String(readiness.status || 'BLOCKED').replaceAll('_',' ')} · ${readiness.reasonCode || 'REVIEW_REQUIRED'} — ${readiness.reason || 'The case is not currently executable.'}`;
    document.getElementById('repairAiInstruction').value = '';
    setStatus('', '');
    modal.classList.add('show');
  }

  function credentials() {
    return {
      username: document.getElementById('username')?.value || '',
      password: document.getElementById('password')?.value || '',
    };
  }

  async function aiRepair(action) {
    const tc = currentCase();
    if (!tc || !window.sessionId && typeof sessionId === 'undefined') return;
    const instruction = document.getElementById('repairAiInstruction').value.trim();
    if (action === 'rewrite-ai' && !instruction) {
      setStatus('Describe how you want this test rewritten.', 'bad');
      return;
    }
    setStatus(action === 'regenerate' ? 'Regenerating from current rendered evidence…' : 'AI is rewriting the test contract…', 'working');
    modal.querySelectorAll('[data-repair-action]').forEach((button) => { button.disabled = true; });
    try {
      const sid = typeof sessionId !== 'undefined' ? sessionId : window.sessionId;
      const response = await fetch('/api/test-cases/repair-workbench', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sid, testCase: tc, action, instruction, credentials: credentials() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.reply || 'The test case could not be regenerated safely.');
      if (!data.testCase) throw new Error('Repair returned no test case.');
      cases()[currentIndex] = data.testCase;
      if (typeof renderCases === 'function') renderCases();
      setStatus(data.message || (data.automationReady ? 'Repair validated. Review the new case before execution.' : 'The rewritten case is still blocked; choose another repair path or revise it manually.'), data.automationReady ? 'ok' : 'bad');
      setTimeout(() => {
        close();
        const card = document.querySelectorAll('#cases .case')[currentIndex];
        card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, data.automationReady ? 900 : 1700);
    } catch (err) {
      setStatus(err.message || 'Repair failed.', 'bad');
    } finally {
      modal.querySelectorAll('[data-repair-action]').forEach((button) => { button.disabled = false; });
    }
  }

  function extractEditableCypress(tc) {
    if (Array.isArray(tc?.cypressSteps) && Array.isArray(tc?.cypressAssertions)) {
      return { steps: tc.cypressSteps, assertions: tc.cypressAssertions };
    }
    const lines = String(tc?.cypressPreview || '').split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith('cy.'));
    const assertionPattern = /\.should\(|^cy\.(?:url|location|title)\(/;
    const safeStepPattern = /^cy\.(?:visit|reload|go|viewport)\(|^cy\.get\(.+\)\.(?:clear|type|click|dblclick|rightclick|select|check|uncheck|focus|blur|submit|scrollIntoView|trigger)\(/;
    const assertions = lines.filter((line) => assertionPattern.test(line));
    const steps = lines.filter((line) => !assertionPattern.test(line) && safeStepPattern.test(line));
    return { steps, assertions };
  }

  function openHumanRewrite() {
    const index = currentIndex;
    close();
    if (typeof openEditor !== 'function') return;
    openEditor(index);
    const mode = document.getElementById('testCreationModeSelect');
    if (mode) mode.value = '';
    const heading = document.getElementById('editorHeading');
    if (heading) heading.textContent = `Rewrite Test Case · ${currentCase()?.id || ''}`;
  }

  function openCypressRewrite() {
    const tc = currentCase();
    const index = currentIndex;
    const seed = extractEditableCypress(tc);
    close();
    if (typeof openEditor !== 'function') return;
    openEditor(index);
    const mode = document.getElementById('testCreationModeSelect');
    if (mode) {
      mode.value = 'manual';
      mode.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const steps = document.getElementById('editSteps');
    const expected = document.getElementById('editExpected');
    if (steps && seed.steps.length) steps.value = seed.steps.join('\n');
    if (expected && seed.assertions.length) expected.value = seed.assertions.join('\n');
    const heading = document.getElementById('editorHeading');
    if (heading) heading.textContent = `Rewrite Test Case · Cypress Syntax · ${tc?.id || ''}`;
    const hint = document.getElementById('testCreationModeHint');
    if (hint) hint.textContent = 'Advanced rewrite: use only the supported Cypress command/assertion subset. Save converts this syntax back into the deterministic TestNexus contract and revalidates it before execution.';
    if (!seed.steps.length || !seed.assertions.length) {
      const help = document.getElementById('manualCypressHelp');
      help?.classList.add('show');
    }
  }

  modal.addEventListener('click', (event) => {
    if (event.target === modal || event.target.closest('.repair-workbench-close')) return close();
    const button = event.target.closest('[data-repair-action]');
    if (!button) return;
    const action = button.dataset.repairAction;
    if (action === 'regenerate' || action === 'rewrite-ai') return void aiRepair(action);
    if (action === 'human') return openHumanRewrite();
    if (action === 'cypress') return openCypressRewrite();
  });

  window.openTestRepairWorkbench = open;

  let decorating = false;
  function decorateBlockedCases() {
    if (decorating) return;
    decorating = true;
    try {
      const list = cases();
      document.querySelectorAll('#cases .case').forEach((card, index) => {
        const tc = list[index];
        if (!tc) return;
        const status = String(tc?.automationReadiness?.status || 'NEEDS_PREFLIGHT').toUpperCase();
        card.querySelectorAll('button[onclick*="repairCaseWithAI"],button[title="Repair test case with AI"]').forEach((button) => button.remove());
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
        button.addEventListener('click', () => open(index));
        actions.prepend(button);
      });
    } finally {
      decorating = false;
    }
  }

  const casesRoot = document.getElementById('cases');
  if (casesRoot) new MutationObserver(() => setTimeout(decorateBlockedCases, 0)).observe(casesRoot, { childList: true, subtree: true });
  setTimeout(decorateBlockedCases, 0);
})();

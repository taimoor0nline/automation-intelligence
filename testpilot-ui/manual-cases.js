// Testing page: manual test cases (⊕ "Add Human Test Case") are saved to the database as soon as they are saved in
// the editor, with the project, story, category and source ("human"). Edits to generated cases are saved the same way.
// ⊕ also works before any AI generation: a testing session is started for the project first.
(function () {
  if (window.__tnManualCases) return;
  window.__tnManualCases = true;
  const $ = (id) => document.getElementById(id);
  const token = () => { try { return sessionStorage.getItem('aiTestPilotToken') || ''; } catch { return ''; } };
  const ctx = () => window.testnexusRunnerContext || {};
  const projectId = () => ctx().projectId || $('platformProject')?.value || '';
  const currentSession = () => { try { return typeof sessionId !== 'undefined' ? sessionId : null; } catch { return null; } };
  async function call(path, body) {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() }, body: JSON.stringify(body || {}) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(d.reply || 'Request failed (' + r.status + ').');
    return d;
  }
  // Small notice at the bottom of the screen (the page rewrites its own subtitle line while it works).
  function say(text, bad) {
    let el = $('tnManualToast');
    if (!el) { el = document.createElement('div'); el.id = 'tnManualToast'; el.setAttribute('role', 'status'); el.style.cssText = 'position:fixed;left:24px;bottom:24px;z-index:2000;max-width:min(420px,calc(100vw - 48px));padding:10px 14px;border-radius:10px;font:600 13px system-ui,sans-serif;box-shadow:0 10px 30px rgba(15,23,42,.2)'; document.body.appendChild(el); }
    el.textContent = text; el.style.background = bad ? '#fef2f2' : '#f0fdf4'; el.style.color = bad ? '#b91c1c' : '#15803d'; el.style.border = '1px solid ' + (bad ? '#fecaca' : '#bbf7d0'); el.hidden = false;
    clearTimeout(say.t); say.t = setTimeout(() => { el.hidden = true; }, 5000);
  }


  // ⊕ stays usable when a project is open, even before any test cases were generated.
  setInterval(() => { const b = $('addCaseBtn'); if (b && b.disabled && projectId()) b.disabled = false; }, 700);

  // ⊕ → small popup first: "With AI" or "Manually". Then the editor opens already in that mode (the page's own
  // "Select creation method" dropdown is set for you and hidden), so only what that method needs is shown.
  // With no session yet (nothing generated), one is started for the project first.
  async function ensureSession() {
    if (currentSession()) return true;
    const d = await call('/api/projects/' + encodeURIComponent(projectId()) + '/manual-session', {
      targetUrl: $('targetUrl')?.value || '', environmentName: $('environment')?.value || '', story: $('story')?.value || '', storyId: ctx().storyId || null,
    });
    sessionId = d.sessionId; // the testing page's own session variable
    return true;
  }
  function openIn(mode) {
    const open = window.openEditor || (typeof openEditor === 'function' ? openEditor : null); if (!open) return;
    open(-1);
    const sel = $('testCreationModeSelect');
    if (sel) { sel.value = mode; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    const chooser = $('testCreationMode'); if (chooser) chooser.style.display = 'none';
    const h = $('editorHeading'); if (h) h.textContent = mode === 'ai' ? 'Add test case · With AI' : 'Add test case · Manually';
    collapseHelp();
    const t = $('tnHelpToggle'); if (t) t.hidden = mode === 'ai'; // the guide is for writing steps by hand
  }
  function choose() {
    let d = $('tnAddChoice');
    if (!d) {
      d = document.createElement('dialog'); d.id = 'tnAddChoice';
      d.innerHTML = '<style>#tnAddChoice{border:0;border-radius:16px;padding:0;width:min(560px,calc(100vw - 32px));box-shadow:0 24px 60px rgba(15,23,42,.3);font-family:inherit}#tnAddChoice::backdrop{background:rgba(15,23,42,.45)}#tnAddChoice .h{display:flex;justify-content:space-between;align-items:center;padding:16px 20px 4px}#tnAddChoice .h b{font-size:17px;color:#0f172a}#tnAddChoice .x{border:0;background:#f1f5f9;width:30px;height:30px;border-radius:8px;font-size:18px;cursor:pointer;color:#475569}#tnAddChoice .s{padding:0 20px 12px;font-size:13px;color:#64748b}#tnAddChoice .opts{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:0 20px 20px}@media(max-width:520px){#tnAddChoice .opts{grid-template-columns:1fr}}#tnAddChoice .opt{display:grid;gap:6px;text-align:left;padding:16px;border:1px solid #e2e8f0;border-radius:12px;background:#fff;cursor:pointer;font:inherit}#tnAddChoice .opt:hover,#tnAddChoice .opt:focus-visible{border-color:#2563eb;background:#eff6ff;outline:0}#tnAddChoice .opt b{font-size:15px;color:#0f172a}#tnAddChoice .opt span{font-size:12.5px;color:#64748b;line-height:1.45}</style>'
        + '<div class="h"><b>Add a test case</b><button type="button" class="x" data-add="close" aria-label="Close">×</button></div><div class="s">How do you want to create it?</div>'
        + '<div class="opts"><button type="button" class="opt" data-add="ai"><b>✨ With AI</b><span>Describe one scenario in a sentence. AI writes the test case for you to check and save.</span></button>'
        + '<button type="button" class="opt" data-add="manual"><b>✍ Manually</b><span>Write the title, steps and expected result yourself as automation commands.</span></button></div>';
      document.body.appendChild(d);
      d.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-add]'); if (!b && e.target !== d) return;
        const mode = b?.dataset.add; d.close();
        if (mode !== 'ai' && mode !== 'manual') return;
        try { await ensureSession(); openIn(mode); }
        catch (err) { if (typeof showError === 'function') showError(err.message); else say(err.message, true); }
      });
    }
    d.showModal();
  }
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#addCaseBtn') || (!currentSession() && !projectId())) return;
    e.preventDefault(); e.stopImmediatePropagation(); choose();
  }, true);

  // Manual mode: the long syntax guide is folded behind one "How to write" link instead of always filling the editor.
  const helpCss = document.createElement('style');
  helpCss.textContent = '#manualCypressHelp.tn-folded{display:none!important}.tn-help-toggle{display:inline-block;margin:2px 0 10px;border:0;background:none;padding:0;color:#2563eb;font:600 12.5px inherit;cursor:pointer;text-decoration:underline;text-underline-offset:2px}.tn-help-toggle[hidden]{display:none}';
  document.head.appendChild(helpCss);
  function collapseHelp() {
    const help = $('manualCypressHelp'); if (!help) return;
    help.classList.add('tn-folded');
    let t = $('tnHelpToggle');
    if (!t) { t = document.createElement('button'); t.type = 'button'; t.id = 'tnHelpToggle'; t.className = 'tn-help-toggle'; help.before(t); t.onclick = () => { help.classList.toggle('tn-folded'); t.textContent = help.classList.contains('tn-folded') ? 'How to write the steps (examples) ▸' : 'Hide how to write ▾'; }; }
    t.textContent = 'How to write the steps (examples) ▸'; t.hidden = $('testCreationModeSelect')?.value === 'ai';
  }
  // Also fold it when an existing case is opened for editing.
  const modal = $('editorModal');
  if (modal) new MutationObserver(() => { if (modal.classList.contains('show')) setTimeout(collapseHelp, 100); }).observe(modal, { attributes: true, attributeFilter: ['class'] });

  // Save in the editor → save to the database (after the page and the category field have updated the case).
  // The editor's category / security fields are read here too: for a new case the page does not copy them onto the case.
  let pending = null, picked = {};
  document.addEventListener('click', (e) => { if (!e.target.closest('#saveEditorBtn')) return; pending = String($('editId')?.value || '').trim(); picked = { testCategory: $('editTestCategory')?.value || '', securitySubcategory: $('editSecuritySubcategory')?.value || '' }; }, true);
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#saveEditorBtn') || !pending) return;
    const id = pending; pending = null;
    setTimeout(async () => {
      let list = []; try { list = typeof testCases !== 'undefined' ? testCases : []; } catch {}
      const tc = list.find((x) => String(x.id) === id), sid = currentSession();
      if (!tc || !sid || !projectId()) return;
      try {
        if (picked.testCategory) tc.testCategory = String(picked.testCategory).toUpperCase();
        if (tc.testCategory === 'SECURITY' && picked.securitySubcategory) tc.securitySubcategory = picked.securitySubcategory;
        await call('/api/projects/' + encodeURIComponent(projectId()) + '/sessions/' + encodeURIComponent(sid) + '/manual-test-cases', { testCase: tc });
        say('✓ ' + id + ' saved to the project' + (String(tc.source || '').startsWith('human') ? ' as a manual test case' : '') + '.');
      } catch (err) { say('Could not save ' + id + ': ' + err.message, true); }
    }, 150);
  });

})();
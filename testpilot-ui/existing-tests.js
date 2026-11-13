// Testing page start: the query string says how to start.
//   /runner?mode=new&projectId=…        fresh start (generate test cases)
//   /runner?mode=existing&projectId=…   saved test cases from the database (also ?existing=1)
//   no mode                             a popup asks "Fresh start" or "Use existing test cases (N)" when the project has some.
// Existing mode:
// The "Review test cases" box lists the project's saved test cases that can run, each unique test once (no generation).
// Select / deselect them, optionally pick another environment, and press Start Tests: the ticked tests run in the session
// they were saved in (one run per session) with the normal runner, so results are saved like every other run (Runs & reports).
// Generating new cases on this page leaves this mode and the page works as before.
(function () {
  if (window.__tnExistingTests) return;
  window.__tnExistingTests = true;
  const params = new URLSearchParams(location.search);
  const mode = params.get('existing') === '1' || params.get('mode') === 'existing' ? 'existing' : params.get('mode') === 'new' ? 'new' : 'ask';
  if (mode === 'new') return;
  const handoff = (() => { try { return JSON.parse(sessionStorage.getItem('testnexus:runnerHandoff') || (mode === 'existing' ? sessionStorage.getItem('testnexus:existingHandoff') : null) || 'null') || {}; } catch { return {}; } })();
  let projectId = params.get('projectId') || handoff.projectId || '';
  let storyId = params.get('storyId') || handoff.storyId || '';
  // From a failed-test task (▶): only that test's session, with the failed case ticked.
  const onlySession = params.get('sessionId') || '', onlyCase = String(params.get('caseId') || '').toUpperCase();
  if (mode === 'existing' && !projectId) return;
  const remember = () => { try { sessionStorage.setItem('testnexus:existingHandoff', JSON.stringify({ projectId, storyId })); } catch {} };
  const setUrl = (m) => history.replaceState(null, '', '/runner?mode=' + m + '&projectId=' + encodeURIComponent(projectId) + (storyId ? '&storyId=' + encodeURIComponent(storyId) : ''));

  const $ = (id) => document.getElementById(id);
  const token = () => { try { return sessionStorage.getItem('aiTestPilotToken') || ''; } catch { return ''; } };
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const when = (v) => v ? new Date(v).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) : '';
  async function call(path, opts = {}) {
    const r = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token(), ...(opts.headers || {}) } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(d.reply || 'Request failed (' + r.status + ').');
    return d;
  }

  const style = document.createElement('style');
  style.textContent = `
#existingCases{display:grid;gap:12px;max-height:62vh;overflow:auto;padding-right:4px}
#existingCases .ex-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:10px 12px;border:1px solid #dbeafe;border-radius:10px;background:#eff6ff;font-size:12.5px;color:#1e3a8a}
#existingCases .ex-bar select{min-width:180px;padding:6px 8px;border:1px solid #cbd5e1;border-radius:8px;font:inherit;background:#fff}
#existingCases .ex-empty{padding:28px 10px;text-align:center;color:#64748b;font-size:13px}
#existingCases .case[hidden]{display:none}
body.tn-existing-mode #runBtn{display:none!important}`;
  document.head.appendChild(style);

  let data = null, active = mode === 'existing', running = false, shownText = '';
  // The page's own review filter rewrites "x of y shown" for the (empty) generated list; keep the saved list's count.
  new MutationObserver(() => { const el = $('reviewFilterSummary'); if (active && $('existingCases') && shownText && el && el.textContent !== shownText) el.textContent = shownText; })
    .observe(document.body, { childList: true, characterData: true, subtree: true });
  const cards = () => [...document.querySelectorAll('#existingCases .case')];
  const checks = () => [...document.querySelectorAll('#existingCases .ex-check:not(:disabled)')];

  function summary() {
    const visible = cards().filter((c) => !c.hidden).length, total = cards().length, selected = checks().filter((c) => c.checked).length;
    shownText = visible + ' of ' + total + ' shown';
    if ($('reviewFilterSummary')) $('reviewFilterSummary').textContent = shownText;
    if ($('caseCount')) $('caseCount').textContent = total;
    const btn = $('existingRunBtn');
    if (btn) { btn.disabled = running || !selected; btn.textContent = running ? 'Running…' : 'Start Tests' + (selected ? ' (' + selected + ')' : ''); }
    const hint = $('runHint'); if (hint) hint.textContent = selected ? selected + ' saved test case' + (selected === 1 ? '' : 's') + ' selected.' : 'Select the saved test cases you want to run.';
  }

  function filter() {
    const q = String($('reviewSearch')?.value || '').trim().toLowerCase();
    // The box's filter dropdowns start on "ALL" (no filter).
    const pick = (id) => { const v = String($(id)?.value || ''); return /^all$/i.test(v) ? '' : v; };
    const type = pick('reviewType').toLowerCase(), cat = pick('reviewCategory').toUpperCase(), pri = pick('reviewPriority').toLowerCase();
    for (const c of cards()) {
      c.hidden = (q && !c.dataset.text.includes(q)) || (type && c.dataset.type !== type) || (cat && c.dataset.category !== cat) || (pri && c.dataset.priority !== pri);
    }
    summary();
  }

  // One list of unique, runnable tests (the server removes repeats and cases that cannot run).
  function render() {
    const host = $('existingCases');
    // From a task: list only that task's failed test case.
    if (onlyCase && data.cases.some((tc) => String(tc.id).toUpperCase() === onlyCase)) data.cases = data.cases.filter((tc) => String(tc.id).toUpperCase() === onlyCase);
    if (!data.cases.length) { host.innerHTML = '<div class="ex-empty">No saved test cases are ready to run for this ' + (storyId ? 'story' : 'project') + '. Generate test cases from step 1.</div>'; summary(); return; }
    const envOptions = data.environments.map((e) => '<option value="' + esc(e.id) + '"' + (handoff.environmentId && String(handoff.environmentId) === String(e.id) || (!handoff.environmentId && e.is_default) ? ' selected' : '') + '>' + esc(e.name) + '</option>').join('');
    host.innerHTML = '<div class="ex-bar"><span><b>Saved test cases</b> · ' + data.cases.length + ' unique test' + (data.cases.length === 1 ? '' : 's') + ', ready to run. No generation needed.</span>'
      + (data.environments.length ? '<label>Run on <select id="existingEnv" aria-label="Environment to run on">' + envOptions + '</select></label>' : '') + '</div>'
      + data.cases.map((tc, i) => {
        const type = String(tc.type || 'functional').toLowerCase(), typeClass = ['negative', 'positive', 'functional', 'boundary', 'custom'].includes(type) ? 'type-' + type : 'type-functional';
        const text = (tc.id + ' ' + tc.title + ' ' + tc.expected + ' ' + (tc.story || '')).toLowerCase();
        return '<div class="case ' + typeClass + '" data-text="' + esc(text) + '" data-type="' + esc(type) + '" data-category="' + esc(String(tc.category || '').toUpperCase()) + '" data-priority="' + esc(String(tc.priority || '').toLowerCase()) + '">'
          + '<input class="ex-check" type="checkbox" value="' + i + '" aria-label="Select ' + esc(tc.id + ' ' + tc.title) + '">'
          + '<div><div class="case-title">' + esc(tc.id) + ' — ' + esc(tc.title) + '</div><div class="case-meta"><span class="tag ' + typeClass + '">' + esc(type) + '</span><span class="tag">' + esc(tc.priority || 'medium') + '</span><span class="tag">' + (/^human/i.test(String(tc.source || '')) ? 'Manual' : 'AI / Reviewed') + '</span><span>' + tc.steps + ' steps</span>' + (tc.story ? '<span>' + esc(tc.story) + '</span>' : '') + '</div>'
          + (tc.expected ? '<div class="expected">Expected: ' + esc(tc.expected) + '</div>' : '') + '</div></div>';
      }).join('');
    if (onlyCase) {
      const i = data.cases.findIndex((tc) => String(tc.id).toUpperCase() === onlyCase);
      const bar = host.querySelector('.ex-bar span');
      if (i >= 0) {
        const box = host.querySelector('.ex-check[value="' + i + '"]'); if (box) box.checked = true;
        if (bar) bar.innerHTML = '<b>Re-run the failed test ' + esc(onlyCase) + '</b> · it is ticked below. Press Start Tests.';
      } else if (bar) bar.innerHTML = '<b>' + esc(onlyCase) + ' cannot run as saved</b> (it is not Automation Ready). Generate it again or fix it with AI, then run.';
    }
    filter();
  }

  function enter() {
    active = true;
    const cases = $('cases'); if (!cases || $('existingCases')) return;
    cases.hidden = true;
    const host = document.createElement('div'); host.id = 'existingCases'; host.innerHTML = '<div class="ex-empty">Loading saved test cases…</div>';
    cases.after(host);
    if ($('caseSubtitle')) $('caseSubtitle').textContent = 'Saved test cases of this ' + (storyId ? 'story' : 'project') + '. Select the ones to run.';
    const run = $('runBtn');
    if (run && !$('existingRunBtn')) {
      const btn = document.createElement('button'); btn.type = 'button'; btn.id = 'existingRunBtn'; btn.className = run.className; btn.textContent = 'Start Tests'; btn.disabled = true;
      run.after(btn); document.body.classList.add('tn-existing-mode'); // the page's own button stays hidden in this mode
      btn.addEventListener('click', start);
    }
    call('/api/projects/' + encodeURIComponent(projectId) + '/existing-tests' + (onlySession ? '?sessionId=' + encodeURIComponent(onlySession) : storyId ? '?storyId=' + encodeURIComponent(storyId) : ''))
      .then((d) => { data = d; render(); })
      .catch((e) => { host.innerHTML = '<div class="ex-empty">' + esc(e.message) + '</div>'; });
  }

  function leave() {
    active = false;
    $('existingCases')?.remove(); $('existingRunBtn')?.remove();
    if ($('cases')) $('cases').hidden = false;
    document.body.classList.remove('tn-existing-mode');
    try { sessionStorage.removeItem('testnexus:existingHandoff'); } catch {}
    if (projectId) setUrl('new'); else history.replaceState(null, '', location.pathname);
  }

  async function start() {
    if (running) return;
    const bySession = new Map();
    for (const c of checks().filter((x) => x.checked)) { const tc = data.cases[Number(c.value)]; if (!tc) continue; if (!bySession.has(tc.sessionId)) bySession.set(tc.sessionId, { set: { sessionId: tc.sessionId, environment: tc.environment, story: tc.story }, ids: [] }); bySession.get(tc.sessionId).ids.push(tc.id); }
    const chosen = [...bySession.values()];
    const total = chosen.reduce((n, x) => n + x.ids.length, 0); if (!total) return;
    const envId = $('existingEnv')?.value || '', envName = data.environments.find((e) => String(e.id) === String(envId))?.name || '';
    running = true; summary();
    let doneBefore = 0, passed = 0, failed = 0, notRun = 0; const errors = [];
    const popup = (cur, finished) => window.TNRunPopup?.show({
      title: finished ? (failed ? 'Completed with failures' : notRun ? 'Completed · ' + notRun + ' could not run' : 'Completed') : 'Running saved tests', total,
      completed: doneBefore + Number(cur?.completed || 0), passed: passed + Number(cur?.passed || 0), failed: failed + Number(cur?.failed || 0), notRun, finished,
      note: finished ? (errors.length ? 'Could not run: ' + errors[0] : 'Saved in Runs & reports.') : 'You can keep working while the tests run.',
    });
    popup(null, false);
    for (const { set, ids } of chosen) {
      try {
        if (envName && envName !== set.environment) await call('/api/projects/' + encodeURIComponent(projectId) + '/sessions/' + encodeURIComponent(set.sessionId) + '/environment', { method: 'POST', body: JSON.stringify({ environmentId: envId }) });
        await call('/api/test-runs/start', { method: 'POST', body: JSON.stringify({ sessionId: set.sessionId, approvedIds: ids }) });
        let cur = {};
        for (let i = 0; i < 480; i++) {
          await new Promise((r) => setTimeout(r, 2500));
          cur = (await call('/api/test-runs/progress/' + encodeURIComponent(set.sessionId))).progress || {};
          popup(cur, false);
          if (cur.complete) break;
        }
        doneBefore += Number(cur.completed || ids.length); passed += Number(cur.passed || 0); failed += Number(cur.failed || 0);
      } catch (e) { errors.push(ids.join(', ') + ' — ' + e.message); doneBefore += ids.length; notRun += ids.length; }
    }
    running = false; summary(); popup({}, true);
    if ($('mTotal')) $('mTotal').textContent = doneBefore;
    if ($('mPassed')) $('mPassed').textContent = passed;
    if ($('mFailed')) $('mFailed').textContent = failed;
    if ($('mRate')) $('mRate').textContent = (doneBefore ? Math.round(passed / doneBefore * 100) : 0) + '%';
    if ($('results')) $('results').innerHTML = '<div class="activity-alert">Saved tests finished: ' + passed + ' passed, ' + failed + ' failed' + (notRun ? ', ' + notRun + ' could not run' : '') + '.'
      + (errors.length ? '<small>' + errors.map(esc).join('<br>') + '</small>' : '') + '<small><a href="/workspace.html?projectId=' + encodeURIComponent(projectId) + '#executions">Open Runs &amp; reports</a> to see each run, its screenshots and reports.</small></div>';
  }

  // The box's own controls act on the saved list while this mode is on.
  document.addEventListener('click', (e) => {
    if (!active || !$('existingCases')) return;
    const all = e.target.closest('#selectAllCasesBtn'), none = e.target.closest('#deselectAllCasesBtn');
    if (all || none) { e.preventDefault(); e.stopImmediatePropagation(); for (const c of checks()) if (!c.closest('.case').hidden) c.checked = !!all; summary(); return; }
    if (e.target.closest('#reviewClearFilters')) setTimeout(filter, 0);
    if (e.target.closest('#generateBtn')) leave(); // generating new cases: back to the normal page
  }, true);
  document.addEventListener('change', (e) => {
    if (!active || !$('existingCases')) return;
    if (e.target.matches('#reviewType,#reviewCategory,#reviewPriority')) setTimeout(filter, 0);
    setTimeout(summary, 0);
  });
  document.addEventListener('input', (e) => { if (active && e.target.matches('#reviewSearch')) setTimeout(filter, 0); });

  // No mode in the address: ask once, if the project already has saved test cases that can run.
  async function ask() {
    const c = window.testnexusRunnerContext || {};
    projectId = projectId || c.projectId || $('platformProject')?.value || ''; storyId = storyId || c.storyId || '';
    let sid = null; try { sid = typeof sessionId !== 'undefined' ? sessionId : null; } catch {}
    if (!projectId || sid) return;
    let d; try { d = await call('/api/projects/' + encodeURIComponent(projectId) + '/existing-tests' + (storyId ? '?storyId=' + encodeURIComponent(storyId) : '')); } catch { return; }
    if (!d.cases?.length) { setUrl('new'); return; }
    const manual = d.cases.filter((x) => /^human/i.test(String(x.source || ''))).length;
    const box = document.createElement('dialog');
    box.className = 'tn-start-choice';
    box.innerHTML = '<style>.tn-start-choice{border:0;border-radius:16px;padding:0;width:min(520px,calc(100vw - 32px));box-shadow:0 24px 60px rgba(15,23,42,.3);font-family:inherit}.tn-start-choice::backdrop{background:rgba(15,23,42,.45)}.tn-start-choice .h{padding:18px 20px 6px;font-size:17px;font-weight:800;color:#0f172a}.tn-start-choice .s{padding:0 20px 14px;font-size:13px;color:#64748b}.tn-start-choice .opts{display:grid;gap:10px;padding:0 20px 20px}.tn-start-choice button{display:grid;gap:3px;text-align:left;padding:14px 16px;border:1px solid #e2e8f0;border-radius:12px;background:#fff;cursor:pointer;font:inherit}.tn-start-choice button:hover,.tn-start-choice button:focus-visible{border-color:#2563eb;background:#eff6ff;outline:0}.tn-start-choice b{font-size:14.5px;color:#0f172a}.tn-start-choice span{font-size:12.5px;color:#64748b}</style>'
      + '<div class="h">How do you want to start?</div><div class="s">This ' + (storyId ? 'story' : 'project') + ' already has saved test cases.</div>'
      + '<div class="opts"><button type="button" data-start="existing"><b>▶ Use existing test cases (' + d.cases.length + ')</b><span>Pick from the saved test cases' + (manual ? ' (' + manual + ' manual)' : '') + ' and run them. No generation needed.</span></button>'
      + '<button type="button" data-start="new"><b>✨ Fresh start</b><span>Generate new test cases with AI, or add your own with ⊕.</span></button></div>';
    document.body.appendChild(box);
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-start]'); if (!b) return;
      box.close(); box.remove();
      if (b.dataset.start === 'existing') { setUrl('existing'); remember(); enter(); } else setUrl('new');
    });
    box.addEventListener('cancel', () => { setUrl('new'); box.remove(); });
    box.showModal();
  }

  function boot() {
    if (mode === 'existing') { remember(); [300, 1200].forEach((d) => setTimeout(enter, d)); }
    else setTimeout(ask, 2500); // after the page has set up its project
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();

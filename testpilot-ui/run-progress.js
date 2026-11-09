// Run progress popup — floats over the screen (bottom-right), does not block the page.
// A ring fills while tests run: green = passed, red = failed, grey = still to run, with the count in the middle ("2/3").
// When the run ends it shows a green "Completed" (or red "Completed with failures") with the totals and a Close button.
// Used by the testing page (reads the server's progress for the current session every 2 seconds while a run is going)
// and by Runs & reports re-runs (window.TNRunPopup.show). It never changes how tests run.
(function () {
  if (window.TNRunPopup) return;

  const style = document.createElement('style');
  style.textContent = `
.tn-run-pop{position:fixed;right:max(24px,env(safe-area-inset-right,0px));bottom:max(24px,env(safe-area-inset-bottom,0px));z-index:2000;width:min(340px,calc(100vw - 32px));padding:16px 18px 14px;border-radius:18px;background:#fff;border:1px solid #e2e8f0;box-shadow:0 18px 50px rgba(15,23,42,.22);font-family:inherit;color:#0f172a;animation:tnPopIn .25s ease-out}
.tn-run-pop[hidden]{display:none}
.tn-run-pop .head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}
.tn-run-pop .title{display:flex;align-items:center;gap:8px;font-size:14.5px;font-weight:800}
.tn-run-pop .close{border:0;background:#f1f5f9;width:28px;height:28px;border-radius:8px;font-size:16px;line-height:1;color:#475569;cursor:pointer}
.tn-run-pop .close:hover{background:#e2e8f0}
.tn-run-pop .body{display:flex;align-items:center;gap:18px}
.tn-run-pop .ring{position:relative;width:104px;height:104px;flex:none}
.tn-run-pop .ring svg{width:104px;height:104px;transform:rotate(-90deg)}
.tn-run-pop .ring circle{fill:none;stroke-width:10}
.tn-run-pop .ring .track{stroke:#e2e8f0}
.tn-run-pop .ring .pass{stroke:#16a34a;transition:stroke-dasharray .5s ease,stroke-dashoffset .5s ease}
.tn-run-pop .ring .fail{stroke:#dc2626;transition:stroke-dasharray .5s ease,stroke-dashoffset .5s ease}
.tn-run-pop .ring .skip{stroke:#f59e0b;transition:stroke-dasharray .5s ease,stroke-dashoffset .5s ease}
.tn-run-pop .legend .notrun[hidden]{display:none}
.tn-run-pop.done-warn{border-color:#fcd34d;background:linear-gradient(180deg,#fffbeb,#fff 60%)}
.tn-run-pop .warn{color:#b45309}
.tn-run-pop .ring .center{position:absolute;inset:0;display:grid;place-content:center;text-align:center}
.tn-run-pop .ring .count{font-size:22px;font-weight:800;letter-spacing:-.5px}
.tn-run-pop .ring .pct{font-size:11px;color:#64748b;font-weight:600}
.tn-run-pop .legend{display:grid;gap:7px;font-size:13px;min-width:0}
.tn-run-pop .legend span{display:flex;align-items:center;gap:8px}
.tn-run-pop .legend i{width:10px;height:10px;border-radius:50%;flex:none}
.tn-run-pop .legend b{margin-left:auto;font-weight:800}
.tn-run-pop .note{margin-top:12px;font-size:12px;color:#64748b}
.tn-run-pop .dot{width:9px;height:9px;border-radius:50%;background:#2563eb;animation:tnPulse 1.2s infinite}
.tn-run-pop.done-pass{border-color:#86efac;background:linear-gradient(180deg,#f0fdf4,#fff 60%)}
.tn-run-pop.done-fail{border-color:#fca5a5;background:linear-gradient(180deg,#fef2f2,#fff 60%)}
.tn-run-pop .ok{color:#15803d}.tn-run-pop .bad{color:#b91c1c}
@keyframes tnPulse{0%,100%{opacity:1}50%{opacity:.25}}
@keyframes tnPopIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.tn-run-pop{animation:none}.tn-run-pop .dot{animation:none}.tn-run-pop .ring .pass,.tn-run-pop .ring .fail{transition:none}}`;
  document.head.appendChild(style);

  const R = 44, C = 2 * Math.PI * R;
  let pop = null;
  function el() {
    if (pop) return pop;
    pop = document.createElement('div');
    pop.className = 'tn-run-pop';
    pop.hidden = true;
    pop.setAttribute('role', 'status');
    pop.setAttribute('aria-live', 'polite');
    pop.innerHTML = '<div class="head"><span class="title"></span><button type="button" class="close" aria-label="Close">×</button></div>'
      + '<div class="body"><div class="ring" aria-hidden="true"><svg viewBox="0 0 104 104"><circle class="track" cx="52" cy="52" r="' + R + '"/><circle class="pass" cx="52" cy="52" r="' + R + '"/><circle class="fail" cx="52" cy="52" r="' + R + '"/><circle class="skip" cx="52" cy="52" r="' + R + '"/></svg><div class="center"><span class="count"></span><span class="pct"></span></div></div>'
      + '<div class="legend"><span><i style="background:#16a34a"></i>Passed<b class="p"></b></span><span><i style="background:#dc2626"></i>Failed<b class="f"></b></span><span class="notrun" hidden><i style="background:#f59e0b"></i>Could not run<b class="n"></b></span><span><i style="background:#cbd5e1"></i>Remaining<b class="r"></b></span></div></div>'
      + '<div class="note"></div>';
    pop.querySelector('.close').onclick = () => { pop.hidden = true; };
    document.body.appendChild(pop);
    return pop;
  }
  const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // show({title, total, completed, passed, failed, notRun, finished, note}) — notRun: tests that could not start (not passed, not failed)
  function show(o) {
    const p = el(), total = Math.max(0, Number(o.total || 0)), done = Math.min(total, Number(o.completed || 0));
    const passed = Number(o.passed || 0), failed = Number(o.failed || 0), notRun = Number(o.notRun || 0), finished = !!o.finished;
    if (!total) { p.hidden = true; return; }
    const lenP = total ? C * Math.min(1, passed / total) : 0, lenF = total ? C * Math.min(1, failed / total) : 0;
    const pass = p.querySelector('.pass'), fail = p.querySelector('.fail');
    pass.style.strokeDasharray = lenP + ' ' + C;
    fail.style.strokeDasharray = lenF + ' ' + C;
    fail.style.strokeDashoffset = String(-lenP);
    const lenN = total ? C * Math.min(1, notRun / total) : 0, skip = p.querySelector('.skip');
    skip.style.strokeDasharray = lenN + ' ' + C; skip.style.strokeDashoffset = String(-(lenP + lenF));
    p.querySelector('.n').textContent = notRun; p.querySelector('.notrun').hidden = !notRun;
    p.querySelector('.count').textContent = done + '/' + total;
    p.querySelector('.pct').textContent = Math.round(done / total * 100) + '%';
    p.querySelector('.p').textContent = passed;
    p.querySelector('.f').textContent = failed;
    p.querySelector('.r').textContent = Math.max(0, total - done);
    p.classList.toggle('done-pass', finished && failed === 0 && notRun === 0);
    p.classList.toggle('done-fail', finished && failed > 0);
    p.classList.toggle('done-warn', finished && failed === 0 && notRun > 0);
    p.querySelector('.title').innerHTML = finished
      ? (failed ? '<span class="bad">✕</span> ' + esc(o.title || 'Completed with failures') : notRun ? '<span class="warn">!</span> ' + esc(o.title || 'Completed') : '<span class="ok">✓</span> ' + esc(o.title || 'Completed'))
      : '<span class="dot" aria-hidden="true"></span> ' + esc(o.title || 'Running tests');
    p.querySelector('.note').textContent = o.note || (finished ? done + ' test' + (done === 1 ? '' : 's') + ' finished.' : 'You can keep working while the tests run.');
    p.hidden = false;
  }
  window.TNRunPopup = { show, hide: () => { if (pop) pop.hidden = true; } };

  // ---- Testing page: follow the current run ----
  const statusEl = () => document.getElementById('runStatus');
  if (!statusEl()) return;
  const statusText = () => String(statusEl()?.textContent || '').trim().toLowerCase();
  const isRunning = () => /^(starting|running|finalizing)/.test(statusText());
  const currentSession = () => { try { return typeof sessionId !== 'undefined' ? sessionId : null; } catch { return null; } };
  const token = () => { try { return sessionStorage.getItem('aiTestPilotToken') || localStorage.getItem('aiTestPilotToken') || ''; } catch { return ''; } };
  async function read() {
    const id = currentSession(); if (!id) return null;
    const r = await fetch('/api/test-runs/progress/' + encodeURIComponent(id), { headers: { Authorization: 'Bearer ' + token() } });
    if (!r.ok) return null;
    return (await r.json()).progress || null;
  }
  let wasRunning = false;
  setInterval(async () => {
    try {
      if (isRunning()) { const p = await read(); if (p) show({ ...p, title: 'Running tests' }); wasRunning = true; }
      else if (wasRunning) {
        wasRunning = false; const p = await read();
        if (p) show({ ...p, completed: p.completed || p.total, finished: true, title: Number(p.failed) ? 'Completed with failures' : 'Completed', note: 'Results and the AI report are ready below.' });
      }
    } catch { /* progress is optional; the run itself is unaffected */ }
  }, 2000);
})();

// Shared confirmation popup for destructive actions (delete, remove, detach, disable).
// Usage: if (await TestNexusConfirm({ title, message, note, confirmLabel, tone })) { ...do it... }
// tone: 'danger' (red, default) or 'warning' (amber). Cancel is focused first, so Enter never deletes by accident.
(function () {
  if (window.TestNexusConfirm) return;

  const ICONS = {
    danger: '<path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7M10 11v5m4-5v5"/>',
    warning: '<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17.5v.01"/>',
  };

  function injectStyles() {
    if (document.getElementById('tncStyles')) return;
    const s = document.createElement('style');
    s.id = 'tncStyles';
    s.textContent = `
      .tnc{width:min(460px,calc(100vw - 32px));padding:0;border:0;border-radius:14px;box-shadow:0 24px 60px rgba(15,23,42,.3);color:#0f172a;font-family:Inter,system-ui,-apple-system,"Segoe UI",Arial,sans-serif}
      .tnc::backdrop{background:rgba(15,23,42,.45)}
      .tnc-body{display:flex;gap:14px;padding:22px 22px 8px}
      .tnc-icon{flex:0 0 44px;width:44px;height:44px;border-radius:50%;display:grid;place-items:center;background:#fef2f2;color:#dc2626}
      .tnc.warning .tnc-icon{background:#fffbeb;color:#d97706}
      .tnc h2{margin:2px 0 6px;font-size:17px;font-weight:600;color:#0f172a}
      .tnc p{margin:0 0 6px;font-size:13.5px;line-height:1.5;color:#334155}
      .tnc p.tnc-note{font-size:12.5px;color:#64748b}
      .tnc-foot{display:flex;justify-content:flex-end;gap:8px;padding:8px 22px 20px}
      .tnc-btn{height:38px;padding:0 16px;border-radius:8px;font:inherit;font-size:13px;font-weight:600;cursor:pointer}
      .tnc-cancel{border:1px solid #cbd5e1;background:#fff;color:#334155}
      .tnc-cancel:hover{background:#f1f5f9}
      .tnc-ok{border:0;background:#dc2626;color:#fff}
      .tnc-ok:hover{background:#b91c1c}
      .tnc.warning .tnc-ok{background:#d97706}
      .tnc.warning .tnc-ok:hover{background:#b45309}
      .tnc-btn:focus-visible{outline:3px solid #93b0ff;outline-offset:2px}
    `;
    document.head.appendChild(s);
  }

  function dialog() {
    let d = document.getElementById('tncDialog');
    if (d) return d;
    injectStyles();
    d = document.createElement('dialog');
    d.id = 'tncDialog';
    d.className = 'tnc';
    d.setAttribute('aria-labelledby', 'tncTitle');
    d.setAttribute('aria-describedby', 'tncMessage');
    d.innerHTML = '<div class="tnc-body"><span class="tnc-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" id="tncIcon"></svg></span>'
      + '<div><h2 id="tncTitle"></h2><p id="tncMessage"></p><p class="tnc-note" id="tncNote"></p></div></div>'
      + '<div class="tnc-foot"><button type="button" class="tnc-btn tnc-cancel" id="tncCancel">Cancel</button><button type="button" class="tnc-btn tnc-ok" id="tncOk">Delete</button></div>';
    document.body.appendChild(d);
    return d;
  }

  window.TestNexusConfirm = function ({ title = 'Are you sure?', message = '', note = '', confirmLabel = 'Delete', tone = 'danger' } = {}) {
    const d = dialog();
    d.classList.toggle('warning', tone === 'warning');
    d.querySelector('#tncIcon').innerHTML = ICONS[tone] || ICONS.danger;
    d.querySelector('#tncTitle').textContent = title;
    d.querySelector('#tncMessage').textContent = message;
    const n = d.querySelector('#tncNote');
    n.textContent = note;
    n.hidden = !note;
    const ok = d.querySelector('#tncOk'), cancel = d.querySelector('#tncCancel');
    ok.textContent = confirmLabel;
    return new Promise((resolve) => {
      const done = (value) => { ok.onclick = cancel.onclick = d.oncancel = d.onclick = null; if (d.open) d.close(); resolve(value); };
      ok.onclick = () => done(true);
      cancel.onclick = () => done(false);
      d.oncancel = (e) => { e.preventDefault(); done(false); };
      d.onclick = (e) => { if (e.target === d) done(false); };
      d.showModal();
      cancel.focus();
    });
  };
})();

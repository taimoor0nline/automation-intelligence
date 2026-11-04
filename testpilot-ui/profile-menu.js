// Shared profile menu for the navy top bar (project workspace and management pages):
// avatar ▾ -> name, email, role, Sign out. Same look as the profile menu on the testing page (top-bar.js).
(function () {
  if (window.TestNexusProfileMenu) return;

  const ROLE_LABELS = { MANAGER: 'Manager', PROJECT_MANAGER: 'Project manager', QA: 'QA', DEVELOPER: 'Developer', VIEWER: 'Viewer', ADMIN: 'Admin' };

  function injectStyles() {
    if (document.getElementById('tnProfileMenuStyles')) return;
    const s = document.createElement('style');
    s.id = 'tnProfileMenuStyles';
    s.textContent = `
      .tnp{position:relative;display:inline-flex;flex:0 0 auto}
      .tnp-trigger{display:inline-flex;align-items:center;gap:8px;height:40px;padding:0 8px;border:0;border-radius:8px;background:none;color:#fff;font:inherit;font-size:13.5px;font-weight:500;cursor:pointer}
      .tnp-trigger:hover,.tnp.open .tnp-trigger{background:rgba(255,255,255,.12);color:#fff}
      .tnp-trigger:focus-visible{outline:3px solid #93b0ff;outline-offset:2px}
      .tnp-avatar{display:grid;place-items:center;width:30px;height:30px;flex:0 0 30px;border-radius:50%;background:#60a5fa;color:#0f1f5c;font-size:12px;font-weight:700;box-shadow:0 0 0 2px rgba(255,255,255,.35)}
      .tnp-caret{font-size:9px;opacity:.8}
      .tnp-panel{display:none;position:absolute;top:calc(100% + 8px);right:0;min-width:250px;padding:6px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;box-shadow:0 14px 34px rgba(15,23,42,.22);z-index:300;text-align:left}
      .tnp.open .tnp-panel{display:block}
      .tnp-who{padding:9px 11px 6px}
      .tnp-who b{display:block;color:#0f172a;font-size:13px;font-weight:600}
      .tnp-who small{display:block;color:#64748b;font-size:11px;margin-top:2px}
      .tnp-role{display:inline-block;margin-top:6px;padding:2px 7px;border-radius:999px;background:#e0e7ff;color:#3730a3;font-size:10px;font-weight:700}
      .tnp-panel hr{border:0;border-top:1px solid #eef1f6;margin:6px 4px}
      .tnp-signout{display:block;width:100%;padding:9px 11px;border:0;border-radius:7px;background:none;color:#b91c1c;font:inherit;font-size:12.5px;font-weight:600;text-align:left;cursor:pointer}
      .tnp-signout:hover{background:#fee2e2;color:#991b1b}
      @media(max-width:600px){.tnp-name{display:none}}
    `;
    document.head.appendChild(s);
  }

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  // Replaces `target` (an element or its id) with the profile menu for `user`.
  function mount(target, user = {}, { signOutHref = '/logout.html' } = {}) {
    const node = typeof target === 'string' ? document.getElementById(target) : target;
    if (!node) return null;
    injectStyles();
    const name = user.name || user.display_name || user.email || 'User';
    const initials = name.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || 'U';
    const role = String(user.role || '').toUpperCase();

    const wrap = el('div', 'tnp');
    wrap.id = node.id || '';
    const trigger = el('button', 'tnp-trigger');
    trigger.type = 'button';
    trigger.title = name;
    trigger.setAttribute('aria-haspopup', 'true');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.append(el('span', 'tnp-avatar', initials), el('span', 'tnp-name', name), el('span', 'tnp-caret', '▾'));

    const panel = el('div', 'tnp-panel');
    const who = el('div', 'tnp-who');
    who.append(el('b', '', name), el('small', '', user.email || ''));
    if (role) who.append(el('span', 'tnp-role', ROLE_LABELS[role] || role));
    const signOut = el('button', 'tnp-signout', 'Sign out');
    signOut.type = 'button';
    signOut.onclick = () => location.assign(signOutHref);
    panel.append(who, el('hr'), signOut);

    const setOpen = (open) => { wrap.classList.toggle('open', open); trigger.setAttribute('aria-expanded', String(open)); };
    trigger.onclick = (e) => { e.stopPropagation(); setOpen(!wrap.classList.contains('open')); };
    document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) setOpen(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });

    wrap.append(trigger, panel);
    node.replaceWith(wrap);
    return wrap;
  }

  window.TestNexusProfileMenu = { mount };
})();

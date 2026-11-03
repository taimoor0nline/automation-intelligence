// Shared global top bar for every signed-in page:
//   Logo | [Project ▾] | Dashboard  Projects  Start Testing  Test Cases  Test Runs  Tasks  Reports  Administration | Profile ▾
// Dashboard -> Reports, Projects -> project setup (manager) / project switcher, Test Cases / Test Runs -> sections on the testing page.
// Existing actions (Defects, Users, Platform setup) reuse the original buttons/popups on the Start Testing page.
(function () {
  if (window.__testNexusTopBar) return;
  window.__testNexusTopBar = true;

  const TOKEN_KEY = 'aiTestPilotToken';
  const path = location.pathname;
  const page = path === '/rest.html' ? 'rest'
    : path === '/reports.html' ? 'reports'
    : path === '/work.html' ? 'work'
    : 'web';

  function injectStyles() {
    if (document.getElementById('testNexusTopBarStyles')) return;
    const s = document.createElement('style');
    s.id = 'testNexusTopBarStyles';
    s.textContent = `
      header.tn-header{height:auto!important;min-height:60px;gap:18px;padding:0 20px!important;background:#0f1f5c!important;border-bottom:1px solid #0f1f5c!important;color:#fff;flex-wrap:nowrap}
      header.tn-header .brand{flex:0 0 auto}
      header.tn-header .brand strong,header.tn-header .brand b{color:#fff;white-space:nowrap}
      header.tn-header .brand span{display:none!important}
      header.tn-header .logo{background:#fff!important;color:#1e3a8a!important}
      #tnNav{display:flex;align-items:stretch;gap:2px;flex:1 1 auto;min-width:0;flex-wrap:wrap}
      .tn-menu{position:relative;display:flex}
      .tn-item{display:flex;align-items:center;gap:5px;height:60px;padding:0 12px;border:0;border-bottom:3px solid transparent;background:none;color:#dbe4ff;font:inherit;font-size:13px;font-weight:700;white-space:nowrap;cursor:pointer}
      .tn-item:hover:not(:disabled),.tn-menu.open>.tn-item{color:#fff;background:rgba(255,255,255,.08)}
      .tn-item.active{color:#fff;border-bottom-color:#60a5fa}
      .tn-item:disabled{color:rgba(219,228,255,.45);cursor:not-allowed}
      .tn-caret{font-size:9px;opacity:.8}
      .tn-panel{display:none;position:absolute;top:100%;left:0;min-width:200px;padding:6px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;box-shadow:0 14px 34px rgba(15,23,42,.22);z-index:200}
      .tn-panel.right{left:auto;right:0}
      .tn-menu.open>.tn-panel{display:block}
      .tn-panel button{display:block;width:100%;padding:9px 11px;border:0;border-radius:7px;background:none;color:#1e293b;font:inherit;font-size:12.5px;font-weight:650;text-align:left;cursor:pointer}
      .tn-panel button:hover{background:#eef2ff;color:#1d4ed8}
      .tn-panel button.current{color:#1d4ed8}
      .tn-panel hr{border:0;border-top:1px solid #eef1f6;margin:6px 4px}
      #tnRight{display:flex;align-items:center;gap:12px;margin-left:auto;flex:0 0 auto}
      #tnProject{flex:0 0 auto;align-items:center;padding-right:14px;border-right:1px solid rgba(255,255,255,.2)}
      #tnProject>.tn-btn{display:flex;align-items:center;gap:8px;max-width:240px;padding:7px 11px;border:1px solid rgba(255,255,255,.35);border-radius:9px;background:rgba(255,255,255,.1);color:#fff;font:inherit;font-size:12.5px;font-weight:700;cursor:pointer}
      #tnProject>.tn-btn:hover,#tnProject.open>.tn-btn{background:rgba(255,255,255,.2);border-color:#fff}
      #tnProject .tn-btn-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #tnProject .tn-btn-kicker{color:#93c5fd;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.4px}
      #tnProject .tn-panel{top:calc(100% + 8px);min-width:290px;padding:12px}
      #tnProject .tn-field+.tn-field{margin-top:10px}
      #tnProject .tn-field label{display:block;margin:0 0 5px;color:#475569;font-size:11px;font-weight:800}
      #tnProject .tn-field select{width:100%;margin:0;padding:8px 9px;border:1px solid #d0d5dd;border-radius:8px;background:#fff;color:#10141c;font-size:12.5px}
      #tnProject .tn-hint{margin-top:9px;color:#64748b;font-size:11px;line-height:1.45}
      .tn-avatar{display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:#60a5fa;color:#0f1f5c;font-size:12px;font-weight:900}
      #tnProfile>.tn-item{height:60px;gap:8px}
      .tn-who{padding:9px 11px 6px}
      .tn-who b{display:block;color:#0f172a;font-size:13px}
      .tn-who small{display:block;color:#64748b;font-size:11px;margin-top:2px}
      .tn-role{display:inline-block;margin-top:6px;padding:2px 7px;border-radius:999px;background:#e0e7ff;color:#3730a3;font-size:9.5px;font-weight:800}
      #tnProfile .tn-panel{min-width:250px}
      #tnProfile .tn-panel .status{display:flex;margin:4px 6px;padding:7px 9px;border-radius:8px;border:1px solid #e2e8f0!important;background:#f8fafc!important;color:#475569!important;font-size:11px}
      #tnProfile .tn-signout{color:#b91c1c}
      #tnProfile .tn-signout:hover{background:#fee2e2;color:#991b1b}
      @media(max-width:1280px){header.tn-header{flex-wrap:wrap!important;padding:8px 16px!important;row-gap:4px}#tnNav{order:3;flex-basis:100%}.tn-item,#tnProfile>.tn-item{height:42px}}
    `;
    document.head.appendChild(s);
  }

  function token() { return sessionStorage.getItem(TOKEN_KEY) || ''; }
  function goLogin() { sessionStorage.removeItem(TOKEN_KEY); location.replace('/login'); }
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  async function health() {
    try {
      if (typeof window.aiTestPilotGetHealth === 'function') return await window.aiTestPilotGetHealth();
      const r = await fetch('/health');
      return r.ok ? await r.json() : null;
    } catch { return null; }
  }

  function waitFor(id, ms) {
    return new Promise((resolve) => {
      const found = document.getElementById(id);
      if (found) return resolve(found);
      const obs = new MutationObserver(() => { const e = document.getElementById(id); if (e) { obs.disconnect(); resolve(e); } });
      obs.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => { obs.disconnect(); resolve(document.getElementById(id)); }, ms);
    });
  }

  // Each page keeps its own project dropdown (same element, same handlers); it is only moved into the top bar.
  const PROJECT_SELECT = { web: 'platformProject', rest: 'project', work: 'project' };
  const REPO_SELECT = { web: 'platformRepo', rest: 'repository' };
  function currentProjectId() {
    const id = PROJECT_SELECT[page];
    return id ? (document.getElementById(id)?.value || '') : '';
  }

  // The Web UI test page lives at /runner ("/" now opens the sign-in page).
  const TESTING_PAGE = '/runner';

  // On the Start Testing page, click the original button (opens its popup); elsewhere go there and open it.
  function openOnTestingPage(buttonId, hash) {
    const b = page === 'web' ? document.getElementById(buttonId) : null;
    if (b) b.click(); else location.href = TESTING_PAGE + hash;
  }
  function go(url) { location.href = url; }

  // Test Cases -> "2. Review test cases", Test Runs -> "3. Execution & analytics" on the testing pages.
  const SECTION = { 'test-cases': ['cases'], 'test-runs': ['runStatus', 'runState'] };
  function scrollToSection(key) {
    const anchor = SECTION[key].map((id) => document.getElementById(id)).find(Boolean);
    const section = anchor?.closest('section');
    if (!section) return false;
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return true;
  }
  function openSection(key) { if (!scrollToSection(key)) go(TESTING_PAGE + '#' + key); }

  function closeMenus(except) {
    document.querySelectorAll('.tn-menu.open').forEach((m) => { if (m !== except) m.classList.remove('open'); });
  }

  function navItem(label, opts = {}) {
    const b = el('button', 'tn-item' + (opts.active ? ' active' : ''), label);
    b.type = 'button';
    if (opts.active) b.setAttribute('aria-current', 'page');
    if (opts.soon) { b.disabled = true; b.title = 'Coming soon'; }
    if (opts.onClick) b.onclick = opts.onClick;
    return b;
  }

  function dropdown(label, entries, opts = {}) {
    const wrap = el('div', 'tn-menu');
    if (opts.id) wrap.id = opts.id;
    const trigger = opts.trigger || navItem(label, { active: opts.active });
    if (!opts.trigger) trigger.appendChild(el('span', 'tn-caret', '▾'));
    trigger.setAttribute('aria-haspopup', 'true');
    trigger.onclick = (e) => { e.stopPropagation(); const open = !wrap.classList.contains('open'); closeMenus(wrap); wrap.classList.toggle('open', open); };
    const panel = el('div', 'tn-panel' + (opts.right ? ' right' : ''));
    entries.forEach((entry) => {
      if (entry === '-') { panel.appendChild(el('hr')); return; }
      if (entry instanceof Node) { panel.appendChild(entry); return; }
      const b = el('button', entry.className || (entry.current ? 'current' : ''), entry.label);
      b.type = 'button';
      b.onclick = () => { wrap.classList.remove('open'); entry.onClick(); };
      panel.appendChild(b);
    });
    wrap.append(trigger, panel);
    return wrap;
  }

  function cleanOldHeaderLinks(header) {
    if (page === 'rest') header.querySelector('.header-actions')?.remove(); // Web UI / REST API / Live Browser links
    if (page === 'reports') header.querySelectorAll('.actions .link').forEach((e) => e.remove());
    if (page === 'work') header.querySelector('.nav')?.remove();
  }

  // Compact project button next to the logo; its dropdown holds the page's own Project and Source repository selects.
  function buildProjectSwitcher() {
    const wrap = el('div', 'tn-menu');
    wrap.id = 'tnProject';
    const btn = el('button', 'tn-btn');
    btn.type = 'button';
    btn.setAttribute('aria-haspopup', 'true');
    const name = el('span', 'tn-btn-name', 'Select project');
    btn.append(el('span', 'tn-btn-kicker', 'Project'), name, el('span', 'tn-caret', '▾'));
    btn.onclick = (e) => { e.stopPropagation(); const open = !wrap.classList.contains('open'); closeMenus(wrap); wrap.classList.toggle('open', open); };
    const panel = el('div', 'tn-panel');
    wrap.append(btn, panel);

    async function moveInto(id, label) {
      const select = await waitFor(id, 8000);
      if (!select) return null;
      const oldWrap = select.closest('.field') || select.parentElement;
      const field = el('div', 'tn-field');
      const lab = el('label', '', label);
      lab.htmlFor = id;
      field.append(lab, select);
      panel.appendChild(field);
      if (oldWrap) oldWrap.style.display = 'none';
      return select;
    }

    (async () => {
      const project = await moveInto(PROJECT_SELECT[page], 'Project');
      const repo = REPO_SELECT[page] ? await moveInto(REPO_SELECT[page], 'Source repository') : null;
      const hint = page === 'web' ? document.getElementById('platformContextHint') : null;
      if (hint) { hint.className = 'tn-hint'; panel.appendChild(hint); }
      if (page === 'web' && project && repo) document.querySelector('.platform-card')?.style.setProperty('display', 'none');
      if (!project) return;
      const update = () => { const o = project.selectedOptions[0]; name.textContent = o && o.value ? o.textContent : 'Select project'; };
      update();
      project.addEventListener('change', update);
      new MutationObserver(update).observe(project, { childList: true, subtree: true });
      setInterval(update, 1000); // also catches values set by page code
    })();
    return wrap;
  }

  function openProjectSwitcher() {
    const sw = document.getElementById('tnProject');
    if (sw) { closeMenus(sw); sw.classList.add('open'); }
  }

  function buildTopBar(user) {
    const header = document.querySelector('header');
    const brand = header?.querySelector('.brand');
    if (!header || !brand || document.getElementById('tnNav')) return;
    header.classList.add('tn-header');
    const role = String(user?.role || '').toUpperCase();
    const canTest = role === 'QA' || role === 'MANAGER';
    const isManager = role === 'MANAGER';
    const testing = page === 'web' || page === 'rest';

    const nav = el('nav');
    nav.id = 'tnNav';
    nav.setAttribute('aria-label', 'Main menu');
    nav.appendChild(navItem('Dashboard', { onClick: () => go('/reports.html') }));
    nav.appendChild(navItem('Projects', { onClick: (e) => {
      if (isManager) openOnTestingPage('platformAdmin', '#platform-setup');
      else { e.stopPropagation(); openProjectSwitcher(); }
    } }));
    if (canTest) {
      nav.appendChild(dropdown('Start Testing', [
        { label: 'Web UI testing', current: page === 'web', onClick: () => go(TESTING_PAGE) },
        { label: 'REST API testing', current: page === 'rest', onClick: () => go('/rest.html') },
      ], { active: testing }));
    }
    nav.appendChild(navItem('Test Cases', { onClick: () => openSection('test-cases') }));
    nav.appendChild(navItem('Test Runs', { onClick: () => openSection('test-runs') }));
    nav.appendChild(dropdown('Tasks', [
      { label: 'Task board', current: page === 'work', onClick: () => { const p = currentProjectId(); go('/work.html' + (p ? '?projectId=' + encodeURIComponent(p) : '')); } },
      { label: 'Defects', onClick: () => openOnTestingPage('platformDefects', '#defects') },
    ], { active: page === 'work' }));
    nav.appendChild(navItem('Reports', { active: page === 'reports', onClick: () => go('/reports.html') }));
    if (isManager) {
      nav.appendChild(dropdown('Administration', [
        { label: 'Users', onClick: () => openOnTestingPage('platformUsers', '#users') },
        { label: 'Platform setup', onClick: () => openOnTestingPage('platformAdmin', '#platform-setup') },
      ]));
    }

    const right = el('div');
    right.id = 'tnRight';

    const name = user?.name || user?.email || 'User';
    const initials = name.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || 'U';
    const trigger = el('button', 'tn-item');
    trigger.type = 'button';
    trigger.title = name;
    trigger.append(el('span', 'tn-avatar', initials), el('span', 'tn-caret', '▾'));
    const who = el('div', 'tn-who');
    who.append(el('b', '', name), el('small', '', user?.email || ''), el('span', 'tn-role', role));
    const entries = [who];
    const status = header.querySelector('.status'); // "AI connected · PostgreSQL connected" (Start Testing page)
    if (status) entries.push(status);
    entries.push('-', { label: 'Sign out', className: 'tn-signout', onClick: goLogin });
    right.appendChild(dropdown('', entries, { id: 'tnProfile', trigger, right: true }));

    cleanOldHeaderLinks(header);
    const switcher = PROJECT_SELECT[page] ? buildProjectSwitcher() : null;
    brand.insertAdjacentElement('afterend', nav);
    if (switcher) brand.insertAdjacentElement('afterend', switcher);
    header.appendChild(right);
    const hashKey = location.hash.slice(1);
    if (SECTION[hashKey]) { history.replaceState(null, '', location.pathname + location.search); setTimeout(() => scrollToSection(hashKey), 600); }

    document.addEventListener('click', (e) => { if (!e.target.closest('.tn-menu')) closeMenus(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(); });
  }

  async function start() {
    const h = await health();
    if (!h?.database?.configured) { document.querySelector('header')?.classList.remove('tn-header'); return; } // demo mode: keep each page's own header
    if (!token()) return goLogin();
    try {
      const r = await fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + token() } });
      if (r.status === 401) return goLogin();
      if (!r.ok) return;
      const d = await r.json();
      buildTopBar(d.user || {});
    } catch { /* keep the page's own header if the check fails */ }
  }

  injectStyles();
  // Paint the navy bar right away for signed-in users (avoids a white flash); removed again in demo mode.
  function markHeader() { if (token()) document.querySelector('header')?.classList.add('tn-header'); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', markHeader, { once: true }); else markHeader();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();

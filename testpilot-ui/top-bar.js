// Shared top bar for the Start Testing, REST API, Reports and Project Work pages.
// Main bar (same on every page): TN TestNexus | Home  Projects  Users (managers) | Profile ▾
// Page strip below it. Web testing: Projects › project › Start testing ... (project name in the centre) ... [Source code ▾]. REST/other: [Project ▾] Start Testing ▾
// Existing actions (Defects, Users, Platform setup) reuse the original buttons/popups on the Start Testing page.
(function () {
  if (window.__testNexusTopBar) return;
  window.__testNexusTopBar = true;

  const TOKEN_KEY = 'aiTestPilotToken';
  const path = location.pathname;
  const page = path === '/rest.html' ? 'rest'
    : path === '/reports.html' ? 'reports'
    : path === '/work.html' ? 'work'
    : path === '/test-case-guide.html' ? 'guide'
    : 'web';

  function injectStyles() {
    if (document.getElementById('testNexusTopBarStyles')) return;
    // Same Inter font the project and management pages load, so text looks identical on every page.
    if (!document.querySelector('link[href*="family=Inter"]')) {
      const font = document.createElement('link');
      font.rel = 'stylesheet';
      font.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap';
      document.head.appendChild(font);
    }
    const s = document.createElement('style');
    s.id = 'testNexusTopBarStyles';
    s.textContent = `
      html,body{overscroll-behavior:none} /* no elastic bounce at the top/bottom, so the bar never jumps */
      body{display:flow-root;min-height:100vh} /* body holds the whole page, so the sticky bar never scrolls away */
      header.tn-header{position:sticky!important;top:0!important;z-index:100!important;height:auto!important;min-height:64px!important;gap:0!important;padding:0 24px!important;background:#0f1f5c!important;border-bottom:0!important;box-shadow:0 1px 0 rgba(15,23,42,.2);color:#fff;flex-wrap:nowrap;justify-content:flex-start!important;-webkit-font-smoothing:antialiased;font-family:Inter,system-ui,-apple-system,"Segoe UI",Arial,sans-serif}
      header.tn-header>*:not(.tnb-brand):not(#tnMain):not(#tnRight){display:none!important}
      .tnb-brand{display:flex;align-items:center;gap:10px;flex:0 0 auto;text-decoration:none!important;color:#fff!important}
      .tnb-logo{display:grid;place-items:center;width:36px;height:36px;border-radius:9px;background:#fff;color:#0f1f5c;font-size:14px;font-weight:700}
      .tnb-text{display:flex;flex-direction:column;font-size:15px;font-weight:600;line-height:1.15;color:#fff;white-space:nowrap}
      .tnb-text small{font-size:11px;font-weight:500;margin-top:2px;color:#fff}
      #tnMain{display:flex;align-items:center;gap:4px;margin-left:24px;flex:1 1 auto;min-width:0}
      #tnMain a{padding:8px 12px;border-radius:8px;color:#fff!important;font-size:13px;font-weight:500;text-decoration:none!important;white-space:nowrap}
      #tnMain a:hover{background:rgba(255,255,255,.10)}
      #tnMain a[aria-current="page"]{background:rgba(255,255,255,.14);font-weight:600}
      #tnMain a:focus-visible,.tnb-brand:focus-visible,#tnProfile>.tn-item:focus-visible{outline:3px solid #93b0ff;outline-offset:2px}
      #tnSubbar{display:flex;align-items:stretch;gap:2px;min-height:48px;padding:0 24px;background:#fff;border-bottom:1px solid #e2e8f0;flex-wrap:wrap;font-family:Inter,system-ui,-apple-system,"Segoe UI",Arial,sans-serif;position:relative;z-index:90}
      .tn-menu{position:relative;display:flex}
      .tn-item{display:flex;align-items:center;gap:5px;height:48px;padding:0 12px;border:0;border-bottom:2px solid transparent;background:none;color:#334155;font:inherit;font-size:13px;font-weight:500;white-space:nowrap;cursor:pointer}
      .tn-item:hover:not(:disabled),.tn-menu.open>.tn-item{color:#1d4ed8;background:#f5f8ff}
      .tn-item.active{color:#1d4ed8;font-weight:600;border-bottom-color:#2563eb}
      .tn-item:disabled{color:#94a3b8;cursor:not-allowed}
      .tn-item:focus-visible{outline:3px solid #93b0ff;outline-offset:-3px}
      .tn-caret{font-size:9px;opacity:.8}
      .tn-panel{display:none;position:absolute;top:100%;left:0;min-width:200px;padding:6px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;box-shadow:0 14px 34px rgba(15,23,42,.22);z-index:300}
      .tn-panel.right{left:auto;right:0}
      .tn-menu.open>.tn-panel{display:block}
      .tn-panel button{display:block;width:100%;padding:9px 11px;border:0;border-radius:7px;background:none;color:#1e293b;font:inherit;font-size:12.5px;font-weight:600;text-align:left;cursor:pointer}
      .tn-panel button:hover{background:#eef2ff;color:#1d4ed8}
      .tn-panel button.current{color:#1d4ed8}
      .tn-panel hr{border:0;border-top:1px solid #eef1f6;margin:6px 4px}
      #tnRight{display:flex;align-items:center;margin-left:auto;flex:0 0 auto}
      #tnProject{flex:0 0 auto;align-items:center;padding-right:14px;margin-right:8px;border-right:1px solid #e2e8f0}
      #tnProject>.tn-btn{display:flex;align-items:center;gap:8px;max-width:260px;padding:6px 11px;border:1px solid #d0d5dd;border-radius:8px;background:#fff;color:#0f172a;font:inherit;font-size:12.5px;font-weight:600;cursor:pointer}
      #tnProject>.tn-btn:hover,#tnProject.open>.tn-btn{border-color:#2563eb;background:#f5f8ff}
      #tnProject .tn-btn-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #tnProject .tn-btn-kicker{color:#64748b;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px}
      #tnProject .tn-panel{top:calc(100% + 4px);min-width:290px;padding:12px}
      #tnProject .tn-field+.tn-field{margin-top:10px}
      #tnProject .tn-field label{display:block;margin:0 0 5px;color:#475569;font-size:11px;font-weight:700}
      #tnProject .tn-field select{width:100%;margin:0;padding:8px 9px;border:1px solid #d0d5dd;border-radius:8px;background:#fff;color:#10141c;font-size:12.5px}
      #tnProject .tn-hint{margin-top:9px;color:#64748b;font-size:11px;line-height:1.45}
.tn-choice-menu{display:grid;gap:2px;min-width:250px}
.tn-panel button.tn-choice{font-weight:600}
.tn-panel button.tn-choice.on{background:#eef2ff;color:#1d4ed8}
      #tnProfile>.tn-item{height:40px;gap:8px;padding:0 8px;border:0;border-radius:8px;color:#fff;font-size:13.5px;font-weight:500}
      #tnProfile>.tn-item:hover,#tnProfile.open>.tn-item{background:rgba(255,255,255,.12);color:#fff}
      .tn-avatar{display:grid;place-items:center;width:30px;height:30px;flex:0 0 30px;border-radius:50%;background:#60a5fa;color:#0f1f5c;font-size:12px;font-weight:700;box-shadow:0 0 0 2px rgba(255,255,255,.35)}
      #tnProfile .tn-panel{top:calc(100% + 8px);min-width:250px}
      .tn-who{padding:9px 11px 6px}
      .tn-who b{display:block;color:#0f172a;font-size:13px;font-weight:600}
      .tn-who small{display:block;color:#64748b;font-size:11px;margin-top:2px}
      .tn-role{display:inline-block;margin-top:6px;padding:2px 7px;border-radius:999px;background:#e0e7ff;color:#3730a3;font-size:10px;font-weight:700}
      #tnProfile .tn-panel .status{display:flex;margin:4px 6px;padding:7px 9px;border-radius:8px;border:1px solid #e2e8f0!important;background:#f8fafc!important;color:#475569!important;font-size:11px}
      #tnProfile .tn-signout{color:#b91c1c}
      #tnProfile .tn-signout:hover{background:#fee2e2;color:#991b1b}
      #tnSubbar.tn-strip{align-items:center;justify-content:space-between;min-height:46px;gap:12px;position:relative}
      #tnProjectTitle{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#dc2626;font-size:16px;font-weight:700;pointer-events:none}
      #tnSubbar.tn-strip .testing-crumb{margin:0!important;font-size:13px}
      .tn-strip-tools{display:flex;align-items:center;gap:8px;margin-left:auto}
      .tn-strip #tnProject{padding-right:0;margin-right:0;border-right:0}
      .tn-strip #tnProject>.tn-btn{max-width:220px;padding:4px 10px;font-size:12px;border-radius:7px}
      .tn-strip-btn{height:32px;padding:0 14px;border:1px solid #3158ea;border-radius:8px;background:#fff;color:#3158ea;font:inherit;font-size:12.5px;font-weight:600;cursor:pointer}
      .tn-strip-btn:hover{border-color:#2346d5;background:#eef2ff;color:#2346d5}
      .tn-strip-btn:focus-visible{outline:3px solid #93b0ff;outline-offset:1px}
      @media(max-width:600px){.tnb-text small,#tnProfile .tn-name{display:none}header.tn-header{padding:0 16px!important}#tnSubbar{padding:0 16px}}
      @media(max-width:900px){header.tn-header{flex-wrap:wrap!important;padding-bottom:8px!important}#tnMain{order:3;flex-basis:100%;margin-left:0;overflow-x:auto}}
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
    const panel = el('div', 'tn-panel right'); // opens to the left, so it stays on screen at the top-right
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
      const repo = REPO_SELECT[page] ? await moveInto(REPO_SELECT[page], 'Testing mode') : null;
      // AI icon on the testing mode choice (black box = browser only, white box = with source code).
      if (repo) { const lab = repo.closest('.tn-field')?.querySelector('label'); if (lab) lab.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#2563eb" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-2px;margin-right:5px"><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>Testing mode'; }
      // Web testing: the project is already chosen on the project page, so only the source code choice is shown.
      const sourceOnly = page === 'web' && repo;
      if (sourceOnly) { project.closest('.tn-field').hidden = true; btn.querySelector('.tn-btn-kicker').textContent = 'Source code'; }
      // Source code: one click shows the two choices as a menu (✓ on the selected one). The select stays hidden underneath,
      // so the page's own logic (and the "link a repository" message) works exactly as before.
      if (sourceOnly) {
        const field = repo.closest('.tn-field'); field.querySelector('select').style.display = 'none';
        const menu = el('div', 'tn-choice-menu'); field.appendChild(menu);
        const draw = () => {
          menu.replaceChildren(...[...repo.options].map((o) => {
            const b = el('button', 'tn-choice' + (o.selected ? ' on' : ''), (o.selected ? '✓ ' : '') + o.textContent);
            b.type = 'button'; b.setAttribute('role', 'menuitemradio'); b.setAttribute('aria-checked', String(o.selected));
            b.onclick = (e) => { e.stopPropagation(); repo.value = o.value; repo.dispatchEvent(new Event('change', { bubbles: true })); draw(); if (repo.value === o.value) wrap.classList.remove('open'); };
            return b;
          }));
        };
        draw(); repo.addEventListener('change', draw); new MutationObserver(draw).observe(repo, { childList: true });
      }
      const hint = page === 'web' ? document.getElementById('platformContextHint') : null;
      if (hint) { hint.className = 'tn-hint'; panel.appendChild(hint); }
      if (page === 'web' && project && repo) document.querySelector('.platform-card')?.style.setProperty('display', 'none');
      if (!project) return;
      const update = () => { const sel = sourceOnly ? repo : project; const o = sel.selectedOptions[0]; name.textContent = o && o.value && o.value !== '__link_repo' ? o.textContent.replace(/^[⬛⬜]\s*White box · /, '').split(' · ')[0] : (sourceOnly ? 'None' : 'Select project'); };
      update();
      project.addEventListener('change', update);
      new MutationObserver(update).observe(project, { childList: true, subtree: true });
      if (sourceOnly) { repo.addEventListener('change', update); new MutationObserver(update).observe(repo, { childList: true, subtree: true }); }
      setInterval(update, 1000); // also catches values set by page code
    })();
    return wrap;
  }

  // Same main links, in the same order, as the project and management pages.
  function mainLink(label, href, current) {
    const a = el('a', '', label);
    a.href = href;
    if (current) a.setAttribute('aria-current', 'page');
    return a;
  }

  function buildTopBar(user) {
    const header = document.querySelector('header');
    if (!header || document.getElementById('tnMain')) return;
    header.classList.add('tn-header');
    const role = String(user?.role || '').toUpperCase();
    const canTest = role === 'QA' || role === 'MANAGER';
    const isManager = role === 'MANAGER';
    const testing = page === 'web' || page === 'rest';

    // Main bar: brand + Home · Projects.
    const brand = el('a', 'tnb-brand');
    brand.href = '/workspace.html#projects';
    const brandText = el('span', 'tnb-text', 'TestNexus');
    brandText.appendChild(el('small', '', 'Project intelligence workspace'));
    brand.append(el('span', 'tnb-logo', 'TN'), brandText);

    const main = el('nav');
    main.id = 'tnMain';
    main.setAttribute('aria-label', 'Main navigation');
    main.append(
      mainLink('Home', '/workspace.html#overview'),
      mainLink('Projects', '/workspace.html#projects', page !== 'guide'),
      ...(isManager ? [mainLink('Administration', '/workspace.html#users'), mainLink('Teams', '/workspace.html#teams')] : []),
    );

    // Page toolbar below the bar: this page's own tools.
    const sub = el('nav');
    sub.id = 'tnSubbar';
    sub.setAttribute('aria-label', 'Page tools');
    // Start Testing switch (Web UI ⇄ REST API) on both testing pages. On the web testing page the strip is:
    // breadcrumb · project name (centre) · tools (Start Testing switch, Source code).
    if (canTest) {
      sub.appendChild(dropdown('Start Testing', [
        { label: 'Web UI testing', current: page === 'web', onClick: () => go(TESTING_PAGE) },
        { label: 'REST API testing', current: page === 'rest', onClick: () => go('/rest.html') },
      ], { active: testing }));
    }

    // Profile: avatar + name ▾ (same as the other pages), with connection status on the testing page.
    const right = el('div');
    right.id = 'tnRight';
    const name = user?.name || user?.email || 'User';
    const initials = name.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || 'U';
    const trigger = el('button', 'tn-item');
    trigger.type = 'button';
    trigger.title = name;
    trigger.append(el('span', 'tn-avatar', initials), el('span', 'tn-name', name), el('span', 'tn-caret', '▾'));
    const ROLE_LABELS = { MANAGER: 'Manager', QA: 'QA', DEV: 'Developer' };
    const who = el('div', 'tn-who');
    who.append(el('b', '', name), el('small', '', user?.email || ''));
    if (role) who.append(el('span', 'tn-role', ROLE_LABELS[role] || role));
    const entries = [who];
    const status = header.querySelector('.status'); // "AI connected · PostgreSQL connected" (Start Testing page)
    if (status) entries.push(status);
    entries.push('-', { label: 'Sign out', className: 'tn-signout', onClick: () => location.assign('/logout.html') });
    right.appendChild(dropdown('', entries, { id: 'tnProfile', trigger, right: true }));

    cleanOldHeaderLinks(header);
    header.querySelector('.brand')?.remove();
    header.prepend(brand);
    brand.insertAdjacentElement('afterend', main);
    header.appendChild(right);
    const switcher = PROJECT_SELECT[page] ? buildProjectSwitcher() : null;
    if (switcher) sub.prepend(switcher);
    if (page === 'web') {
      // Breadcrumb (Projects › project › Start testing) sits at the left of the strip; tools on the right.
      sub.classList.add('tn-strip');
      let crumb = document.getElementById('testCrumb');
      if (!crumb) { crumb = el('nav', 'testing-crumb'); crumb.id = 'testCrumb'; crumb.setAttribute('aria-label', 'Breadcrumb'); }
      const tools = el('div', 'tn-strip-tools');
      while (sub.firstChild) tools.appendChild(sub.firstChild);
      sub.append(crumb, tools);
    }
    if (page !== 'guide') header.insertAdjacentElement('afterend', sub); // the guide is a reading page: no tools


    const hashKey = location.hash.slice(1);
    if (SECTION[hashKey]) { history.replaceState(null, '', location.pathname + location.search); setTimeout(() => scrollToSection(hashKey), 600); }

    document.addEventListener('click', (e) => { if (!e.target.closest('.tn-menu')) closeMenus(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(); });
  }

  async function start() {
    const h = await health();
    if (!h?.database?.configured) { document.querySelector('header')?.classList.remove('tn-header'); return; } // demo mode: keep each page's own header
    if (!token()) return page === 'guide' ? undefined : goLogin(); // the guide stays readable when signed out
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

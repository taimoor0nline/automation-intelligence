(function () {
  if (window.__testNexusFastModeNavigation) return;
  window.__testNexusFastModeNavigation = true;

  function install() {
    const header = document.querySelector('header');
    if (!header || document.getElementById('testModeSwitch')) return;

    const style = document.createElement('style');
    style.id = 'testModeSwitchStyles';
    style.textContent = `
      #testModeSwitch{position:relative;z-index:1001;display:inline-flex;align-items:center;gap:4px;padding:4px;border:1px solid #e2e8f0;border-radius:10px;background:#fff;box-shadow:0 1px 3px rgba(15,23,42,.06);pointer-events:auto!important}
      #testModeSwitch a{display:inline-flex;align-items:center;min-height:32px;padding:7px 10px;border-radius:7px;color:#475569;text-decoration:none;font-size:10.5px;font-weight:800;white-space:nowrap;pointer-events:auto!important;cursor:pointer!important}
      #testModeSwitch a:hover{background:#f8fafc;color:#1d4ed8}
      #testModeSwitch a.active{background:#eef2ff;color:#1d4ed8;box-shadow:inset 0 0 0 1px #dbe3ff}
      @media(max-width:760px){#testModeSwitch a{padding:7px 8px;font-size:10px}}
    `;
    document.head.appendChild(style);

    const rest = location.pathname === '/rest.html' || location.pathname.startsWith('/rest/');
    const nav = document.createElement('nav');
    nav.id = 'testModeSwitch';
    nav.setAttribute('aria-label', 'Testing mode');
    nav.innerHTML = `<a href="/" class="${rest ? '' : 'active'}" ${rest ? '' : 'aria-current="page"'}>Web UI</a><a href="/rest.html" class="${rest ? 'active' : ''}" ${rest ? 'aria-current="page"' : ''}>REST API</a>`;

    const existingActions = header.querySelector('.platform-header-actions,.header-actions');
    if (existingActions) existingActions.insertBefore(nav, existingActions.firstChild);
    else {
      const status = header.querySelector('.status');
      if (status) header.insertBefore(nav, status);
      else header.appendChild(nav);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();

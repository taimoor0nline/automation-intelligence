(function () {
  let databaseConfigured = false;
  let observer = null;

  function tryInsert() {
    if (!databaseConfigured) return false;
    const token = sessionStorage.getItem('aiTestPilotToken') || '';
    const switcher = document.getElementById('testModeSwitch');
    if (!token || !switcher) return false;
    if (document.getElementById('testReportsLink')) return true;

    const link = document.createElement('a');
    link.id = 'testReportsLink';
    link.href = '/reports.html';
    link.textContent = 'Reports';
    link.title = 'Role-aware historical test reports';
    switcher.appendChild(link);
    return true;
  }

  async function start() {
    try {
      const health = await fetch('/health').then((r) => r.json());
      databaseConfigured = Boolean(health.database?.configured);
      if (!databaseConfigured) return;

      if (tryInsert()) return;
      observer = new MutationObserver(() => {
        if (tryInsert()) observer?.disconnect();
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true });

      // The token lives in sessionStorage, whose updates do not emit a storage
      // event in the same tab. A light poll covers sign-in flows that change only
      // sessionStorage and no relevant DOM node.
      const timer = setInterval(() => {
        if (tryInsert()) {
          clearInterval(timer);
          observer?.disconnect();
        }
      }, 500);
    } catch {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();

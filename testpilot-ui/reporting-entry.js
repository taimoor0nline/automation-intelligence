(function () {
  async function ensureReportsLink() {
    try {
      const token = sessionStorage.getItem('aiTestPilotToken') || '';
      if (!token) return;
      const health = await fetch('/health').then((r) => r.json());
      if (!health.database?.configured) return;

      let attempts = 0;
      const timer = setInterval(() => {
        attempts += 1;
        const switcher = document.getElementById('testModeSwitch');
        if (switcher && !document.getElementById('testReportsLink')) {
          const link = document.createElement('a');
          link.id = 'testReportsLink';
          link.href = '/reports.html';
          link.textContent = 'Reports';
          link.title = 'Role-aware historical test reports';
          switcher.appendChild(link);
          clearInterval(timer);
        } else if (attempts >= 20) {
          clearInterval(timer);
        }
      }, 100);
    } catch {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureReportsLink);
  else ensureReportsLink();
})();

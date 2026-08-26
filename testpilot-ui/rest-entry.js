(function () {
  function addEntry() {
    const actions = document.querySelector('#platformSignedIn .platform-actions');
    if (!actions || document.getElementById('platformRestApi')) return;
    const button = document.createElement('button');
    button.id = 'platformRestApi';
    button.type = 'button';
    button.className = 'btn ghost';
    button.textContent = 'REST API';
    button.onclick = () => { window.location.href = '/rest.html'; };
    actions.insertBefore(button, document.getElementById('platformDefects') || actions.firstChild);
  }
  const observer = new MutationObserver(addEntry);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
  addEntry();
})();

// Testing page → Story: a search box (type a story number or title) instead of a long dropdown.
// The original dropdown stays hidden underneath and still drives the page: picking a story sets it and fires "change".
(function () {
  if (window.__tnStorySearch) return;
  window.__tnStorySearch = true;
  const ALL = '__all';

  function install() {
    const select = document.getElementById('testContextRecord');
    if (!select || !window.TNPick || select.dataset.searchable) return false;
    select.dataset.searchable = '1';
    const input = document.createElement('input');
    input.id = 'testContextRecordSearch';
    input.className = select.className || '';
    input.placeholder = 'Select story';
    input.setAttribute('aria-label', 'Story');
    select.before(input);
    select.hidden = true;

    // No "All project requirements" item: an empty box (placeholder "Select story") means no story.
    const items = () => [...select.options].filter((o) => o.value).map((o) => ({ id: o.value, label: o.textContent.trim() }));
    let shown = null;
    const attach = () => window.TNPick.attach(input, items(), {
      value: select.value || '',
      onChange: (item) => {
        const value = !item || item.id === ALL ? '' : item.id;
        if (select.value === value) return;
        select.value = value;
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
      },
    });
    attach();
    shown = select.value;
    // The page rebuilds the list (project loaded) and sets the story itself (opened from a story): follow both.
    new MutationObserver(() => { attach(); shown = select.value; }).observe(select, { childList: true });
    setInterval(() => { if (select.value !== shown && document.activeElement !== input) { shown = select.value; attach(); } }, 500);
    return true;
  }

  const timer = setInterval(() => { if (install()) clearInterval(timer); }, 300);
  setTimeout(() => clearInterval(timer), 20000);
})();

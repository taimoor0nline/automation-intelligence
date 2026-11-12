// Searchable pick box (Parent task, Story, Assigned to): looks like the Tasks page search box —
// a 🔍 icon, the same height, border and rounded corners — and lists matches as you type.
// TNPick.attach(input, items, {onChange}) — items: [{id, label}]. The chosen id is kept in input.dataset.value.
// TNPick.value(input) → id, '' when empty, or null when text was typed that matches nothing.
(function () {
  if (window.TNPick) return;
  const css = document.createElement('style');
  css.textContent = `
.tn-pick{position:relative;display:flex;align-items:center;height:40px;border:1px solid #94a3b8;border-radius:9px;background:#fff;box-shadow:0 1px 2px rgba(15,23,42,.06)}
.tn-pick:focus-within{border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.18)}
.tn-pick>svg{flex:0 0 auto;margin:0 8px 0 12px;color:#64748b}
.tn-pick>input{flex:1;min-width:0;height:100%;border:0!important;outline:0!important;box-shadow:none!important;background:transparent!important;padding:0 6px 0 0!important;font:inherit;font-size:13.5px;color:#0f172a}
.tn-pick>input:disabled{color:#64748b}
.tn-pick-clear{flex:0 0 auto;border:0;background:none;color:#64748b;font-size:18px;line-height:1;padding:0 12px;cursor:pointer}
.tn-pick-clear[hidden]{display:none}
.tn-pick-list{position:absolute;z-index:40;left:0;right:0;top:calc(100% + 4px);max-height:240px;overflow:auto;background:#fff;border:1px solid #cbd5e1;border-radius:10px;box-shadow:0 12px 28px rgba(15,23,42,.14);padding:4px}
.tn-pick-list[hidden]{display:none}
.tn-pick-list.up{top:auto;bottom:calc(100% + 4px)}
.tn-pick-item{padding:8px 10px;border-radius:7px;font-size:13.5px;cursor:pointer;color:#0f172a}
.tn-pick-item:hover,.tn-pick-item.active{background:#eef2ff;color:#0f1f5c}
.tn-pick-empty{padding:8px 10px;font-size:13px;color:#64748b}`;
  document.head.appendChild(css);
  const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';

  function attach(input, items, opts = {}) {
    if (!input) return;
    items = Array.isArray(items) ? items : [];
    let wrap = input.closest('.tn-pick');
    if (!wrap) {
      wrap = document.createElement('div'); wrap.className = 'tn-pick';
      input.before(wrap); wrap.insertAdjacentHTML('afterbegin', icon); wrap.append(input);
      const clear = document.createElement('button'); clear.type = 'button'; clear.className = 'tn-pick-clear'; clear.textContent = '×'; clear.setAttribute('aria-label', 'Clear'); wrap.append(clear);
      const list = document.createElement('div'); list.className = 'tn-pick-list'; list.setAttribute('role', 'listbox'); list.hidden = true; wrap.append(list);
      input.removeAttribute('list'); input.autocomplete = 'off'; input.setAttribute('role', 'combobox'); input.setAttribute('aria-expanded', 'false');
      clear.addEventListener('mousedown', (e) => { e.preventDefault(); set(null); input.focus(); draw(); });
      input.addEventListener('focus', () => { active = -1; draw(); });
      input.addEventListener('click', () => { if (list.hidden) { active = -1; draw(); } });
      input.addEventListener('input', () => { input.dataset.value = ''; active = -1; mark(); draw(); });
      input.addEventListener('keydown', (e) => {
        const rows = [...list.querySelectorAll('.tn-pick-item')];
        if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) draw(); active = Math.min(active + 1, rows.length - 1); draw(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); draw(); }
        else if (e.key === 'Enter' && !list.hidden) { e.preventDefault(); const r = rows[active] || (rows.length === 1 ? rows[0] : null); if (r) set(input._pickItems.find((x) => String(x.id) === r.dataset.id)); }
        else if (e.key === 'Escape') close();
      });
      list.addEventListener('mousedown', (e) => { const r = e.target.closest('.tn-pick-item'); if (!r) return; e.preventDefault(); set(input._pickItems.find((x) => String(x.id) === r.dataset.id)); });
      input.addEventListener('blur', () => setTimeout(close, 120));
    }
    const list = wrap.querySelector('.tn-pick-list'), clear = wrap.querySelector('.tn-pick-clear');
    let active = -1;
    input._pickItems = items;
    function close() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; }
    function mark() {
      const t = input.value.trim(); clear.hidden = !t || input.disabled;
      input.setCustomValidity(t && !input.dataset.value ? 'Choose an item from the list, or clear it.' : '');
    }
    function set(item) {
      input.value = item ? item.label : ''; input.dataset.value = item ? item.id : '';
      mark(); close(); if (opts.onChange) opts.onChange(item || null);
    }
    function draw() {
      if (input.disabled) return;
      const q = input.value.trim().toLowerCase();
      const found = input._pickItems.filter((x) => !q || x.label.toLowerCase().includes(q)).slice(0, 200);
      list.innerHTML = found.map((x, i) => '<div class="tn-pick-item' + (i === active ? ' active' : '') + '" role="option" data-id="' + esc(x.id) + '">' + esc(x.label) + '</div>').join('') || '<div class="tn-pick-empty">No matches</div>';
      list.hidden = false; input.setAttribute('aria-expanded', 'true');
      // Open upward when there is not enough room below (e.g. near the bottom of a popup).
      list.classList.remove('up');
      const box = wrap.getBoundingClientRect(), below = window.innerHeight - box.bottom, above = box.top;
      if (below < Math.min(list.scrollHeight, 240) + 12 && above > below) list.classList.add('up');
    }
    // Keep a value that was already chosen (e.g. the current parent in Edit).
    const current = items.find((x) => String(x.id) === String(opts.value ?? input.dataset.value ?? ''));
    if (current) { input.value = current.label; input.dataset.value = current.id; } else if (opts.value === '' || opts.value === null) { input.value = ''; input.dataset.value = ''; }
    mark();
  }
  function value(input) {
    if (!input) return '';
    const t = input.value.trim();
    if (!t) return '';
    return input.dataset.value || null;
  }
  window.TNPick = { attach, value };
})();

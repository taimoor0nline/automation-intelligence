(function () {
  const TYPES = ['functional','positive','negative','boundary'];
  const STORAGE_KEY = 'aiTestPilotGenerationScenarioTypes';
  const label = (value) => value.charAt(0).toUpperCase() + value.slice(1);

  function selectedValues() {
    const checked = [...document.querySelectorAll('#generationTypeMenu input[data-scenario-type]:checked')].map((x) => x.value);
    return checked.length ? checked : [...TYPES];
  }

  function updateSummary() {
    const button = document.getElementById('generationTypeButton');
    const allBox = document.getElementById('generationTypeSelectAll');
    const count = document.getElementById('generationTypeCount');
    if (!button || !allBox) return;
    const selected = selectedValues();
    const all = selected.length === TYPES.length;
    allBox.checked = all;
    allBox.indeterminate = !all && selected.length > 0;
    button.innerHTML = `<span>${all ? 'All scenario types' : `${selected.length} type${selected.length === 1 ? '' : 's'} selected`}</span><span class="generation-chevron">⌄</span>`;
    if (count) count.textContent = all ? 'All' : String(selected.length);
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(selected)); } catch {}
  }

  function restore() {
    let saved;
    try { saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null'); } catch {}
    const set = Array.isArray(saved) && saved.length ? new Set(saved.filter((x) => TYPES.includes(x))) : new Set(TYPES);
    document.querySelectorAll('#generationTypeMenu input[data-scenario-type]').forEach((input) => { input.checked = set.has(input.value); });
    updateSummary();
  }

  function closeOtherGenerationPickers(exceptRoot) {
    document.querySelectorAll('#generationTypePicker.open,#generationCategoryPicker.open,.security-picker.open').forEach((root) => {
      if (root !== exceptRoot) root.classList.remove('open');
    });
  }

  function installDropdownCoordinator() {
    if (window.__aiTestPilotGenerationDropdownCoordinator) return;
    window.__aiTestPilotGenerationDropdownCoordinator = true;
    const rootByButton = {
      generationTypeButton: 'generationTypePicker',
      generationCategoryButton: 'generationCategoryPicker',
      securitySubcategoryButton: 'securitySubcategoryPicker',
      securitySeverityButton: 'securitySeverityPicker',
    };
    document.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      const rootId = button ? rootByButton[button.id] : null;
      if (rootId) {
        closeOtherGenerationPickers(document.getElementById(rootId));
        return;
      }
      if (!event.target.closest('#generationTypePicker,#generationCategoryPicker,.security-picker')) {
        closeOtherGenerationPickers(null);
      }
    }, true);
  }

  function inject() {
    if (document.getElementById('generationTypePicker')) return;
    const categoryPicker = document.getElementById('generationCategoryPicker');
    const storyField = document.getElementById('story')?.closest('.field');
    if (!storyField) return;

    const style = document.createElement('style');
    style.textContent = `.generation-type-picker{position:relative;margin-top:12px}.generation-type-picker.open>#generationTypeMenu{display:block}.generation-type-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:7px}.generation-type-heading label{margin:0;color:#344054;font-size:12px;font-weight:800}.generation-type-count{display:inline-flex;align-items:center;justify-content:center;min-width:28px;height:22px;padding:0 7px;border-radius:999px;background:#f1f5f9;color:#475569;font-size:10px;font-weight:850}.generation-type-note{margin-top:6px;color:#667085;font-size:10.5px;line-height:1.45}`;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.id = 'generationTypePicker';
    root.className = 'generation-type-picker';
    root.innerHTML = `<div class="generation-type-heading"><label>Scenario types to generate</label><span id="generationTypeCount" class="generation-type-count">All</span></div><button id="generationTypeButton" class="generation-category-button" type="button"><span>All scenario types</span><span class="generation-chevron">⌄</span></button><div id="generationTypeMenu" class="generation-category-menu"><label class="generation-category-option generation-category-all"><input id="generationTypeSelectAll" type="checkbox" checked> Select All</label>${TYPES.map((type) => `<label class="generation-category-option"><input type="checkbox" data-scenario-type value="${type}" checked> ${label(type)}</label>`).join('')}</div><div class="generation-type-note">Choose how scenarios should behave. Test category remains a separate testing-purpose classification.</div>`;

    if (categoryPicker) categoryPicker.insertAdjacentElement('beforebegin', root);
    else storyField.insertAdjacentElement('afterend', root);

    const button = document.getElementById('generationTypeButton');
    const menu = document.getElementById('generationTypeMenu');
    const allBox = document.getElementById('generationTypeSelectAll');
    button.addEventListener('click', (event) => { event.stopPropagation(); root.classList.toggle('open'); });
    allBox.addEventListener('change', () => { menu.querySelectorAll('input[data-scenario-type]').forEach((input) => { input.checked = allBox.checked; }); updateSummary(); });
    menu.querySelectorAll('input[data-scenario-type]').forEach((input) => input.addEventListener('change', updateSummary));
    restore();
    installDropdownCoordinator();
  }

  function start() {
    if (document.getElementById('generationCategoryPicker')) inject();
    else {
      const observer = new MutationObserver(() => {
        if (document.getElementById('generationCategoryPicker')) { observer.disconnect(); inject(); }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => { observer.disconnect(); inject(); }, 2000);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
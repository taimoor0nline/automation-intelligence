(function () {
  if (window.__testNexusCypressPreviewUi) return;
  window.__testNexusCypressPreviewUi = true;

  const view = document.getElementById('editorAutomationView');
  const modal = document.getElementById('editorModal');
  if (!view || !modal) return;

  const style = document.createElement('style');
  style.textContent = `
    .automation-projection-tabs{display:flex;gap:6px;padding:10px 14px;border-bottom:1px solid #e2e8f0;background:#f8fafc}
    .automation-projection-tab{border:1px solid #dbe3ef;border-radius:7px;background:#fff;color:#64748b;padding:6px 9px;font-size:10px;font-weight:800;cursor:pointer}
    .automation-projection-tab.active{border-color:#93c5fd;color:#1d4ed8;background:#eff6ff}
    .canonical-ir-section,.cypress-preview-section{padding:12px 14px;border-bottom:1px solid #eef1f6}
    .canonical-ir-section h4,.cypress-preview-section h4{margin:0 0 7px;font-size:11px;color:#334155}
    .canonical-ir-code,.cypress-preview-code{margin:0;padding:10px 11px;border-radius:8px;background:#0f172a;color:#e2e8f0;white-space:pre;overflow:auto;font:10.5px/1.55 Consolas,Monaco,monospace}
    .automation-projection-note{font-size:10px;color:#64748b;margin:0 0 8px;line-height:1.45}
  `;
  document.head.appendChild(style);

  function getCases() {
    try {
      if (typeof testCases !== 'undefined' && Array.isArray(testCases)) return testCases;
    } catch {}
    return Array.isArray(window.testCases) ? window.testCases : [];
  }

  function currentCase() {
    const index = Number(document.getElementById('editIndex')?.value ?? -1);
    const cases = getCases();
    return index >= 0 ? cases[index] || null : null;
  }

  function valuePart(item) {
    for (const key of ['value','text','path','fragment','url','key','fileName','permission','state','queryName']) {
      if (item?.[key] !== undefined && item?.[key] !== null && String(item[key]).length) return `${key}=${JSON.stringify(item[key])}`;
    }
    return '';
  }

  function targetPart(item) {
    if (item?.actorRef) return `actor=${item.actorRef}`;
    if (item?.elementRef) return item.elementRef;
    if (item?.sourceElementRef || item?.targetElementRef) return `${item.sourceElementRef || '?'} → ${item.targetElementRef || '?'}`;
    if (item?.path) return item.path;
    return '';
  }

  function canonicalText(tc) {
    const ir = tc?.canonicalIr || {};
    const actions = Array.isArray(ir.actions) ? ir.actions : [];
    const assertions = Array.isArray(ir.assertions) ? ir.assertions : [];
    const lines = [];
    if (ir.plannedId) lines.push(`PLANNED  ${ir.plannedId}`);
    if (ir.objective) lines.push(`OBJECTIVE ${ir.objective}`);
    if (lines.length) lines.push('');
    lines.push('ACTIONS');
    if (!actions.length) lines.push('  —');
    actions.forEach((item, index) => lines.push(`  ${String(index + 1).padStart(2,'0')}  ${item.operation || 'ACTION'}${targetPart(item) ? `  ${targetPart(item)}` : ''}${valuePart(item) ? `  ${valuePart(item)}` : ''}`));
    lines.push('', 'ASSERTIONS');
    if (!assertions.length) lines.push('  —');
    assertions.forEach((item, index) => lines.push(`  ${String(index + 1).padStart(2,'0')}  ${item.operation || 'ASSERT'}${targetPart(item) ? `  ${targetPart(item)}` : ''}${valuePart(item) ? `  ${valuePart(item)}` : ''}`));
    return lines.join('\n');
  }

  function setProjection(mode) {
    const cypress = mode === 'cypress';
    view.querySelectorAll('.automation-projection-tab').forEach((button) => button.classList.toggle('active', button.dataset.projection === mode));
    view.querySelectorAll('[data-canonical-detail="1"]').forEach((node) => { node.style.display = cypress ? 'none' : ''; });
    const preview = view.querySelector('.cypress-preview-section');
    if (preview) preview.style.display = cypress ? '' : 'none';
  }

  let decorating = false;
  function decorate() {
    if (decorating) return;
    const tc = currentCase();
    if (!tc?.canonicalIr) return;
    const signature = `${tc.id || ''}|${tc.canonicalValidation?.registryHash || ''}|${String(tc.cypressPreview || '').length}`;
    if (view.dataset.canonicalProjectionSignature === signature && view.querySelector('.automation-projection-tabs')) return;

    decorating = true;
    try {
      view.dataset.canonicalProjectionSignature = signature;
      view.querySelector('.automation-projection-tabs')?.remove();
      view.querySelector('.canonical-ir-section')?.remove();
      view.querySelector('.cypress-preview-section')?.remove();

      const head = view.querySelector('.automation-head');
      if (!head) return;
      head.querySelector('strong').textContent = 'Automation Details';
      const sub = head.querySelector('span');
      if (sub) sub.textContent = 'Canonical execution contract and deterministic Cypress projection.';

      const tabs = document.createElement('div');
      tabs.className = 'automation-projection-tabs';
      tabs.innerHTML = '<button type="button" class="automation-projection-tab active" data-projection="canonical">Canonical Plan</button><button type="button" class="automation-projection-tab" data-projection="cypress">Cypress Preview</button>';
      head.insertAdjacentElement('afterend', tabs);

      const canonical = document.createElement('div');
      canonical.className = 'canonical-ir-section';
      canonical.dataset.canonicalDetail = '1';
      canonical.innerHTML = '<h4>Canonical Plan</h4><p class="automation-projection-note">Stable elementRefs and operations are the AI/runtime contract. Selectors remain owned by TestNexus discovery.</p><pre class="canonical-ir-code"></pre>';
      canonical.querySelector('pre').textContent = canonicalText(tc);
      tabs.insertAdjacentElement('afterend', canonical);

      for (const section of view.querySelectorAll(':scope > .automation-section')) section.dataset.canonicalDetail = '1';

      const preview = document.createElement('div');
      preview.className = 'cypress-preview-section';
      preview.style.display = 'none';
      preview.innerHTML = '<h4>Cypress Preview</h4><p class="automation-projection-note">Generated by the same deterministic emitter used for execution. Runtime credential values are intentionally not embedded.</p><pre class="cypress-preview-code"></pre>';
      preview.querySelector('pre').textContent = tc.cypressPreview || 'Cypress projection is not available for this canonical case yet.';
      view.appendChild(preview);

      tabs.addEventListener('click', (event) => {
        const button = event.target.closest('[data-projection]');
        if (button) setProjection(button.dataset.projection);
      });
      setProjection('canonical');
    } finally {
      decorating = false;
    }
  }

  const observer = new MutationObserver(() => setTimeout(decorate, 0));
  observer.observe(view, { childList: true, subtree: true });
  modal.addEventListener('click', (event) => {
    if (event.target.closest('[data-editor-view="automation"]')) setTimeout(decorate, 0);
  });
  decorate();
})();

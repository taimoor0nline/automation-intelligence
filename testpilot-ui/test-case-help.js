(function () {
  function addStyles() {
    if (document.getElementById('testCaseHelpStyles')) return;
    const style = document.createElement('style');
    style.id = 'testCaseHelpStyles';
    style.textContent = `
      .test-case-help-link{display:inline-flex;align-items:center;gap:6px;text-decoration:none;color:#2f5bff;font-size:11px;font-weight:800;padding:6px 8px;border:1px solid #dbe3ff;background:#f8faff;border-radius:8px}
      .test-case-help-link:hover{background:#eef2ff}
      .test-case-help-link svg{width:15px;height:15px}
      .test-case-help-bar{display:flex;justify-content:flex-end;gap:7px;flex-wrap:wrap;margin:-4px 0 12px}
      .field-help-link{margin-left:auto;font-size:10px;font-weight:800;color:#2f5bff;text-decoration:none}
      .field-help-link:hover{text-decoration:underline}
    `;
    document.head.appendChild(style);
  }

  const icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.6 2.6 0 0 1 5.1.8c0 2-2.6 2.2-2.6 4"/><path d="M12 17h.01"/></svg>';

  function guideLink(anchor, text, className) {
    const a = document.createElement('a');
    a.href = `/test-case-guide.html${anchor ? '#' + anchor : ''}`;
    a.target = '_blank';
    a.rel = 'noopener';
    a.className = className || 'test-case-help-link';
    a.title = `Open ${text}`;
    a.setAttribute('aria-label', `Open ${text}`);
    a.innerHTML = className === 'field-help-link' ? text : `${icon}<span>${text}</span>`;
    return a;
  }

  function attachFieldHelp(inputId, anchor, text) {
    const input = document.getElementById(inputId);
    const field = input?.closest('.field');
    const label = field?.querySelector('label');
    if (!label || label.querySelector('.field-help-link')) return;
    label.appendChild(guideLink(anchor, text, 'field-help-link'));
  }

  function install() {
    const modal = document.getElementById('editorModal');
    const card = modal?.querySelector('.modal-card');
    if (!card || document.getElementById('testCaseHelpBar')) return;
    addStyles();

    const heading = document.getElementById('editorHeading');
    const bar = document.createElement('div');
    bar.id = 'testCaseHelpBar';
    bar.className = 'test-case-help-bar';
    bar.appendChild(guideLink('', 'Test Case Writing Guide'));
    if (heading) heading.insertAdjacentElement('afterend', bar);
    else card.prepend(bar);

    attachFieldHelp('editPreconditions', 'preconditions', 'How to write');
    attachFieldHelp('editSteps', 'steps', 'Syntax & examples');
    attachFieldHelp('editExpected', 'expected', 'How to write');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();

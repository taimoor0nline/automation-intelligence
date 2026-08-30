(function () {
  if (window.__testNexusManualCypressAuthoring) return;
  window.__testNexusManualCypressAuthoring = true;

  const stepField = document.getElementById('editSteps');
  const expectedField = document.getElementById('editExpected');
  const saveBtn = document.getElementById('saveEditorBtn');
  const modeSelect = document.getElementById('testCreationModeSelect');
  const modeHint = document.getElementById('testCreationModeHint');
  const templateSection = document.getElementById('templateSection');
  const applyTemplateBtn = document.getElementById('applyTemplateBtn');
  const templateSelect = document.getElementById('templateSelect');
  if (!stepField || !expectedField || !saveBtn) return;

  const style = document.createElement('style');
  style.textContent = `
    .manual-cypress-help{display:none;margin:0 0 14px;border:1px solid #bfdbfe;border-radius:10px;background:#f8fbff;overflow:hidden}
    .manual-cypress-help.show{display:block}
    .manual-cypress-help-head{padding:11px 13px;border-bottom:1px solid #dbeafe;color:#1d4ed8;font-size:11.5px;font-weight:800}
    .manual-cypress-help-body{padding:11px 13px;color:#475569;font-size:10.5px;line-height:1.55}
    .manual-cypress-help code{font-family:Consolas,Monaco,monospace;color:#0f172a;background:#eaf1ff;padding:1px 4px;border-radius:4px}
    .manual-cypress-help pre{margin:8px 0 0;padding:9px 10px;border-radius:8px;background:#0f172a;color:#e2e8f0;overflow:auto;font:10px/1.55 Consolas,Monaco,monospace}
    .manual-cypress-help details{margin-top:8px}.manual-cypress-help summary{cursor:pointer;font-weight:800;color:#334155}
    .manual-cypress-rule{margin-top:8px;padding:8px 9px;border-radius:7px;background:#eff6ff;color:#1e40af}
  `;
  document.head.appendChild(style);

  const help = document.createElement('div');
  help.id = 'manualCypressHelp';
  help.className = 'manual-cypress-help';
  help.innerHTML = `
    <div class="manual-cypress-help-head">Manual test authoring · Cypress syntax</div>
    <div class="manual-cypress-help-body">
      Write executable <b>Cypress-style commands</b> instead of narrative instructions. Use one command/assertion per line and use exact selectors discovered from the application.
      <pre>Steps
cy.visit('/feedback')
cy.get('[data-testid="age"]').clear().type('17')
cy.get('[data-testid="submit-feedback"]').click()

Expected Results
cy.get('[data-testid="age-error"]').should('be.visible')
cy.get('[data-testid="age-error"]').should('contain.text', 'Age must be at least 18')
cy.location('pathname').should('eq', '/feedback')</pre>
      <div class="manual-cypress-rule"><b>Do not write:</b> “Enter invalid age”, “click submit”, or “validation should appear”. TestNexus accepts the supported Cypress subset below and converts it into the deterministic automation contract; it does not execute arbitrary pasted JavaScript.</div>
      <details><summary>Supported manual Cypress commands</summary>
        <div style="margin-top:6px">
          <code>cy.visit('/path')</code>, <code>cy.reload()</code>, <code>cy.go('back')</code>, <code>cy.go('forward')</code>, <code>cy.viewport(1280, 720)</code><br>
          <code>cy.get('selector').clear().type('value')</code>, <code>.clear()</code>, <code>.click()</code>, <code>.dblclick()</code>, <code>.rightclick()</code>, <code>.select('value')</code>, <code>.check()</code>, <code>.uncheck()</code>, <code>.focus()</code>, <code>.blur()</code>, <code>.submit()</code>, <code>.scrollIntoView()</code>, <code>.type('{enter}')</code>.
        </div>
      </details>
      <details><summary>Supported manual Cypress assertions</summary>
        <div style="margin-top:6px">
          <code>should('exist')</code>, <code>should('not.exist')</code>, <code>should('be.visible')</code>, <code>should('not.be.visible')</code>, enabled/disabled, checked/unchecked, focused, required attribute, value/text equality and contains, selected value, attributes, classes, CSS, element count, URL/path and title assertions.
        </div>
      </details>
    </div>`;

  const anchor = templateSection || stepField.closest('.field');
  if (anchor) anchor.insertAdjacentElement('beforebegin', help);

  stepField.placeholder = "One Cypress command per line. Example: cy.get('[data-testid=\"age\"]').clear().type('17')";
  expectedField.placeholder = "One Cypress assertion per line. Example: cy.get('[data-testid=\"age-error\"]').should('be.visible')";
  const templateNote = templateSection?.lastChild;
  if (templateSection) {
    const textNodes = [...templateSection.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
    for (const node of textNodes) node.textContent = ' Templates insert editable Cypress syntax. Replace placeholder paths/selectors/values with evidence from the discovered application before saving. ';
  }

  function isManualMode() {
    return modeSelect?.value === 'manual';
  }

  function updateManualHelp() {
    const manual = isManualMode();
    help.classList.toggle('show', manual);
    const assertionAdvisor = document.getElementById('editorAssertionAi');
    if (assertionAdvisor && manual) assertionAdvisor.style.display = 'none';
    if (modeHint && manual) modeHint.textContent = 'Write Steps and Expected Results using the supported Cypress syntax. Human-language automation instructions are not accepted for a new manual test.';
  }
  modeSelect?.addEventListener('change', updateManualHelp);

  function stripSemicolon(value) {
    return String(value || '').trim().replace(/;\s*$/, '').trim();
  }

  function readStringLiteral(value) {
    const source = String(value ?? '').trim();
    if (source.length < 2) return null;
    const quote = source[0];
    if (!['\"', "'", '`'].includes(quote) || source[source.length - 1] !== quote) return null;
    let body = source.slice(1, -1);
    body = body.replace(/\\\\/g, '\u0000');
    const escapedQuote = new RegExp('\\\\' + quote.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    body = body.replace(escapedQuote, quote).replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t').replace(/\u0000/g, '\\');
    return body;
  }

  function splitArgs(value) {
    const source = String(value || '');
    const out = [];
    let current = '';
    let quote = '';
    let escaped = false;
    let depth = 0;
    for (const ch of source) {
      if (escaped) { current += ch; escaped = false; continue; }
      if (ch === '\\') { current += ch; escaped = true; continue; }
      if (quote) {
        current += ch;
        if (ch === quote) quote = '';
        continue;
      }
      if (['\"', "'", '`'].includes(ch)) { quote = ch; current += ch; continue; }
      if (ch === '(' || ch === '[' || ch === '{') { depth += 1; current += ch; continue; }
      if (ch === ')' || ch === ']' || ch === '}') { depth = Math.max(0, depth - 1); current += ch; continue; }
      if (ch === ',' && depth === 0) { out.push(current.trim()); current = ''; continue; }
      current += ch;
    }
    if (current.trim() || source.trim()) out.push(current.trim());
    return out;
  }

  function methodArgs(chain, method) {
    const regex = new RegExp('\\.' + method.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\(([^)]*)\\)', 'i');
    const match = String(chain || '').match(regex);
    return match ? splitArgs(match[1]) : null;
  }

  function parseGet(line) {
    const source = stripSemicolon(line);
    const match = source.match(/^cy\.get\(\s*([\"'`])([\s\S]*?)\1\s*\)([\s\S]*)$/);
    if (!match) return null;
    return { selector: match[2], chain: match[3] || '' };
  }

  const KEY_MAP = Object.freeze({ '{enter}':'enter','{esc}':'esc','{escape}':'escape','{uparrow}':'uparrow','{downarrow}':'downarrow','{leftarrow}':'leftarrow','{rightarrow}':'rightarrow','{home}':'home','{end}':'end','{backspace}':'backspace','{del}':'del','{delete}':'delete' });

  function parseCypressStep(line) {
    const source = stripSemicolon(line);
    let match = source.match(/^cy\.visit\(\s*([\"'`])([\s\S]*?)\1\s*\)$/);
    if (match) return { action: 'navigate', target: 'page', value: match[2] };
    if (/^cy\.reload\(\s*\)$/.test(source)) return { action: 'reload', target: '', value: null };
    match = source.match(/^cy\.go\(\s*([\"'`])(back|forward)\1\s*\)$/i);
    if (match) return { action: `go ${match[2].toLowerCase()}`, target: '', value: null };
    match = source.match(/^cy\.viewport\(\s*(\d{2,5})\s*,\s*(\d{2,5})\s*\)$/i);
    if (match) return { action: `set viewport ${match[1]} x ${match[2]}`, target: '', value: `${match[1]} x ${match[2]}` };

    const get = parseGet(source);
    if (!get) throw new Error(`Unsupported Cypress step: ${line}`);
    const { selector, chain } = get;

    const typeArgs = methodArgs(chain, 'type');
    if (typeArgs) {
      if (typeArgs.length !== 1) throw new Error(`Cypress .type() requires one deterministic value: ${line}`);
      const value = readStringLiteral(typeArgs[0]);
      if (value === null) throw new Error(`Cypress .type() value must be a quoted literal: ${line}`);
      const key = KEY_MAP[String(value).toLowerCase()];
      return key ? { action: 'press key', target: selector, value: key } : value === '' ? { action: 'clear', target: selector, value: null } : { action: 'fill', target: selector, value };
    }
    const selectArgs = methodArgs(chain, 'select');
    if (selectArgs) {
      const value = readStringLiteral(selectArgs[0]);
      if (value === null) throw new Error(`Cypress .select() value must be a quoted literal: ${line}`);
      return { action: 'select', target: selector, value };
    }
    if (/\.uncheck\(\s*\)/i.test(chain)) return { action: 'uncheck', target: selector, value: null };
    if (/\.check\(\s*\)/i.test(chain)) return { action: 'check', target: selector, value: null };
    if (/\.dblclick\(\s*\)/i.test(chain)) return { action: 'double click', target: selector, value: null };
    if (/\.rightclick\(\s*\)/i.test(chain)) return { action: 'right click', target: selector, value: null };
    if (/\.click\(\s*\)/i.test(chain)) return { action: 'click', target: selector, value: null };
    if (/\.focus\(\s*\)/i.test(chain)) return { action: 'focus', target: selector, value: null };
    if (/\.blur\(\s*\)/i.test(chain)) return { action: 'blur', target: selector, value: null };
    if (/\.submit\(\s*\)/i.test(chain)) return { action: 'submit form', target: selector, value: null };
    if (/\.scrollIntoView\(\s*\)/i.test(chain)) return { action: 'scroll into view', target: selector, value: null };
    const triggerArgs = methodArgs(chain, 'trigger');
    if (triggerArgs && ['mouseover','mouseenter'].includes(String(readStringLiteral(triggerArgs[0]) || '').toLowerCase())) return { action: 'hover', target: selector, value: null };
    if (/\.clear\(\s*\)/i.test(chain)) return { action: 'clear', target: selector, value: null };
    throw new Error(`Unsupported Cypress action chain: ${line}`);
  }

  function quoted(value) {
    return `\"${String(value ?? '').replace(/\\/g, '\\\\').replace(/\"/g, '\\"')}\"`;
  }

  function parseShouldArgs(source) {
    const match = stripSemicolon(source).match(/\.should\(([\s\S]*)\)$/);
    if (!match) return null;
    const args = splitArgs(match[1]);
    if (!args.length) return null;
    const condition = readStringLiteral(args[0]);
    if (condition === null) return null;
    return { condition: condition.toLowerCase(), args: args.slice(1).map((arg) => {
      const str = readStringLiteral(arg);
      if (str !== null) return str;
      const n = Number(arg);
      return Number.isFinite(n) ? n : arg;
    }) };
  }

  function parseElementAssertion(line) {
    const get = parseGet(line);
    if (!get || !/\.should\(/.test(get.chain)) return null;
    const parsed = parseShouldArgs(line);
    if (!parsed) throw new Error(`Unsupported Cypress assertion: ${line}`);
    const { selector } = get;
    const { condition, args } = parsed;
    const first = args[0];
    const second = args[1];
    const simple = {
      'exist': `Element ${selector} exists`,
      'not.exist': `Element ${selector} does not exist`,
      'be.visible': `Element ${selector} is visible`,
      'not.be.visible': `Element ${selector} is hidden`,
      'be.hidden': `Element ${selector} is hidden`,
      'be.enabled': `Element ${selector} is enabled`,
      'be.disabled': `Element ${selector} is disabled`,
      'be.checked': `Element ${selector} is checked`,
      'not.be.checked': `Element ${selector} is unchecked`,
      'be.focused': `Element ${selector} is focused`,
    };
    if (simple[condition]) return simple[condition];
    if (condition === 'have.value') return `Value of ${selector} equals ${quoted(first)}`;
    if (condition === 'contain.value' || condition === 'include.value') return `Value of ${selector} contains ${quoted(first)}`;
    if (condition === 'have.text') return `Text in ${selector} equals ${quoted(first)}`;
    if (condition === 'contain.text' || condition === 'include.text') return `Text in ${selector} contains ${quoted(first)}`;
    if (condition === 'not.contain.text' || condition === 'not.include.text') return `Text in ${selector} does not contain ${quoted(first)}`;
    if (condition === 'have.attr') {
      if (second !== undefined) return `Attribute ${quoted(first)} of ${selector} equals ${quoted(second)}`;
      if (String(first).toLowerCase() === 'required') return `Element ${selector} is required`;
      return `Attribute ${quoted(first)} of ${selector} exists`;
    }
    if (condition === 'not.have.attr') {
      if (String(first).toLowerCase() === 'required') return `Element ${selector} is optional`;
      return `Attribute ${quoted(first)} of ${selector} is absent`;
    }
    if (condition === 'have.class') return `Element ${selector} has class ${quoted(first)}`;
    if (condition === 'not.have.class') return `Element ${selector} does not have class ${quoted(first)}`;
    if (condition === 'have.css') return `CSS property ${quoted(first)} of ${selector} equals ${quoted(second)}`;
    if (condition === 'have.prop') return `Property ${quoted(first)} of ${selector} equals ${quoted(second)}`;
    if (condition === 'have.length') return `Count of ${selector} equals ${Number(first)}`;
    if (condition === 'match' && first === ':invalid') return `Element ${selector} is invalid`;
    throw new Error(`Unsupported Cypress should() condition '${condition}': ${line}`);
  }

  function parseCypressAssertion(line) {
    const source = stripSemicolon(line);
    const element = parseElementAssertion(source);
    if (element) return element;

    let parsed = parseShouldArgs(source);
    if (!parsed) throw new Error(`Expected a supported Cypress assertion: ${line}`);
    const first = parsed.args[0];
    if (/^cy\.url\(\)\.should\(/.test(source)) {
      if (parsed.condition === 'eq') return `URL equals ${quoted(first)}`;
      if (['include','contain'].includes(parsed.condition)) return `URL includes ${quoted(first)}`;
      if (['not.include','not.contain'].includes(parsed.condition)) return `URL does not include ${quoted(first)}`;
    }
    const location = source.match(/^cy\.location\(\s*([\"'`])([^\"'`]+)\1\s*\)\.should\(/);
    if (location && location[2].toLowerCase() === 'pathname') {
      if (parsed.condition === 'eq') return `Path equals ${quoted(first)}`;
      if (['include','contain'].includes(parsed.condition)) return `Path includes ${quoted(first)}`;
    }
    if (/^cy\.title\(\)\.should\(/.test(source)) {
      if (parsed.condition === 'eq') return `Title equals ${quoted(first)}`;
      if (['include','contain'].includes(parsed.condition)) return `Title includes ${quoted(first)}`;
    }
    throw new Error(`Unsupported Cypress assertion: ${line}`);
  }

  const CYPRESS_TEMPLATES = Object.freeze({
    functional: {
      type: 'functional',
      steps: [
        "cy.visit('/replace-with-discovered-path')",
        "cy.get('[data-testid=\"replace-with-action-control\"]').click()",
      ],
      assertions: [
        "cy.get('[data-testid=\"replace-with-result-element\"]').should('be.visible')",
      ],
    },
    validation: {
      type: 'negative',
      steps: [
        "cy.visit('/replace-with-discovered-path')",
        "cy.get('[data-testid=\"field-under-test\"]').clear().type('invalid-value')",
        "cy.get('[data-testid=\"submit-button\"]').click()",
      ],
      assertions: [
        "cy.get('[data-testid=\"field-error\"]').should('be.visible')",
        "cy.get('[data-testid=\"field-error\"]').should('contain.text', 'replace-with-evidenced-validation-text')",
      ],
    },
    boundary: {
      type: 'boundary',
      steps: [
        "cy.visit('/replace-with-discovered-path')",
        "cy.get('[data-testid=\"field-under-test\"]').clear().type('boundary-value')",
        "cy.get('[data-testid=\"submit-button\"]').click()",
      ],
      assertions: [
        "cy.get('[data-testid=\"field-under-test\"]').should('have.value', 'boundary-value')",
      ],
    },
    negative: {
      type: 'negative',
      steps: [
        "cy.visit('/replace-with-discovered-path')",
        "cy.get('[data-testid=\"control-under-test\"]').click()",
      ],
      assertions: [
        "cy.get('[data-testid=\"error-or-blocked-state\"]').should('be.visible')",
      ],
    },
    blank: { type: 'custom', steps: [], assertions: [] },
  });

  applyTemplateBtn?.addEventListener('click', (event) => {
    if (!isManualMode()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const template = CYPRESS_TEMPLATES[templateSelect?.value] || CYPRESS_TEMPLATES.functional;
    const type = document.getElementById('editType');
    if (type) { type.value = template.type; type.dispatchEvent(new Event('change', { bubbles: true })); }
    stepField.value = template.steps.join('\n');
    expectedField.value = template.assertions.join('\n');
  }, true);

  let pendingSave = null;
  saveBtn.addEventListener('click', (event) => {
    if (!isManualMode()) return;
    try {
      const rawSteps = String(stepField.value || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const rawAssertions = String(expectedField.value || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      if (!rawSteps.length) throw new Error('At least one Cypress command is required in Steps.');
      if (!rawAssertions.length) throw new Error('At least one Cypress assertion is required in Expected Results.');
      if (rawSteps.some((line) => !/^cy\./.test(line))) throw new Error('Manual Steps must use Cypress syntax. Human-language step lines are not accepted.');
      if (rawAssertions.some((line) => !/^cy\./.test(line))) throw new Error('Manual Expected Results must use Cypress assertion syntax. Human-language expectation lines are not accepted.');

      const parsedSteps = rawSteps.map(parseCypressStep);
      const parsedAssertions = rawAssertions.map(parseCypressAssertion);
      pendingSave = {
        index: Number(document.getElementById('editIndex')?.value || -1),
        cypressSteps: rawSteps,
        cypressAssertions: rawAssertions,
      };
      stepField.value = parsedSteps.map((step) => [step.action || '', step.target || '', step.value ?? ''].join(' | ').replace(/\s+\|\s+\|\s*$/, '').replace(/\s+\|\s*$/, '')).join('\n');
      expectedField.value = parsedAssertions.join('\n');

      setTimeout(() => {
        try {
          if (!pendingSave || typeof testCases === 'undefined') return;
          const savedIndex = pendingSave.index < 0 ? 0 : pendingSave.index;
          const tc = testCases[savedIndex];
          if (tc) {
            tc.manualAuthoringSyntax = 'cypress';
            tc.cypressSteps = [...pendingSave.cypressSteps];
            tc.cypressAssertions = [...pendingSave.cypressAssertions];
            tc.source = tc.source || 'human';
          }
          pendingSave = null;
          if (typeof renderCases === 'function') renderCases();
        } catch (err) { console.warn('[manual-cypress] could not retain Cypress source metadata', err); }
      }, 0);
    } catch (err) {
      event.preventDefault();
      event.stopImmediatePropagation();
      alert(err.message);
    }
  }, true);

  const previousOpenEditor = window.openEditor;
  if (typeof previousOpenEditor === 'function') {
    window.openEditor = function (index) {
      previousOpenEditor(index);
      const numericIndex = Number(index);
      if (numericIndex >= 0 && typeof testCases !== 'undefined') {
        const tc = testCases[numericIndex];
        if (tc?.manualAuthoringSyntax === 'cypress') {
          if (Array.isArray(tc.cypressSteps)) stepField.value = tc.cypressSteps.join('\n');
          if (Array.isArray(tc.cypressAssertions)) expectedField.value = tc.cypressAssertions.join('\n');
          help.classList.add('show');
          const assertionAdvisor = document.getElementById('editorAssertionAi');
          if (assertionAdvisor) assertionAdvisor.style.display = 'none';
        }
      }
    };
    try { openEditor = window.openEditor; } catch {}
  }

  updateManualHelp();
})();

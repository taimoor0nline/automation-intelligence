const v5 = require('./deterministicAutomationGeneratorV5');
const v4 = require('./deterministicAutomationGeneratorV4');

function js(value) { return JSON.stringify(value); }
function cssAttr(value) { return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }

function emitResolvedFiles(selector, fileNames, { dragDrop = false } = {}) {
  const names = Array.isArray(fileNames) ? fileNames : [];
  if (!selector) throw new Error('File interaction requires a grounded selector.');
  if (!names.length) throw new Error('File interaction requires at least one approved fixture.');
  if (names.length > 10) throw new Error('A single file interaction supports at most 10 approved fixtures.');
  const vars = names.map((_, index) => `filePath${index}`);
  const filesExpression = names.length === 1 ? vars[0] : `[${vars.join(', ')}]`;
  const options = dragDrop ? `, { action: 'drag-drop' }` : '';
  let expression = `cy.get(${js(selector)}).selectFile(${filesExpression}${options})`;
  for (let index = names.length - 1; index >= 0; index -= 1) {
    expression = `cy.task('testNexusResolveUploadFixture', ${js(names[index])}, { log:false }).then((${vars[index]}) => ${expression})`;
  }
  return `    ${expression};`;
}

function emitNativeInputValue(selector, value, inputType) {
  if (!selector) throw new Error(`${inputType} interaction requires a grounded selector.`);
  return `    cy.get(${js(selector)}).then(($input) => { const el=$input[0]; const win=el.ownerDocument.defaultView; const setter=Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype,'value')?.set; if(typeof setter!=='function') throw new Error(${js(`Native ${inputType} value setter is unavailable.`)}); setter.call(el, ${js(String(value))}); }).trigger('input').trigger('change');`;
}

function suggestionListSelector(contract = {}) {
  if (contract.suggestionListSelector) return String(contract.suggestionListSelector);
  if (contract.suggestionListId) return `[id="${cssAttr(contract.suggestionListId)}"]`;
  throw new Error('Searchable suggestion interaction requires a grounded listbox relationship.');
}

function optionMatchBody(expected) {
  return `const text=String(el.textContent||'').trim().replace(/\\s+/g,' '); const value=String(el.getAttribute('data-value')||el.getAttribute('value')||el.getAttribute('aria-label')||'').trim(); return text===${js(String(expected))}||value===${js(String(expected))};`;
}

function emitSuggestionClick(contract, expected) {
  const listSelector = suggestionListSelector(contract);
  return `cy.get(${js(listSelector)}).should('be.visible').find('[role="option"]').filter((_,el)=>{ ${optionMatchBody(expected)} }).first().should('be.visible').and('not.have.attr','aria-disabled','true').click()`;
}

function emitSuggestionTraversal(contract, expected, { click = false } = {}) {
  const listSelector = suggestionListSelector(contract);
  const maxAttempts = Math.max(1, Math.min(Number(contract.suggestionTraversalMaxAttempts || 24), 50));
  const found = click
    ? `return cy.wrap($match,{log:false}).scrollIntoView().should('be.visible').and('not.have.attr','aria-disabled','true').click();`
    : `return cy.wrap($match,{log:false}).scrollIntoView().should('be.visible');`;
  return `cy.then(()=>{ const seek=(attempt=0)=>cy.get(${js(listSelector)}).should('be.visible').then(($list)=>{ const $matches=$list.find('[role="option"]').filter((_,el)=>{ ${optionMatchBody(expected)} }); if($matches.length){ const $match=$matches.first(); ${found} } if(attempt>=${maxAttempts}) throw new Error(${js(`Suggestion ${String(expected)} was not rendered within the bounded traversal limit.`)}); const el=$list[0]; const before=Number(el.scrollTop||0); const maxTop=Math.max(0,Number(el.scrollHeight||0)-Number(el.clientHeight||0)); const step=Math.max(48,Math.floor(Number(el.clientHeight||240)*0.8)); const next=Math.min(maxTop,before+step); if(next<=before) throw new Error(${js(`Suggestion ${String(expected)} was not found and the list cannot scroll further.`)}); return cy.wrap($list,{log:false}).scrollTo(0,next,{duration:0,ensureScrollable:false,log:false}).then(()=>cy.wait(40,{log:false})).then(()=>seek(attempt+1)); }); return seek(0); })`;
}

function exactRemoveTarget(contract, expected) {
  const wanted = String(expected || '').trim().toLowerCase();
  return (Array.isArray(contract.removeTagTargets) ? contract.removeTagTargets : []).find((item) => String(item?.value || '').trim().toLowerCase() === wanted) || null;
}

function dynamicRemoveChain(contract, expected) {
  const listId = String(contract.suggestionListId || '').trim();
  const prefix = String(contract.removeTagPattern?.prefix || '').trimEnd();
  if (!listId || !prefix) throw new Error('Selected-tag removal requires a grounded listbox relation and discovered semantic remove-label pattern.');
  const expectedLabel = `${prefix} ${String(expected)}`.replace(/\s+/g, ' ').trim();
  return `cy.get('body').find('button,[role="button"],input[type="button"],input[type="reset"]').filter((_,el)=>{ const controls=String(el.getAttribute('aria-controls')||el.getAttribute('aria-owns')||'').trim(); const label=String(el.getAttribute('aria-label')||el.getAttribute('title')||el.textContent||'').trim().replace(/\\s+/g,' '); return controls===${js(listId)}&&label===${js(expectedLabel)}; }).should('have.length',1).first()`;
}

function emitRemoveSelectedTag(contract, expected) {
  const target = exactRemoveTarget(contract, expected);
  if (target?.selector) return `cy.get(${js(target.selector)}).should('be.visible').and('not.be.disabled').click()`;
  return `${dynamicRemoveChain(contract, expected)}.should('be.visible').click()`;
}

function emitSelectedTagAssertion(assertion, expected, present) {
  const target = exactRemoveTarget(assertion, expected);
  if (target?.selector) {
    if (present) return `    cy.get(${js(target.selector)}).should('be.visible');`;
    return `    cy.get('body').find(${js(target.selector)}).should('have.length',0);`;
  }
  const chain = dynamicRemoveChain(assertion, expected);
  return present ? `    ${chain}.should('be.visible');` : `    ${chain}.should('have.length',0);`;
}

function emitAction(action) {
  if (action?.operation === 'TYPE_RUNTIME_CREDENTIAL') {
    const credential = String(action.credential || '').trim().toLowerCase();
    if (!['username','password'].includes(credential)) throw new Error(`Unsupported runtime credential: ${credential || 'missing'}`);
    if (!action.selector) throw new Error(`TYPE_RUNTIME_CREDENTIAL requires a grounded selector for ${credential}.`);
    return `    cy.typeRuntimeCredential(${js(action.selector)}, ${js(credential)});`;
  }
  if (action?.operation === 'LOGIN_AS_ACTOR') {
    const actorRef = String(action.actorRef || '').trim();
    if (!actorRef) throw new Error('LOGIN_AS_ACTOR requires actorRef.');
    return `    cy.loginAsTestActor(${js(actorRef)});`;
  }
  if (action?.operation === 'SUBMIT') {
    if (!action.selector) throw new Error('SUBMIT requires a grounded selector.');
    return `    cy.get(${js(action.selector)}).then(($el) => { if ($el.is('form')) cy.wrap($el).submit(); else cy.wrap($el).click(); });`;
  }
  if (action?.operation === 'SET_RANGE_VALUE') {
    const value = String(action.value ?? '');
    if (!value) throw new Error('SET_RANGE_VALUE requires a numeric value.');
    return emitNativeInputValue(action.selector, value, 'range');
  }
  if (action?.operation === 'SET_COLOR_VALUE') {
    const value = String(action.value ?? '').toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(value)) throw new Error('SET_COLOR_VALUE requires #RRGGBB.');
    return emitNativeInputValue(action.selector, value, 'color');
  }
  if (action?.operation === 'SELECT_MULTIPLE') {
    if (!action.selector) throw new Error('SELECT_MULTIPLE requires a grounded selector.');
    if (!Array.isArray(action.values) || !action.values.length) throw new Error('SELECT_MULTIPLE requires at least one selected value.');
    return `    cy.get(${js(action.selector)}).select(${js(action.values)});`;
  }
  if (action?.operation === 'DROP_FILE') return emitResolvedFiles(action.selector, [action.fileName], { dragDrop: true });
  if (action?.operation === 'SELECT_FILES') return emitResolvedFiles(action.selector, action.fileNames, { dragDrop: false });
  if (action?.operation === 'DROP_FILES') return emitResolvedFiles(action.selector, action.fileNames, { dragDrop: true });

  if (action?.operation === 'OPEN_COMBOBOX') {
    if (!action.selector) throw new Error('OPEN_COMBOBOX requires a grounded selector.');
    return `    cy.get(${js(action.selector)}).then(($el)=>{ if(String($el.attr('aria-expanded')||'').toLowerCase()!=='true') cy.wrap($el).click(); });`;
  }
  if (action?.operation === 'CLOSE_COMBOBOX') {
    if (!action.selector) throw new Error('CLOSE_COMBOBOX requires a grounded selector.');
    return `    cy.get(${js(action.selector)}).then(($el)=>{ if(String($el.attr('aria-expanded')||'').toLowerCase()==='true') cy.wrap($el).trigger('keydown',{key:'Escape',code:'Escape',keyCode:27,which:27}); });`;
  }
  if (action?.operation === 'SEARCH_SUGGESTIONS') {
    if (!action.selector || !String(action.query || '').trim()) throw new Error('SEARCH_SUGGESTIONS requires a grounded editable selector and non-empty query.');
    return `    cy.get(${js(action.selector)}).clear().type(${js(String(action.query))});`;
  }
  if (action?.operation === 'CLEAR_SUGGESTION_SEARCH') {
    if (!action.selector) throw new Error('CLEAR_SUGGESTION_SEARCH requires a grounded editable selector.');
    return `    cy.get(${js(action.selector)}).clear();`;
  }
  if (action?.operation === 'SELECT_SUGGESTION') {
    if (!action.selector || !String(action.value || '').trim()) throw new Error('SELECT_SUGGESTION requires a grounded control and evidenced suggestion value.');
    const click = emitSuggestionClick(action, String(action.value));
    return `    cy.get(${js(action.selector)}).then(($el)=>{ if(String($el.attr('aria-expanded')||'').toLowerCase()!=='true') cy.wrap($el).click(); }).then(()=>${click});`;
  }
  if (action?.operation === 'SELECT_SUGGESTIONS') {
    const values = Array.isArray(action.values) ? action.values.map(String).filter(Boolean) : [];
    if (!action.selector || !values.length) throw new Error('SELECT_SUGGESTIONS requires a grounded searchable control and one or more evidenced options.');
    const listSelector = suggestionListSelector(action);
    return `    cy.wrap(${js(values)},{log:false}).each((expected)=>{ cy.get(${js(action.selector)}).then(($el)=>{ if(String($el.attr('aria-expanded')||'').toLowerCase()!=='true') cy.wrap($el).click(); }).then(()=>{ cy.get(${js(action.selector)}).clear().type(String(expected)); cy.get(${js(listSelector)}).should('be.visible').find('[role="option"]').filter((_,el)=>{ const text=String(el.textContent||'').trim().replace(/\\s+/g,' '); const value=String(el.getAttribute('data-value')||el.getAttribute('value')||el.getAttribute('aria-label')||'').trim(); return text===String(expected)||value===String(expected); }).first().should('be.visible').and('not.have.attr','aria-disabled','true').click(); }); });`;
  }
  if (action?.operation === 'SCROLL_SUGGESTIONS_TO_VALUE') {
    if (!action.selector || !String(action.value || '').trim()) throw new Error('SCROLL_SUGGESTIONS_TO_VALUE requires a grounded control and evidenced suggestion value.');
    const traversal = emitSuggestionTraversal(action, String(action.value), { click: false });
    return `    cy.get(${js(action.selector)}).then(($el)=>{ if(String($el.attr('aria-expanded')||'').toLowerCase()!=='true') cy.wrap($el).click(); }).then(()=>${traversal});`;
  }
  if (action?.operation === 'SELECT_SUGGESTION_BY_TRAVERSAL') {
    if (!action.selector || !String(action.value || '').trim()) throw new Error('SELECT_SUGGESTION_BY_TRAVERSAL requires a grounded control and evidenced suggestion value.');
    const traversal = emitSuggestionTraversal(action, String(action.value), { click: true });
    return `    cy.get(${js(action.selector)}).then(($el)=>{ if(String($el.attr('aria-expanded')||'').toLowerCase()!=='true') cy.wrap($el).click(); }).then(()=>${traversal});`;
  }
  if (action?.operation === 'REMOVE_SELECTED_TAG') {
    if (!action.selector || !String(action.value || '').trim()) throw new Error('REMOVE_SELECTED_TAG requires a grounded multi-select control and exact selected value.');
    return `    ${emitRemoveSelectedTag(action, String(action.value))};`;
  }
  if (action?.operation === 'CLEAR_SELECTED_TAGS') {
    if (!action.selector || !action.clearTagsSelector) throw new Error('CLEAR_SELECTED_TAGS requires a grounded multi-select control and discovered clear-all control.');
    return `    cy.get(${js(action.clearTagsSelector)}).should('be.visible').and('not.be.disabled').click();`;
  }
  return v5.emitAction(action);
}

function emitAssertion(assertion) {
  if (assertion?.operation === 'ASSERT_SELECTED_VALUES_EQUALS') {
    if (!assertion.selector) throw new Error('ASSERT_SELECTED_VALUES_EQUALS requires a grounded selector.');
    const values = Array.isArray(assertion.values) ? assertion.values.map(String) : [];
    return `    cy.get(${js(assertion.selector)}).should(($select) => { const actual=Array.from($select[0].selectedOptions||[]).map((option)=>String(option.value)); expect(actual).to.deep.eq(${js(values)}); });`;
  }
  if (assertion?.operation === 'ASSERT_COMBOBOX_EXPANDED') return `    cy.get(${js(assertion.selector)}).should('have.attr','aria-expanded','true');`;
  if (assertion?.operation === 'ASSERT_COMBOBOX_COLLAPSED') return `    cy.get(${js(assertion.selector)}).should(($el)=>{ expect(String($el.attr('aria-expanded')||'false').toLowerCase()).to.eq('false'); });`;
  if (['ASSERT_SUGGESTION_VISIBLE','ASSERT_SEARCH_SUGGESTIONS_CONTAIN','ASSERT_SUGGESTION_NOT_VISIBLE','ASSERT_SUGGESTION_SELECTED'].includes(assertion?.operation)) {
    const expected = String(assertion.value ?? assertion.text ?? '');
    if (!expected) throw new Error(`${assertion.operation} requires a grounded suggestion value.`);
    const listSelector = suggestionListSelector(assertion);
    if (assertion.operation === 'ASSERT_SUGGESTION_NOT_VISIBLE') {
      return `    cy.get(${js(listSelector)}).find('[role="option"]').filter((_,el)=>{ ${optionMatchBody(expected)} }).should('have.length',0);`;
    }
    if (assertion.operation === 'ASSERT_SUGGESTION_SELECTED') {
      return `    cy.get(${js(listSelector)}).find('[role="option"]').filter((_,el)=>{ ${optionMatchBody(expected)} }).first().should('have.attr','aria-selected','true');`;
    }
    return `    cy.get(${js(listSelector)}).should('be.visible').find('[role="option"]').filter((_,el)=>{ ${optionMatchBody(expected)} }).first().should('be.visible');`;
  }
  if (assertion?.operation === 'ASSERT_NO_SUGGESTIONS') {
    const listSelector = suggestionListSelector(assertion);
    return `    cy.get('body').then(($body)=>{ const $list=$body.find(${js(listSelector)}); if(!$list.length||!$list.is(':visible')) return; expect($list.find('[role="option"]:visible').length).to.eq(0); });`;
  }
  if (assertion?.operation === 'ASSERT_SELECTED_SUGGESTIONS_EQUALS') {
    const values = Array.isArray(assertion.values) ? assertion.values.map(String) : [];
    const listSelector = suggestionListSelector(assertion);
    return `    cy.get(${js(listSelector)}).find('[role="option"][aria-selected="true"]').then(($options)=>{ const actual=Array.from($options).map((el)=>String(el.getAttribute('data-value')||el.getAttribute('value')||el.getAttribute('aria-label')||el.textContent||'').trim()); expect(actual).to.deep.eq(${js(values)}); });`;
  }
  if (assertion?.operation === 'ASSERT_SELECTED_TAG_PRESENT') {
    const expected = String(assertion.value ?? assertion.text ?? '');
    if (!expected) throw new Error('ASSERT_SELECTED_TAG_PRESENT requires an exact selected value.');
    return emitSelectedTagAssertion(assertion, expected, true);
  }
  if (assertion?.operation === 'ASSERT_SELECTED_TAG_ABSENT') {
    const expected = String(assertion.value ?? assertion.text ?? '');
    if (!expected) throw new Error('ASSERT_SELECTED_TAG_ABSENT requires an exact selected value.');
    return emitSelectedTagAssertion(assertion, expected, false);
  }
  if (assertion?.operation === 'ASSERT_NO_SELECTED_TAGS') {
    const listId = String(assertion.suggestionListId || '').trim();
    const prefix = String(assertion.removeTagPattern?.prefix || '').trimEnd();
    if (!listId || !prefix) throw new Error('ASSERT_NO_SELECTED_TAGS requires a grounded list relation and discovered semantic remove-label pattern.');
    return `    cy.get('body').find('button,[role="button"],input[type="button"],input[type="reset"]').filter((_,el)=>{ const controls=String(el.getAttribute('aria-controls')||el.getAttribute('aria-owns')||'').trim(); const label=String(el.getAttribute('aria-label')||el.getAttribute('title')||el.textContent||'').trim().replace(/\\s+/g,' '); return controls===${js(listId)}&&label.startsWith(${js(`${prefix} `)}); }).should('have.length',0);`;
  }
  return v4.emitAssertion(assertion);
}

function generateCypressPreviewFromPlan(plan, { id = 'TC', title = 'Canonical test' } = {}) {
  if (!plan) throw new Error('A compiled automation plan is required for Cypress preview.');
  const lines = [`it(${js(`${id} - ${title}`)}, () => {`];
  const setup = v4.observerSetup(plan);
  if (setup.length) lines.push(...setup.map((line) => String(line).replace(/^\s{4}/, '  ')), '');
  for (const action of plan.actions || []) lines.push(String(emitAction(action)).replace(/^\s{4}/, '  '));
  if ((plan.actions || []).length && (plan.assertions || []).length) lines.push('');
  for (const assertion of plan.assertions || []) lines.push(String(emitAssertion(assertion)).replace(/^\s{4}/, '  '));
  lines.push('});');
  return lines.join('\n');
}

function generateDeterministicAutomation(approvedTestCases = []) {
  if (!approvedTestCases.length) throw new Error('No approved test cases were supplied for deterministic generation.');
  const lines = ["describe('AI TestPilot Approved Test Suite', () => {"];
  for (const testCase of approvedTestCases) {
    const plan = testCase?.automationReadiness?.automationPlan;
    if (!plan) throw new Error(`${testCase.id} has no compiled automation plan.`);
    lines.push(`  it(${js(`${testCase.id} - ${testCase.title}`)}, () => {`);
    const setup = v4.observerSetup(plan);
    if (setup.length) lines.push(...setup, '');
    for (const action of plan.actions || []) lines.push(emitAction(action));
    lines.push('');
    for (const assertion of plan.assertions || []) lines.push(emitAssertion(assertion));
    lines.push('  });', '');
  }
  lines.push('});', '');
  return {
    fileName: 'ai-generated.cy.js',
    framework: 'browser-automation',
    language: 'javascript',
    generationMode: 'deterministic-dsl-v6-canonical-actors',
    script: lines.join('\n'),
  };
}

module.exports = { ...v5, emitAction, emitAssertion, generateCypressPreviewFromPlan, generateDeterministicAutomation };

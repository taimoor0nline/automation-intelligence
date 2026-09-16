const crypto = require('crypto');
const v6 = require('./deterministicAutomationGeneratorV6');
const v4 = require('./deterministicAutomationGeneratorV4');
const { emitTraversalAction } = require('./virtualizedSuggestionTraversalEmitter');

function js(value) { return JSON.stringify(value); }
function hash(value) { return crypto.createHash('sha256').update(String(value || '')).digest('hex'); }
function op(value) { return String(value || '').trim().toUpperCase(); }

const UNIQUE_ELEMENT_ACTIONS = new Set([
  'TYPE','TYPE_RUNTIME_CREDENTIAL','CLEAR','CLICK','DBLCLICK','RIGHTCLICK','HOVER','FOCUS','BLUR',
  'SELECT','SELECT_MULTIPLE','CHECK','UNCHECK','SUBMIT','SCROLL_INTO_VIEW','SELECT_FILE','SELECT_FILES',
  'SET_RANGE_VALUE','SET_COLOR_VALUE','OPEN_COMBOBOX','CLOSE_COMBOBOX','SEARCH_SUGGESTIONS',
  'CLEAR_SUGGESTION_SEARCH','SELECT_SUGGESTION','SELECT_SUGGESTIONS','SCROLL_SUGGESTIONS_TO_VALUE',
  'SELECT_SUGGESTION_BY_TRAVERSAL','REMOVE_SELECTED_TAG','CLEAR_SELECTED_TAGS',
]);
const ENTERPRISE_ADAPTER_CAPABILITIES = new Set(['MFA_OTP','WEBAUTHN_TEST_ADAPTER']);

function runtimeItem(testCaseId, kind, index, operation) {
  return {
    testCaseId: String(testCaseId || ''),
    itemId: `${String(testCaseId || 'TC')}-${kind === 'ASSERTION' ? 'ASRT' : 'ACT'}-${String(index + 1).padStart(3, '0')}`,
    kind,
    index,
    operation: op(operation),
  };
}

function emitRuntimeEvent(event, phase) {
  const payload = { ...event, phase };
  return `    cy.task('testNexusRuntimeEvent', ${js(payload)}, { log:false });`;
}

function emitRuntimeContext(event) {
  return `    cy.testNexusSetCurrentItem(${js(event)});`;
}

function emitRuntimeUniqueness(action, event) {
  const operation = op(action?.operation);
  const selector = String(action?.selector || '').trim();
  if (!selector || !UNIQUE_ELEMENT_ACTIONS.has(operation)) return [];
  return [
    `    cy.get(${js(selector)}).should(($matches) => { expect($matches.length, ${js(`${event.itemId} runtime selector uniqueness`)}).to.eq(1); });`,
  ];
}

function emitEnterpriseAction(action) {
  const operation = op(action?.operation);
  if (operation === 'LOGIN_ENTERPRISE_SSO') {
    const provider = String(action.provider || 'ENTERPRISE').trim().toUpperCase();
    return `    cy.loginEnterpriseSso(${js(provider)});`;
  }
  if (operation === 'PRESS_NATIVE_KEY') {
    const key = String(action.key || '').trim().toUpperCase();
    if (!key) throw new Error('PRESS_NATIVE_KEY requires a configured key.');
    return `    cy.pressNativeKey(${js(key)});`;
  }
  if (operation === 'EXTERNAL_ADAPTER_ACTION' && ENTERPRISE_ADAPTER_CAPABILITIES.has(String(action.capability || '').toUpperCase())) {
    return `    cy.task('testNexusEnterpriseAdapter', ${js({ capability: String(action.capability || '').toUpperCase(), action: action.action || 'execute', payload: action.payload || {} })}, { log:false }).then((result) => { expect(result && result.ok, JSON.stringify(result || {})).to.eq(true); });`;
  }
  return null;
}

function emitAction(action) {
  return emitTraversalAction(action) || emitEnterpriseAction(action) || v6.emitAction(action);
}

function emitAssertion(assertion) {
  const operation = op(assertion?.operation);
  if (operation === 'ASSERT_EXTERNAL_ADAPTER' && ENTERPRISE_ADAPTER_CAPABILITIES.has(String(assertion.capability || '').toUpperCase())) {
    return `    cy.task('testNexusEnterpriseAdapter', ${js({ capability: String(assertion.capability || '').toUpperCase(), action: 'assert', payload: assertion.payload || { expectation: assertion.description || '' } })}, { log:false }).then((result) => { expect(result && result.ok, JSON.stringify(result || {})).to.eq(true); });`;
  }
  return v6.emitAssertion(assertion);
}

function generateCypressPreviewFromPlan(plan, { id = 'TC', title = 'Canonical test' } = {}) {
  if (!plan) throw new Error('A compiled automation plan is required for automation preview.');
  const lines = [`it(${js(`${id} - ${title}`)}, () => {`];
  const setup = v4.observerSetup(plan);
  if (setup.length) lines.push(...setup.map((line) => String(line).replace(/^\s{4}/, '  ')), '');
  (plan.actions || []).forEach((action, index) => {
    const event = runtimeItem(id, 'ACTION', index, action.operation);
    lines.push(String(emitRuntimeContext(event)).replace(/^\s{4}/, '  '));
    lines.push(...emitRuntimeUniqueness(action, event).map((line) => String(line).replace(/^\s{4}/, '  ')));
    lines.push(String(emitAction(action)).replace(/^\s{4}/, '  '));
  });
  if ((plan.actions || []).length && (plan.assertions || []).length) lines.push('');
  (plan.assertions || []).forEach((assertion, index) => {
    const event = runtimeItem(id, 'ASSERTION', index, assertion.operation);
    lines.push(String(emitRuntimeContext(event)).replace(/^\s{4}/, '  '));
    lines.push(String(emitAssertion(assertion)).replace(/^\s{4}/, '  '));
  });
  lines.push('});');
  return lines.join('\n');
}

function generateDeterministicAutomation(approvedTestCases = []) {
  if (!approvedTestCases.length) throw new Error('No approved test cases were supplied for deterministic generation.');
  const lines = ["describe('Test execution', () => {"];
  for (const testCase of approvedTestCases) {
    const plan = testCase?.automationReadiness?.automationPlan;
    if (!plan) throw new Error(`${testCase.id} has no compiled automation plan.`);
    const testCaseId = String(testCase.id || 'TC');
    lines.push(`  it(${js(`${testCaseId} - ${testCase.title}`)}, () => {`);
    const setup = v4.observerSetup(plan);
    if (setup.length) lines.push(...setup, '');

    (plan.actions || []).forEach((action, index) => {
      const event = runtimeItem(testCaseId, 'ACTION', index, action.operation);
      lines.push(emitRuntimeContext(event));
      lines.push(emitRuntimeEvent(event, 'STARTED'));
      lines.push(...emitRuntimeUniqueness(action, event));
      lines.push(emitAction(action));
      lines.push(emitRuntimeEvent(event, 'PASSED'));
    });

    if ((plan.actions || []).length && (plan.assertions || []).length) lines.push('');
    (plan.assertions || []).forEach((assertion, index) => {
      const event = runtimeItem(testCaseId, 'ASSERTION', index, assertion.operation);
      lines.push(emitRuntimeContext(event));
      lines.push(emitRuntimeEvent(event, 'STARTED'));
      lines.push(emitAssertion(assertion));
      lines.push(emitRuntimeEvent(event, 'PASSED'));
    });

    lines.push(`    cy.testNexusSetCurrentItem(null);`);
    lines.push('  });', '');
  }
  lines.push('});', '');
  const script = lines.join('\n');
  return {
    fileName: 'approved-execution.cy.js',
    framework: 'browser-automation',
    language: 'javascript',
    generationMode: 'deterministic-execution-contract-v2',
    script,
    scriptHash: hash(script),
  };
}

module.exports = {
  ...v6,
  emitAction,
  emitAssertion,
  generateCypressPreviewFromPlan,
  generateDeterministicAutomation,
  runtimeItem,
};

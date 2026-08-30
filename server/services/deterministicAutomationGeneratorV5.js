const v4 = require('./deterministicAutomationGeneratorV4');

function js(value) { return JSON.stringify(value); }

function emitAction(action) {
  if (action?.operation === 'TYPE_RUNTIME_CREDENTIAL') {
    const credential = String(action.credential || '').trim().toLowerCase();
    if (!['username','password'].includes(credential)) throw new Error(`Unsupported runtime credential: ${credential || 'missing'}`);
    const envName = credential === 'username' ? 'TEST_USERNAME' : 'TEST_PASSWORD';
    return `    { const value=Cypress.env(${js(envName)}); if(!value) throw new Error(${js(`Runtime ${credential} credential is not configured for this test run.`)}); cy.get(${js(action.selector)}).clear({log:false}).type(String(value), {log:false}); }`;
  }
  return v4.emitAction(action);
}

function generateCypressPreviewFromPlan(plan, { id = 'TC', title = 'Canonical test' } = {}) {
  if (!plan) throw new Error('A compiled automation plan is required for Cypress preview.');
  const lines = [`it(${js(`${id} - ${title}`)}, () => {`];
  const setup = v4.observerSetup(plan);
  if (setup.length) lines.push(...setup.map((line) => String(line).replace(/^\s{4}/, '  ')), '');
  for (const action of plan.actions || []) lines.push(String(emitAction(action)).replace(/^\s{4}/, '  '));
  if ((plan.actions || []).length && (plan.assertions || []).length) lines.push('');
  for (const assertion of plan.assertions || []) lines.push(String(v4.emitAssertion(assertion)).replace(/^\s{4}/, '  '));
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
    for (const assertion of plan.assertions || []) lines.push(v4.emitAssertion(assertion));
    lines.push('  });', '');
  }
  lines.push('});', '');
  return {
    fileName: 'ai-generated.cy.js',
    framework: 'browser-automation',
    language: 'javascript',
    generationMode: 'deterministic-dsl-v5-canonical',
    script: lines.join('\n'),
  };
}

module.exports = {
  ...v4,
  emitAction,
  generateCypressPreviewFromPlan,
  generateDeterministicAutomation,
};

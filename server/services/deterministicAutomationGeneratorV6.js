const v5 = require('./deterministicAutomationGeneratorV5');
const v4 = require('./deterministicAutomationGeneratorV4');

function js(value) { return JSON.stringify(value); }

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
    // Canonical SUBMIT represents user form submission intent. Discovery may ground
    // that intent to either the form itself or its submit button. Cypress .submit()
    // only accepts <form>, so choose the correct browser interaction at runtime.
    return `    cy.get(${js(action.selector)}).then(($el) => { if ($el.is('form')) cy.wrap($el).submit(); else cy.wrap($el).click(); });`;
  }
  return v5.emitAction(action);
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
    generationMode: 'deterministic-dsl-v6-canonical-actors',
    script: lines.join('\n'),
  };
}

module.exports = {
  ...v5,
  emitAction,
  generateCypressPreviewFromPlan,
  generateDeterministicAutomation,
};

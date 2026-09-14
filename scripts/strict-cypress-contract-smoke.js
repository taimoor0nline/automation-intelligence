const assert = require('assert');

require('../server/services/startupIntegrityGuards').install();
require('../server/services/runtimeHardeningPatches').install();

const { buildCanonicalElementRegistry } = require('../server/services/canonicalElementRegistry');
const { validateCanonicalIr } = require('../server/services/canonicalTestIrV3');
const { validateCypressContract } = require('../server/services/cypressContractValidator');

const pageDiscoveries = [{
  url: 'https://example.test/form',
  finalUrl: 'https://example.test/form',
  pageTitle: 'Example Form',
  documentLanguage: 'en',
  meta: [{ name: 'description', content: 'Example test form' }],
  networkHints: [],
  browserState: { cookieNames: [], localStorageKeys: [], sessionStorageKeys: [] },
  elements: [
    { tag: 'input', type: 'text', id: 'name', selector: '#name', label: 'Name', required: true },
    { tag: 'input', type: 'checkbox', id: 'remember', selector: '#remember', label: 'Remember me', checked: false },
    { tag: 'input', type: 'radio', id: 'email-choice', name: 'contact', selector: '#email-choice', label: 'Email', checked: false },
    { tag: 'select', type: 'select', id: 'role', selector: '#role', label: 'Role', options: [{ value: 'user', label: 'User' }] },
    { tag: 'button', type: 'submit', id: 'submit', selector: '#submit', label: 'Submit', text: 'Submit' },
  ],
  messages: [],
}];

const registry = buildCanonicalElementRegistry(pageDiscoveries);
const byId = new Map(registry.elements.filter((item) => item.id).map((item) => [item.id, item]));

function compileCase({ id, title, category = 'FUNCTIONAL', story = 'Test the rendered example form.', actions, assertions, expectedResults = ['Expected deterministic behavior'] }) {
  const ir = { version: 1, plannedId: `P${id.slice(-3)}`, objective: title, actions, assertions };
  const validation = validateCanonicalIr(ir, {
    registry,
    plannedUnit: { plannedId: ir.plannedId, objective: title },
    story,
    hasCredentials: false,
    actorCatalog: [],
    actorCredentialRefs: [],
  });
  assert.equal(validation.ok, true, validation.reason || JSON.stringify(validation.errors));
  return {
    id,
    title,
    type: 'positive',
    testCategory: category,
    generationStory: story,
    preconditions: [],
    expectedResults,
    canonicalIr: ir,
    automationReadiness: { status: 'READY', automatable: true, automationPlan: validation.plan },
  };
}

function strict(testCase, context = {}) {
  return validateCypressContract(testCase, {
    pageDiscoveries,
    canonicalElementRegistry: registry,
    story: testCase.generationStory,
    hasCredentials: false,
    actorCredentialRefs: [],
    ...context,
  });
}

const checkbox = byId.get('remember');
const radio = byId.get('email-choice');
const name = byId.get('name');

const validCheckbox = compileCase({
  id: 'TC001',
  title: 'Leave the remember checkbox unchecked',
  actions: [
    { operation: 'NAVIGATE', path: '/form' },
    { operation: 'UNCHECK', elementRef: checkbox.elementRef },
  ],
  assertions: [{ operation: 'ASSERT_UNCHECKED', elementRef: checkbox.elementRef }],
  expectedResults: ['Remember checkbox remains unchecked.'],
});
const validResultA = strict(validCheckbox);
const validResultB = strict(validCheckbox);
assert.equal(validResultA.ok, true, JSON.stringify(validResultA.errors));
assert.equal(validResultA.scriptHash, validResultB.scriptHash, 'same reviewed contract must generate the same Cypress artifact hash');

// Canonical compilation still understands CHECK/UNCHECK generically, but the strict
// Cypress semantic gate must reject .uncheck() against a radio before Automation Ready.
const radioCase = compileCase({
  id: 'TC002',
  title: 'Force radio group to no selection',
  actions: [
    { operation: 'NAVIGATE', path: '/form' },
    { operation: 'UNCHECK', elementRef: radio.elementRef },
  ],
  assertions: [{ operation: 'ASSERT_UNCHECKED', elementRef: radio.elementRef }],
});
const radioResult = strict(radioCase);
assert.equal(radioResult.ok, false);
assert.equal(radioResult.reasonCode, 'CYPRESS_ACTION_ELEMENT_MISMATCH');

const performanceCase = compileCase({
  id: 'TC003',
  title: 'Page load stays within the agreed performance threshold',
  category: 'PERFORMANCE',
  story: 'Check the public form performance.',
  actions: [{ operation: 'NAVIGATE', path: '/form' }],
  assertions: [{ operation: 'ASSERT_PAGE_LOAD_AT_MOST', max: 1234 }],
  expectedResults: ['Page load is within the agreed threshold.'],
});
const performanceResult = strict(performanceCase);
assert.equal(performanceResult.ok, false);
assert.equal(performanceResult.reasonCode, 'CYPRESS_PERFORMANCE_THRESHOLD_UNGROUNDED');

const integrationCase = compileCase({
  id: 'TC004',
  title: 'Integration-labelled title check',
  category: 'INTEGRATION',
  story: 'Check the public form.',
  actions: [{ operation: 'NAVIGATE', path: '/form' }],
  assertions: [{ operation: 'ASSERT_VISIBLE', elementRef: name.elementRef }],
});
const integrationResult = strict(integrationCase);
assert.equal(integrationResult.ok, false);
assert.equal(integrationResult.reasonCode, 'CYPRESS_CATEGORY_CONTRACT_MISMATCH');

console.log('strict-cypress-contract-smoke: PASS');

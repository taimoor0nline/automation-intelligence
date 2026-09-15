const assert = require('assert');

const { buildCanonicalElementRegistry, registryForModel } = require('../server/services/canonicalElementRegistry');
const { validateCanonicalIr } = require('../server/services/canonicalTestIrV3');
const { validateHtmlCapabilityContract } = require('../server/services/htmlCapabilityContract');
const generator = require('../server/services/deterministicAutomationGeneratorV6');

const registry = buildCanonicalElementRegistry([{
  url: 'https://example.test/capabilities',
  finalUrl: 'https://example.test/capabilities',
  pageTitle: 'Capability Lab',
  elements: [
    { tag: 'input', type: 'color', id: 'color-input', selector: '#color-input', visible: true },
    { tag: 'select', type: 'select', id: 'multi-select', selector: '#multi-select', multiple: true, visible: true, options: [
      { value: 'red', label: 'Red', text: 'Red', disabled: false },
      { value: 'green', label: 'Green', text: 'Green', disabled: false },
      { value: 'blocked', label: 'Blocked', text: 'Blocked', disabled: true },
    ] },
    { tag: 'div', type: 'div', id: 'editable', selector: '#editable', contenteditable: true, visible: true, text: 'Editable' },
  ],
  messages: [],
  networkHints: [],
  browserState: { cookieNames: [], localStorageKeys: [], sessionStorageKeys: [] },
}]);

const byId = new Map(registry.elements.filter((item) => item.id).map((item) => [item.id, item]));
const color = byId.get('color-input');
const multi = byId.get('multi-select');
const editable = byId.get('editable');
assert(color && multi && editable, 'expected synthetic controls in canonical registry');

assert(color.capabilities.includes('SET_COLOR_VALUE'));
assert(multi.capabilities.includes('SELECT_MULTIPLE'));
assert(editable.capabilities.includes('TYPE'));
assert(editable.capabilities.includes('TEXT'));
assert(!editable.capabilities.includes('VALUE'), 'contenteditable must not advertise form VALUE semantics');

const model = registryForModel(registry);
assert.equal(model.capabilityContract.authoritative, true);
assert.equal(model.capabilityContract.actionRequirements.SET_COLOR_VALUE, 'SET_COLOR_VALUE');
assert.equal(model.capabilityContract.actionRequirements.SELECT_MULTIPLE, 'SELECT_MULTIPLE');

let result = validateHtmlCapabilityContract({ actions: [{ operation: 'SET_COLOR_VALUE', elementRef: color.elementRef, value: '#336699' }], assertions: [] }, registry);
assert.equal(result.ok, true, JSON.stringify(result.errors));
result = validateHtmlCapabilityContract({ actions: [{ operation: 'SET_COLOR_VALUE', elementRef: color.elementRef, value: 'blue' }], assertions: [] }, registry);
assert.equal(result.ok, false);
assert.equal(result.reasonCode, 'HTML_COLOR_VALUE_INVALID');

result = validateHtmlCapabilityContract({ actions: [{ operation: 'SELECT_MULTIPLE', elementRef: multi.elementRef, values: ['red', 'green'] }], assertions: [] }, registry);
assert.equal(result.ok, true, JSON.stringify(result.errors));
result = validateHtmlCapabilityContract({ actions: [{ operation: 'SELECT_MULTIPLE', elementRef: multi.elementRef, values: ['red', 'blocked'] }], assertions: [] }, registry);
assert.equal(result.ok, false);
assert(result.errors.some((item) => item.code === 'HTML_SELECT_OPTION_DISABLED'), JSON.stringify(result.errors));

result = validateHtmlCapabilityContract({ actions: [], assertions: [{ operation: 'ASSERT_SELECTED_VALUES_EQUALS', elementRef: multi.elementRef, values: ['red', 'green'] }] }, registry);
assert.equal(result.ok, true, JSON.stringify(result.errors));
result = validateHtmlCapabilityContract({ actions: [], assertions: [{ operation: 'ASSERT_VALUE_EQUALS', elementRef: editable.elementRef, value: 'Editable' }] }, registry);
assert.equal(result.ok, false);
assert.equal(result.reasonCode, 'HTML_ASSERTION_CAPABILITY_MISMATCH');

function compile(plannedId, objective, action, assertion) {
  const compiled = validateCanonicalIr({
    version: 1,
    plannedId,
    objective,
    actions: [{ operation: 'NAVIGATE', path: '/capabilities' }, action],
    assertions: [assertion],
  }, {
    registry,
    plannedUnit: { plannedId, objective },
    story: objective,
    hasCredentials: false,
    actorCatalog: [],
    actorCredentialRefs: [],
  });
  assert.equal(compiled.ok, true, compiled.reason || JSON.stringify(compiled.errors));
  return compiled.plan;
}

const colorPlan = compile('PCOLOR', 'set color input value', { operation: 'SET_COLOR_VALUE', elementRef: color.elementRef, value: '#336699' }, { operation: 'ASSERT_VALUE_EQUALS', elementRef: color.elementRef, value: '#336699' });
assert.equal(colorPlan.actions[1].operation, 'SET_COLOR_VALUE');
const colorScript = generator.generateCypressPreviewFromPlan(colorPlan, { id: 'PCOLOR', title: 'Color' });
assert(colorScript.includes('HTMLInputElement.prototype'));
assert(colorScript.includes("trigger('input').trigger('change')"));

const multiPlan = compile('PMULTI', 'select multiple options', { operation: 'SELECT_MULTIPLE', elementRef: multi.elementRef, values: ['red', 'green'] }, { operation: 'ASSERT_SELECTED_VALUES_EQUALS', elementRef: multi.elementRef, values: ['red', 'green'] });
assert.deepEqual(multiPlan.actions[1].values, ['red', 'green']);
assert.deepEqual(multiPlan.assertions[0].values, ['red', 'green']);
const multiScript = generator.generateCypressPreviewFromPlan(multiPlan, { id: 'PMULTI', title: 'Multiple select' });
assert(multiScript.includes('.select(["red","green"])'));
assert(multiScript.includes('selectedOptions'));
assert(multiScript.includes('to.deep.eq(["red","green"])'));

console.log('html-native-controls-v2-smoke: PASS');

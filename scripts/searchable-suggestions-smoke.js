const assert = require('assert');
const { buildCanonicalElementRegistry, registryForModel } = require('../server/services/canonicalElementRegistry');
const { validateCanonicalIr } = require('../server/services/canonicalTestIrV3');
const { validateSuggestionCapabilityContract } = require('../server/services/suggestionCapabilityContract');
const generator = require('../server/services/deterministicAutomationGeneratorV6');

const pageDiscoveries = [{
  url: 'https://example.test/search',
  finalUrl: 'https://example.test/search',
  pageTitle: 'Searchable controls',
  elements: [
    { tag: 'input', type: 'search', id: 'site-search', selector: '#site-search', role: 'combobox', ariaLabel: 'Site search', ariaAutocomplete: 'list', ariaControls: 'site-results', ariaExpanded: 'false' },
    { tag: 'ul', type: 'ul', id: 'site-results', selector: '#site-results', role: 'listbox' },
    { tag: 'li', type: 'li', id: 'site-docs', selector: '#site-docs', role: 'option', text: 'Documents', listboxOwnerId: 'site-results', ariaSelected: 'false' },
    { tag: 'li', type: 'li', id: 'site-users', selector: '#site-users', role: 'option', text: 'Users', listboxOwnerId: 'site-results', ariaSelected: 'false' },
    { tag: 'input', type: 'text', id: 'country', selector: '#country', role: 'combobox', ariaLabel: 'Country', ariaAutocomplete: 'list', ariaControls: 'country-list', ariaExpanded: 'false' },
    { tag: 'ul', type: 'ul', id: 'country-list', selector: '#country-list', role: 'listbox' },
    { tag: 'li', type: 'li', id: 'country-oman', selector: '#country-oman', role: 'option', text: 'Oman', listboxOwnerId: 'country-list', ariaSelected: 'false' },
    { tag: 'li', type: 'li', id: 'country-qatar', selector: '#country-qatar', role: 'option', text: 'Qatar', listboxOwnerId: 'country-list', ariaSelected: 'false' },
    { tag: 'input', type: 'text', id: 'skills', selector: '#skills', role: 'combobox', ariaLabel: 'Skills', ariaAutocomplete: 'list', ariaControls: 'skills-list', ariaExpanded: 'false' },
    { tag: 'ul', type: 'ul', id: 'skills-list', selector: '#skills-list', role: 'listbox', ariaMultiselectable: 'true' },
    { tag: 'li', type: 'li', id: 'skill-laravel', selector: '#skill-laravel', role: 'option', text: 'Laravel', listboxOwnerId: 'skills-list', ariaSelected: 'false' },
    { tag: 'li', type: 'li', id: 'skill-vue', selector: '#skill-vue', role: 'option', text: 'Vue', listboxOwnerId: 'skills-list', ariaSelected: 'false' },
    { tag: 'input', type: 'text', id: 'city', selector: '#city', list: 'city-list', suggestions: [{ value: 'Muscat', text: 'Muscat' }, { value: 'Sohar', text: 'Sohar' }], suggestionSource: 'datalist' },
    { tag: 'datalist', type: 'datalist', id: 'city-list', selector: '#city-list', options: [{ value: 'Muscat', label: 'Muscat' }, { value: 'Sohar', label: 'Sohar' }] },
  ],
  messages: [],
}];

const registry = buildCanonicalElementRegistry(pageDiscoveries);
const model = registryForModel(registry);
assert.equal(registry.version, 7);
assert.equal(model.capabilityContract.authoritative, true);
const byId = new Map(registry.elements.filter((element) => element.id).map((element) => [element.id, element]));
const site = byId.get('site-search');
const country = byId.get('country');
const skills = byId.get('skills');
const city = byId.get('city');
assert(site.capabilities.includes('SEARCH_SUGGESTIONS'));
assert(site.capabilities.includes('SELECT_SUGGESTION'));
assert(country.capabilities.includes('OPEN_COMBOBOX'));
assert(country.capabilities.includes('SELECT_SUGGESTION'));
assert.deepEqual(country.suggestions.map((item) => item.text), ['Oman', 'Qatar']);
assert(skills.capabilities.includes('SELECT_SUGGESTIONS'));
assert.equal(skills.suggestionMultiselect, true);
assert(city.capabilities.includes('SEARCH_SUGGESTIONS'));
assert(city.capabilities.includes('NATIVE_DATALIST_SUGGESTIONS'));
assert(!city.capabilities.includes('SELECT_SUGGESTION'), 'native datalist popup must not be treated as a custom listbox click surface');

const story = 'Search Documents in Site search. Select Oman from Country. Select Laravel and Vue from Skills.';
const ir = {
  version: 1,
  plannedId: 'P-SUGGEST',
  actions: [
    { operation: 'SEARCH_SUGGESTIONS', elementRef: site.elementRef, query: 'Doc' },
    { operation: 'SELECT_SUGGESTION', elementRef: site.elementRef, value: 'Documents' },
    { operation: 'SEARCH_SUGGESTIONS', elementRef: country.elementRef, query: 'Oma' },
    { operation: 'SELECT_SUGGESTION', elementRef: country.elementRef, value: 'Oman' },
    { operation: 'SELECT_SUGGESTIONS', elementRef: skills.elementRef, values: ['Laravel', 'Vue'] },
  ],
  assertions: [
    { operation: 'ASSERT_SUGGESTION_VISIBLE', elementRef: country.elementRef, value: 'Oman' },
    { operation: 'ASSERT_SELECTED_SUGGESTIONS_EQUALS', elementRef: skills.elementRef, values: ['Laravel', 'Vue'] },
  ],
};
const compiled = validateCanonicalIr(ir, { registry, story, hasCredentials: false });
assert.equal(compiled.ok, true, compiled.errors?.join('\n'));
assert.equal(compiled.plan.actions[0].operation, 'SEARCH_SUGGESTIONS');
assert.equal(compiled.plan.actions[0].query, 'Doc');
assert.equal(compiled.plan.actions[1].suggestionListId, 'site-results');
assert.equal(compiled.plan.actions[4].suggestionMultiselect, true);
assert.equal(compiled.plan.assertions[0].suggestionListId, 'country-list');

const testCase = {
  id: 'TC-SUGGEST',
  title: 'Search and select evidenced suggestions',
  generationStory: story,
  testData: { country: 'Oman', skills: ['Laravel', 'Vue'] },
  preconditions: [],
  expectedResults: compiled.display.expectedResults,
  canonicalIr: ir,
  automationReadiness: { status: 'READY', automationPlan: compiled.plan },
};
const contract = validateSuggestionCapabilityContract(testCase, registry, { story });
assert.equal(contract.ok, true, JSON.stringify(contract.errors));

const generated = generator.generateDeterministicAutomation([testCase]);
assert(generated.script.includes("#site-results"), generated.script);
assert(generated.script.includes("[role=\"option\"]") || generated.script.includes("[role=\\\"option\\\"]") || generated.script.includes('[role="option"]'), generated.script);
assert(generated.script.includes('Documents'), generated.script);
assert(generated.script.includes('Laravel'), generated.script);
assert(generated.script.includes('Vue'), generated.script);

const inventedIr = {
  version: 1,
  plannedId: 'P-INVENTED',
  actions: [{ operation: 'SELECT_SUGGESTION', elementRef: country.elementRef, value: 'Atlantis' }],
  assertions: [],
};
const inventedCompiled = validateCanonicalIr(inventedIr, { registry, story: 'Select a country', hasCredentials: false });
assert.equal(inventedCompiled.ok, true, inventedCompiled.errors?.join('\n'));
const inventedCase = {
  id: 'TC-INVENTED', title: 'Invented option must be blocked', generationStory: 'Select a country', canonicalIr: inventedIr,
  automationReadiness: { status: 'READY', automationPlan: inventedCompiled.plan }, expectedResults: [], preconditions: [], testData: {},
};
const inventedContract = validateSuggestionCapabilityContract(inventedCase, registry, { story: 'Select a country' });
assert.equal(inventedContract.ok, false);
assert.equal(inventedContract.reasonCode, 'SUGGESTION_VALUE_UNGROUNDED');

const dynamicPage = [{
  url: 'https://example.test/async', finalUrl: 'https://example.test/async', pageTitle: 'Async search',
  elements: [
    { tag: 'input', type: 'search', id: 'employee', selector: '#employee', role: 'combobox', ariaLabel: 'Employee search', ariaAutocomplete: 'list', ariaControls: 'employee-list', ariaExpanded: 'false' },
    { tag: 'ul', type: 'ul', id: 'employee-list', selector: '#employee-list', role: 'listbox' },
  ], messages: [],
}];
const dynamicRegistry = buildCanonicalElementRegistry(dynamicPage);
const employee = dynamicRegistry.elements.find((element) => element.id === 'employee');
assert(employee.capabilities.includes('SEARCH_SUGGESTIONS'));
assert(employee.capabilities.includes('SELECT_SUGGESTION'));
assert.equal(employee.suggestions.length, 0);
const dynamicIr = { version: 1, plannedId: 'P-ASYNC', actions: [
  { operation: 'SEARCH_SUGGESTIONS', elementRef: employee.elementRef, query: 'Sara' },
  { operation: 'SELECT_SUGGESTION', elementRef: employee.elementRef, value: 'Sara Khan' },
], assertions: [] };
const dynamicStory = 'Search employee Sara and select Sara Khan.';
const dynamicCompiled = validateCanonicalIr(dynamicIr, { registry: dynamicRegistry, story: dynamicStory, hasCredentials: false });
assert.equal(dynamicCompiled.ok, true, dynamicCompiled.errors?.join('\n'));
const dynamicCase = { id: 'TC-ASYNC', title: 'Async suggestion from approved story data', generationStory: dynamicStory, canonicalIr: dynamicIr, expectedResults: [], preconditions: [], testData: { employee: 'Sara Khan' }, automationReadiness: { status: 'READY', automationPlan: dynamicCompiled.plan } };
assert.equal(validateSuggestionCapabilityContract(dynamicCase, dynamicRegistry, { story: dynamicStory }).ok, true);

console.log('searchable-suggestions-smoke: PASS');

const assert = require('assert');

const { buildCanonicalElementRegistry, registryForModel } = require('../server/services/canonicalElementRegistry');
const { validateHtmlCapabilityContract } = require('../server/services/htmlCapabilityContract');
const { validateHtmlCompiledAlignment } = require('../server/services/htmlCompiledAlignmentContract');
const generator = require('../server/services/deterministicAutomationGeneratorV6');

const pageDiscoveries = [{
  url: 'https://example.test/capabilities',
  finalUrl: 'https://example.test/capabilities',
  pageTitle: 'HTML Capability Matrix',
  documentLanguage: 'en',
  networkHints: [],
  browserState: { cookieNames: [], localStorageKeys: [], sessionStorageKeys: [] },
  elements: [
    { tag: 'h1', type: 'h1', id: 'heading', selector: '#heading', text: 'Capability Matrix' },
    { tag: 'p', type: 'p', id: 'intro', selector: '#intro', text: 'Intro paragraph' },
    { tag: 'div', type: 'div', id: 'content', selector: '#content', text: 'Read only content' },
    { tag: 'span', type: 'span', id: 'badge', selector: '#badge', text: 'Ready' },
    { tag: 'input', type: 'input', id: 'default-input', selector: '#default-input' },
    { tag: 'input', type: 'text', id: 'text', selector: '#text', required: true },
    { tag: 'input', type: 'email', id: 'email', selector: '#email' },
    { tag: 'input', type: 'number', id: 'number', selector: '#number', min: '1', max: '100' },
    { tag: 'input', type: 'date', id: 'date', selector: '#date' },
    { tag: 'input', type: 'datetime-local', id: 'datetime', selector: '#datetime' },
    { tag: 'input', type: 'month', id: 'month', selector: '#month' },
    { tag: 'input', type: 'week', id: 'week', selector: '#week' },
    { tag: 'input', type: 'time', id: 'time', selector: '#time' },
    { tag: 'input', type: 'range', id: 'range', selector: '#range', min: '0', max: '100', step: '10', rangeValue: '20' },
    { tag: 'input', type: 'color', id: 'color', selector: '#color' },
    { tag: 'input', type: 'hidden', id: 'hidden', selector: '#hidden' },
    { tag: 'input', type: 'checkbox', id: 'check', name: 'agree', selector: '#check', checked: false },
    { tag: 'input', type: 'radio', id: 'radio-a', name: 'choice', selector: '#radio-a', checked: false },
    { tag: 'input', type: 'radio', id: 'radio-b', name: 'choice', selector: '#radio-b', checked: true },
    { tag: 'select', type: 'select', id: 'native-select', selector: '#native-select', options: [
      { value: 'a', label: 'A', disabled: false },
      { value: 'b', label: 'B', disabled: true },
    ] },
    { tag: 'div', type: 'div', id: 'custom-combo', selector: '#custom-combo', role: 'combobox', ariaLabel: 'Custom choice', tabIndex: 0 },
    { tag: 'input', type: 'file', id: 'image-file', selector: '#image-file', accept: 'image/*', multiple: false },
    { tag: 'input', type: 'file', id: 'multi-file', selector: '#multi-file', accept: '', multiple: true },
    { tag: 'div', type: 'div', id: 'file-drop', selector: '#file-drop', text: 'Drop image here', nativeDropTarget: true, fileDropTarget: true },
    { tag: 'div', type: 'div', id: 'drag-source', selector: '#drag-source', text: 'Drag me', draggable: true },
    { tag: 'div', type: 'div', id: 'drop-target', selector: '#drop-target', text: 'Drop here', nativeDropTarget: true },
    { tag: 'div', type: 'div', id: 'ordinary', selector: '#ordinary', text: 'Ordinary div' },
    { tag: 'img', type: 'img', id: 'image', selector: '#image', alt: 'Example image', src: '/image.png', complete: true, naturalWidth: 100, naturalHeight: 80 },
  ],
  messages: [],
}];

const registry = buildCanonicalElementRegistry(pageDiscoveries);
const modelRegistry = registryForModel(registry);
assert.equal(modelRegistry.capabilityContract?.authoritative, true, 'AI-facing capability contract must be authoritative');
assert.equal(modelRegistry.capabilityContract?.actionRequirements?.SELECT, 'SELECT');
assert.equal(modelRegistry.capabilityContract?.actionRequirements?.SET_RANGE_VALUE, 'SET_RANGE_VALUE');

const byId = new Map(registry.elements.filter((element) => element.id).map((element) => [element.id, element]));
const element = (id) => {
  const item = byId.get(id);
  assert(item, `missing registry element ${id}`);
  return item;
};
const has = (id, capability) => element(id).capabilities.includes(capability);

assert.equal(element('default-input').type, 'text', 'missing input type must normalize to browser-default text');
assert(has('heading', 'TEXT'));
assert(has('intro', 'TEXT'));
assert(has('content', 'TEXT'));
assert(has('badge', 'TEXT'));
assert(!has('content', 'TYPE'), 'content-only div must not become a form input');
assert(has('default-input', 'TYPE'));
assert(has('text', 'TYPE'));
assert(has('email', 'TYPE'));
assert(has('number', 'TYPE'));
assert(has('date', 'TYPE'));
assert(has('datetime', 'TYPE'));
assert(has('month', 'TYPE'));
assert(has('week', 'TYPE'));
assert(has('time', 'TYPE'));
assert(has('range', 'SET_RANGE_VALUE'));
assert(!has('range', 'TYPE'), 'range must not use ordinary text typing');
assert(!has('color', 'TYPE'), 'color picker must not be treated as a text input');
assert(!has('hidden', 'TYPE'));
assert(!has('hidden', 'CLICK'));
assert(has('check', 'CHECK'));
assert(has('check', 'UNCHECK'));
assert(has('radio-a', 'CHECK'));
assert(!has('radio-a', 'UNCHECK'));
assert(has('native-select', 'SELECT'));
assert(!has('custom-combo', 'SELECT'), 'ARIA combobox is not a native select');
assert(has('custom-combo', 'CLICK'));
assert(has('custom-combo', 'FOCUS'));
assert(has('image-file', 'SELECT_FILE'));
assert(has('image-file', 'IMAGE_UPLOAD'));
assert(has('multi-file', 'SELECT_FILE'));
assert(has('file-drop', 'DROP_FILE'));
assert(has('drag-source', 'DRAG_SOURCE'));
assert(has('drop-target', 'DROP_TARGET'));
assert(has('image', 'IMAGE'));

function validate(actions, assertions = []) {
  return validateHtmlCapabilityContract({ actions, assertions }, registry);
}
function assertOk(result) { assert.equal(result.ok, true, JSON.stringify(result.errors)); }
function assertCode(result, code) { assert.equal(result.ok, false, 'expected contract rejection'); assert(result.errors.some((item) => item.code === code), JSON.stringify(result.errors)); }

assertOk(validate([{ operation: 'TYPE', elementRef: element('default-input').elementRef, value: 'hello' }]));
assertOk(validate([{ operation: 'TYPE', elementRef: element('date').elementRef, value: '2026-09-15' }]));
assertCode(validate([{ operation: 'TYPE', elementRef: element('date').elementRef, value: '2026-02-30' }]), 'HTML_INPUT_VALUE_INVALID');
assertOk(validate([{ operation: 'TYPE', elementRef: element('time').elementRef, value: '23:59:30' }]));
assertCode(validate([{ operation: 'TYPE', elementRef: element('time').elementRef, value: '25:99' }]), 'HTML_INPUT_VALUE_INVALID');
assertOk(validate([{ operation: 'TYPE', elementRef: element('datetime').elementRef, value: '2026-09-15T14:30' }]));
assertOk(validate([{ operation: 'TYPE', elementRef: element('month').elementRef, value: '2026-09' }]));
assertOk(validate([{ operation: 'TYPE', elementRef: element('week').elementRef, value: '2026-W38' }]));
assertOk(validate([{ operation: 'SET_RANGE_VALUE', elementRef: element('range').elementRef, value: '50' }]));
assertCode(validate([{ operation: 'SET_RANGE_VALUE', elementRef: element('range').elementRef, value: '55' }]), 'HTML_RANGE_VALUE_INVALID');
assertCode(validate([{ operation: 'TYPE', elementRef: element('range').elementRef, value: '50' }]), 'HTML_ACTION_CAPABILITY_MISMATCH');
assertOk(validate([{ operation: 'SELECT', elementRef: element('native-select').elementRef, value: 'a' }]));
assertCode(validate([{ operation: 'SELECT', elementRef: element('native-select').elementRef, value: 'b' }]), 'HTML_SELECT_OPTION_DISABLED');
assertCode(validate([{ operation: 'SELECT', elementRef: element('custom-combo').elementRef, value: 'a' }]), 'HTML_ACTION_CAPABILITY_MISMATCH');
assertOk(validate([{ operation: 'SELECT_FILE', elementRef: element('image-file').elementRef, fileName: 'sample.svg' }]));
assertCode(validate([{ operation: 'SELECT_FILE', elementRef: element('image-file').elementRef, fileName: 'sample.txt' }]), 'HTML_FILE_ACCEPT_MISMATCH');
assertOk(validate([{ operation: 'SELECT_FILES', elementRef: element('multi-file').elementRef, fileNames: ['sample.txt', 'sample.svg'] }]));
assertCode(validate([{ operation: 'SELECT_FILES', elementRef: element('image-file').elementRef, fileNames: ['sample.svg', 'sample.txt'] }]), 'HTML_FILE_MULTIPLE_NOT_ALLOWED');
assertOk(validate([{ operation: 'DROP_FILE', elementRef: element('file-drop').elementRef, fileName: 'sample.svg' }]));
assertCode(validate([{ operation: 'DROP_FILE', elementRef: element('ordinary').elementRef, fileName: 'sample.svg' }]), 'HTML_ACTION_CAPABILITY_MISMATCH');
assertOk(validate([{ operation: 'DRAG_DROP', sourceElementRef: element('drag-source').elementRef, targetElementRef: element('drop-target').elementRef }]));
assertCode(validate([{ operation: 'DRAG_DROP', sourceElementRef: element('ordinary').elementRef, targetElementRef: element('drop-target').elementRef }]), 'HTML_DRAG_SOURCE_UNGROUNDED');
assertCode(validate([{ operation: 'TYPE', elementRef: element('content').elementRef, value: 'invented' }]), 'HTML_ACTION_CAPABILITY_MISMATCH');
assertOk(validate([], [{ operation: 'ASSERT_TEXT_CONTAINS', elementRef: element('heading').elementRef, text: 'Capability' }]));
assertOk(validate([], [{ operation: 'ASSERT_IMAGE_LOADED', elementRef: element('image').elementRef }]));
assertCode(validate([], [{ operation: 'ASSERT_IMAGE_LOADED', elementRef: element('content').elementRef }]), 'HTML_ASSERTION_CAPABILITY_MISMATCH');

const alignedFiles = validateHtmlCompiledAlignment({
  canonicalIr: { actions: [{ operation: 'SELECT_FILES', elementRef: element('multi-file').elementRef, fileNames: ['sample.txt', 'sample.svg'] }] },
  automationReadiness: { automationPlan: { actions: [{ operation: 'SELECT_FILES', selector: '#multi-file', elementRef: element('multi-file').elementRef, fileNames: ['sample.txt', 'sample.svg'] }] } },
});
assert.equal(alignedFiles.ok, true, JSON.stringify(alignedFiles.errors));
const driftedFiles = validateHtmlCompiledAlignment({
  canonicalIr: { actions: [{ operation: 'SELECT_FILES', elementRef: element('multi-file').elementRef, fileNames: ['sample.txt', 'sample.svg'] }] },
  automationReadiness: { automationPlan: { actions: [{ operation: 'SELECT_FILES', selector: '#multi-file', elementRef: element('multi-file').elementRef, fileNames: ['sample.svg', 'sample.txt'] }] } },
});
assert.equal(driftedFiles.ok, false);
assert.equal(driftedFiles.reasonCode, 'HTML_COMPILED_FILE_ARRAY_DRIFT');

const rangeScript = generator.generateDeterministicAutomation([{
  id: 'TC_RANGE', title: 'Range', automationReadiness: { automationPlan: { actions: [{ operation: 'SET_RANGE_VALUE', selector: '#range', elementRef: element('range').elementRef, value: '50' }], assertions: [] } },
}]).script;
assert(rangeScript.includes("HTMLInputElement.prototype,'value'"), rangeScript);
assert(rangeScript.includes(".trigger('input').trigger('change')"), rangeScript);

const dropScript = generator.generateDeterministicAutomation([{
  id: 'TC_DROP', title: 'File drop', automationReadiness: { automationPlan: { actions: [{ operation: 'DROP_FILE', selector: '#file-drop', elementRef: element('file-drop').elementRef, fileName: 'sample.svg' }], assertions: [] } },
}]).script;
assert(dropScript.includes("action: 'drag-drop'"), dropScript);
assert(dropScript.includes('testNexusResolveUploadFixture'), dropScript);

console.log('html-capability-contract-smoke: PASS');

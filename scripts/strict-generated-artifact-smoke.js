const assert = require('assert');
const { buildCanonicalElementRegistry } = require('../server/services/canonicalElementRegistry');
const {
  validateStrictGeneratedArtifact,
  validateGeneratedScriptSyntax,
} = require('../server/services/strictGeneratedArtifactValidator');

const pageDiscoveries = [{
  url: 'https://example.test/form',
  finalUrl: 'https://example.test/form',
  elements: [
    { tag: 'input', type: 'date', id: 'start-date', selector: '#start-date', label: 'Start date' },
    { tag: 'select', type: 'select', id: 'role', selector: '#role', label: 'Role', options: [{ value: 'user', text: 'User' }, { value: 'admin', text: 'Admin' }] },
    { tag: 'input', type: 'file', id: 'attachment', selector: '#attachment', label: 'Attachment' },
    { tag: 'button', type: 'submit', id: 'submit', selector: '#submit', label: 'Submit', text: 'Submit' },
  ],
  messages: [],
}];

const registry = buildCanonicalElementRegistry(pageDiscoveries);
const byId = new Map(registry.elements.filter((item) => item.id).map((item) => [item.id, item]));
const date = byId.get('start-date');
const role = byId.get('role');
const attachment = byId.get('attachment');

function testCase(actions, assertions = [{ operation: 'ASSERT_VISIBLE', elementRef: attachment.elementRef }]) {
  const compiledActions = actions.map((action) => ({
    ...action,
    selector: action.elementRef ? registry.elements.find((item) => item.elementRef === action.elementRef)?.selector : action.selector,
  }));
  const compiledAssertions = assertions.map((assertion) => ({
    ...assertion,
    selector: assertion.elementRef ? registry.elements.find((item) => item.elementRef === assertion.elementRef)?.selector : assertion.selector,
  }));
  return {
    id: 'TC001',
    title: 'Strict executable artifact smoke',
    type: 'positive',
    testCategory: 'FUNCTIONAL',
    canonicalIr: { version: 1, plannedId: 'P001', objective: 'Exercise strict browser artifact validation.', actions, assertions },
    automationReadiness: { status: 'READY', automatable: true, automationPlan: { actions: compiledActions, assertions: compiledAssertions } },
  };
}

const valid = testCase([
  { operation: 'NAVIGATE', path: '/form' },
  { operation: 'TYPE', elementRef: date.elementRef, value: '2026-09-15' },
  { operation: 'SELECT', elementRef: role.elementRef, value: 'user' },
  { operation: 'SELECT_FILE', elementRef: attachment.elementRef, fileName: 'sample.txt' },
]);
const validResult = validateStrictGeneratedArtifact(valid, { pageDiscoveries, canonicalElementRegistry: registry });
assert.equal(validResult.ok, true, JSON.stringify(validResult.errors));

const missingFixture = testCase([{ operation: 'SELECT_FILE', elementRef: attachment.elementRef, fileName: 'missing-file.txt' }]);
const missingResult = validateStrictGeneratedArtifact(missingFixture, { pageDiscoveries, canonicalElementRegistry: registry });
assert.equal(missingResult.ok, false);
assert(missingResult.errors.some((item) => item.code === 'ARTIFACT_UPLOAD_FIXTURE_MISSING'));

const invalidDate = testCase([{ operation: 'TYPE', elementRef: date.elementRef, value: 'not-a-date' }]);
const dateResult = validateStrictGeneratedArtifact(invalidDate, { pageDiscoveries, canonicalElementRegistry: registry });
assert.equal(dateResult.ok, false);
assert(dateResult.errors.some((item) => item.code === 'ARTIFACT_INPUT_VALUE_SYNTAX_INVALID'));

const invalidOption = testCase([{ operation: 'SELECT', elementRef: role.elementRef, value: 'owner' }]);
const optionResult = validateStrictGeneratedArtifact(invalidOption, { pageDiscoveries, canonicalElementRegistry: registry });
assert.equal(optionResult.ok, false);
assert(optionResult.errors.some((item) => item.code === 'ARTIFACT_SELECT_OPTION_NOT_DISCOVERED'));

const selectorDrift = testCase([{ operation: 'SELECT_FILE', elementRef: attachment.elementRef, fileName: 'sample.txt' }]);
selectorDrift.automationReadiness.automationPlan.actions[0].selector = '#wrong-file-control';
const driftResult = validateStrictGeneratedArtifact(selectorDrift, { pageDiscoveries, canonicalElementRegistry: registry });
assert.equal(driftResult.ok, false);
assert(driftResult.errors.some((item) => item.code === 'ARTIFACT_SELECTOR_DRIFT'));

const syntax = validateGeneratedScriptSyntax("describe('x', () => { it('TC001 - x', () => { cy.get('#x') });", { singleCase: true });
assert.equal(syntax.ok, false);
assert(syntax.errors.some((item) => item.code === 'ARTIFACT_JAVASCRIPT_INVALID'));

console.log('strict-generated-artifact-smoke: PASS');

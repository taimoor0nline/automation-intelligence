const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildCanonicalElementRegistry } = require('../server/services/canonicalElementRegistry');
const { normalizeBehavioralIr, normalizeOperationBuckets } = require('../server/services/canonicalBehaviorGrounding');
const { validateCanonicalIr } = require('../server/services/canonicalTestIrV3');
const { parseAutomationScript } = require('../server/services/manualAutomationScript');

const page = {
  url: 'http://localhost:4000/repair-contract',
  finalUrl: 'http://localhost:4000/repair-contract',
  pageTitle: 'Repair Contract',
  elements: [
    { tag: 'button', type: 'button', id: 'repair-submit', selector: '#repair-submit', text: 'Submit', disabled: false },
    { tag: 'div', type: 'div', id: 'repair-result', selector: '#repair-result', text: 'Ready', disabled: false },
  ],
};

const registry = buildCanonicalElementRegistry([page]);
const byId = new Map(registry.elements.map((item) => [item.id, item]));
const submit = byId.get('repair-submit');
const result = byId.get('repair-result');
assert(submit?.elementRef, 'Expected grounded submit element.');
assert(result?.elementRef, 'Expected grounded result element.');

const malformed = {
  version: 1,
  plannedId: 'P004',
  objective: 'Click Submit and verify the result is visible',
  actions: [
    { operation: 'CLICK', elementRef: submit.elementRef },
    // Regression: some AI repair responses accidentally placed a valid assertion
    // in actions, producing "Unsupported canonical action ASSERT_VISIBLE".
    { operation: 'ASSERT_VISIBLE', elementRef: result.elementRef },
  ],
  assertions: [],
};

const buckets = normalizeOperationBuckets(malformed);
assert.deepStrictEqual(buckets.actions.map((item) => item.operation), ['CLICK']);
assert.deepStrictEqual(buckets.assertions.map((item) => item.operation), ['ASSERT_VISIBLE']);
assert.strictEqual(buckets.relocatedAssertions.length, 1);

const grounded = normalizeBehavioralIr(malformed, {
  registry,
  plannedUnit: { plannedId: 'P004', scenarioType: 'positive', objective: malformed.objective },
  story: 'Click Submit and verify the result is visible.',
});
assert.strictEqual(grounded.unresolved.length, 0);
assert.deepStrictEqual(grounded.ir.actions.map((item) => item.operation), ['CLICK']);
assert(grounded.ir.assertions.some((item) => item.operation === 'ASSERT_VISIBLE'));
assert(grounded.enrichments.some((item) => item.code === 'MISPLACED_ASSERTION_RELOCATED'));

const validation = validateCanonicalIr(grounded.ir, {
  registry,
  story: 'Click Submit and verify the result is visible.',
  hasCredentials: false,
});
assert(validation.ok, validation.reason || JSON.stringify(validation.errors || []));
assert(validation.plan.assertions.some((item) => item.operation === 'ASSERT_VISIBLE'));
assert(!validation.plan.actions.some((item) => item.operation.startsWith('ASSERT_')));

// Repair-workbench wiring regression: the canonical workbench must be reachable
// from the server and its browser UI must actually load.
const serverIndex = fs.readFileSync(path.resolve(__dirname, '..', 'server', 'index.js'), 'utf8');
assert(
  /require\(["']\.\/routes\/testCaseRepairWorkbench["']\)/.test(serverIndex),
  'server/index.js must import the canonical test-case repair workbench route.'
);
assert(
  /app\.use\(testCaseRepairWorkbenchRoutes\)/.test(serverIndex),
  'server/index.js must mount the canonical test-case repair workbench route.'
);
assert(
  /test-case-repair-workbench\.js/.test(serverIndex),
  'The served TestNexus UI must load test-case-repair-workbench.js so blocked cases do not fall back to the legacy repair endpoint.'
);

// Canonical regeneration regression for the exact negative-login failure pattern:
// an AI response may accidentally use ASSERT_URL_EQUALS with a path field and may
// add a redundant "stay on /login" location assertion after submit. The repair
// pipeline should normalize the malformed field shape, then remove the redundant
// ungrounded location expectation while preserving the business assertion.
const loginPage = {
  url: 'https://example.test/login',
  finalUrl: 'https://example.test/login',
  pageTitle: 'Login',
  elements: [
    { tag: 'input', type: 'email', id: 'email', selector: '#email', required: true, value: '', disabled: false, readonly: false, formId: 'login-form' },
    { tag: 'input', type: 'password', id: 'password', selector: '#password', required: true, value: '', disabled: false, readonly: false, formId: 'login-form' },
    { tag: 'button', type: 'submit', id: 'sign-in', selector: '#sign-in', text: 'Sign in', disabled: false, formId: 'login-form' },
  ],
};
const loginRegistry = buildCanonicalElementRegistry([loginPage]);
const loginById = new Map(loginRegistry.elements.map((item) => [item.id, item]));
const email = loginById.get('email');
const password = loginById.get('password');
const signIn = loginById.get('sign-in');
assert(email?.elementRef && password?.elementRef && signIn?.elementRef, 'Expected grounded login controls.');

const malformedLogin = {
  version: 1,
  plannedId: 'P002',
  objective: 'Login page with empty password field to verify required field validation prevents submission',
  actions: [
    { operation: 'NAVIGATE', path: '/login' },
    { operation: 'CLEAR', elementRef: password.elementRef },
    { operation: 'CLICK', elementRef: signIn.elementRef },
  ],
  assertions: [
    { operation: 'ASSERT_URL_EQUALS', path: '/login' },
    { operation: 'ASSERT_INVALID', elementRef: password.elementRef },
  ],
};

const rawMalformedValidation = validateCanonicalIr(malformedLogin, {
  registry: loginRegistry,
  story: 'Test login negative validation only.',
  plannedUnit: { plannedId: 'P002', scenarioType: 'negative', objective: malformedLogin.objective },
  hasCredentials: true,
});
assert.strictEqual(
  rawMalformedValidation.ok,
  false,
  'ASSERT_URL_EQUALS without a url/value field must fail strict canonical validation when it reaches the validator unnormalized.'
);

const normalizedLogin = normalizeBehavioralIr(malformedLogin, {
  registry: loginRegistry,
  plannedUnit: { plannedId: 'P002', scenarioType: 'negative', objective: malformedLogin.objective },
  story: 'As a user test login negative validation only.',
});
assert.strictEqual(normalizedLogin.unresolved.length, 0);
assert(
  normalizedLogin.enrichments.some((item) => item.code === 'NAVIGATION_ASSERTION_SHAPE_NORMALIZED'),
  'Malformed ASSERT_URL_EQUALS(path) should be normalized deterministically before canonical validation.'
);
assert(
  normalizedLogin.enrichments.some((item) => item.code === 'REDUNDANT_UNGROUNDED_LOCATION_ASSERTION_REMOVED'),
  'A redundant same-page location assertion after negative form submission should be removed when another grounded assertion proves the intended validation.'
);
assert.deepStrictEqual(
  normalizedLogin.ir.assertions.map((item) => item.operation),
  ['ASSERT_INVALID'],
  'Negative login validation should retain ASSERT_INVALID and not depend on an unstated post-submit location.'
);

const normalizedValidation = validateCanonicalIr(normalizedLogin.ir, {
  registry: loginRegistry,
  story: 'As a user test login negative validation only.',
  plannedUnit: { plannedId: 'P002', scenarioType: 'negative', objective: malformedLogin.objective },
  hasCredentials: true,
});
assert(normalizedValidation.ok, normalizedValidation.reason || JSON.stringify(normalizedValidation.errors || []));

// Do not weaken an explicit business contract. If the user explicitly requires
// the path to remain /login, preserve the location assertion.
const explicitLocation = normalizeBehavioralIr({
  ...malformedLogin,
  assertions: [
    { operation: 'ASSERT_PATH_EQUALS', path: '/login' },
    { operation: 'ASSERT_INVALID', elementRef: password.elementRef },
  ],
}, {
  registry: loginRegistry,
  plannedUnit: { plannedId: 'P002', scenarioType: 'negative', objective: malformedLogin.objective },
  story: 'After invalid submission, the browser must remain on /login and the password field must be invalid.',
});
assert(
  explicitLocation.ir.assertions.some((item) => item.operation === 'ASSERT_PATH_EQUALS'),
  'Explicit user-authored location requirements must not be removed.'
);

// A human-authored script must be an executable canonical artifact, not text
// copied into the legacy human-readable Steps/Expected Results textareas.
const humanScript = [
  'NAVIGATE /login',
  'TYPE #email invalid-email',
  'CLICK #sign-in',
  'ASSERT_INVALID #email',
].join('\n');
const manual = parseAutomationScript(humanScript, loginRegistry);
assert.deepStrictEqual(manual.actions.map(item => item.operation), ['NAVIGATE','TYPE','CLICK']);
assert.deepStrictEqual(manual.assertions.map(item => item.operation), ['ASSERT_INVALID']);
assert.strictEqual(manual.actions[1].elementRef, email.elementRef);
assert.strictEqual(manual.actions[2].elementRef, signIn.elementRef);
assert.strictEqual(manual.assertions[0].elementRef, email.elementRef);
const manualChecked = validateCanonicalIr({
  version: 1, plannedId: 'P002', objective: 'Login page with invalid email to verify native validation',
  ...manual,
}, {
  registry: loginRegistry,
  story: 'Test login negative validation only.',
  plannedUnit: { plannedId: 'P002', scenarioType: 'negative', objective: 'Login page with invalid email to verify native validation' },
  hasCredentials: false,
});
assert(manualChecked.ok, manualChecked.reason || JSON.stringify(manualChecked.errors || []));
assert.throws(
  () => parseAutomationScript('cy.visit("/login");\ncy.get("#email").click();', loginRegistry),
  /arbitrary JavaScript|not in the supported|supported uppercase/,
);
assert.throws(
  () => parseAutomationScript('NAVIGATE /login\nCLICK #invented\nASSERT_INVALID #email', loginRegistry),
  /not discovered/,
);
assert.throws(
  () => parseAutomationScript('NAVIGATE /login\nCLICK #sign-in', loginRegistry),
  /assertion is required/,
);
const repairUi = fs.readFileSync(path.resolve(__dirname, '..', 'testpilot-ui', 'test-case-repair-workbench.js'), 'utf8');
const decoratedUi = fs.readFileSync(path.resolve(__dirname, '..', 'testpilot-ui', 'add-test-mode.js'), 'utf8');
assert(repairUi.includes('data-repair-action="save-script"'), 'Manual script editor must have a real Validate & Save action.');
assert(repairUi.includes("action: 'manual-script'"), 'Manual script editor must send a canonical manual-script request.');
assert(!repairUi.includes("steps.value = seed.steps"), 'Manual automation script must never be pasted into human-readable Steps.');
assert(decoratedUi.includes("btn.matches('[data-repair-workbench]')"), 'UI decorator must not mutate or remove the canonical Repair button.');
assert(serverIndex.includes("test-case-repair-workbench.js"), 'The repair UI must be injected into the served application.');

console.log('repair-workbench-contract-smoke: PASS');

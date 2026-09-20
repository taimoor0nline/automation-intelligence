const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildCanonicalElementRegistry } = require('../server/services/canonicalElementRegistry');
const { normalizeBehavioralIr, normalizeOperationBuckets } = require('../server/services/canonicalBehaviorGrounding');
const { validateCanonicalIr } = require('../server/services/canonicalTestIrV3');
const { parseAutomationScript } = require('../server/services/manualAutomationScript');
const { parseCypressScript } = require('../server/services/cypressManualScript');

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
const repairRoute = fs.readFileSync(path.resolve(__dirname, '..', 'server', 'routes', 'testCaseRepairWorkbench.js'), 'utf8');
assert(repairRoute.includes('parseCypressScript(script, registry)'), 'The active manual script endpoint must use Cypress syntax rather than the legacy TestNexus DSL.');
assert(repairUi.includes('cy.visit(') && repairUi.includes('cy.get('), 'The manual editor must show Cypress syntax.');

// The public editor accepts native Cypress calls, not the legacy proprietary DSL.
// They still compile into the grounded canonical contract; no arbitrary code runs.
const cypressScript = [
  'cy.visit("/login");',
  'cy.get("#email").clear().type("invalid-email");',
  'cy.get("#sign-in").click();',
  'cy.get("#email").should("match", ":invalid");',
].join('\n');
const cypress = parseCypressScript(cypressScript, loginRegistry);
assert.deepStrictEqual(cypress.actions.map(item => item.operation), ['NAVIGATE','CLEAR','TYPE','CLICK']);
assert.deepStrictEqual(cypress.assertions.map(item => item.operation), ['ASSERT_INVALID']);
assert.strictEqual(cypress.actions[2].elementRef, email.elementRef);
assert.strictEqual(cypress.actions[3].elementRef, signIn.elementRef);
const cypressChecked = validateCanonicalIr({
  version: 1, plannedId: 'P002',
  objective: 'Login page with invalid email to verify native validation',
  ...cypress,
}, {
  registry: loginRegistry,
  story: 'Test login negative validation only.',
  plannedUnit: {
    plannedId: 'P002', scenarioType: 'negative',
    objective: 'Login page with invalid email to verify native validation',
  },
  hasCredentials: false,
});
assert(cypressChecked.ok, cypressChecked.reason || JSON.stringify(cypressChecked.errors || []));

const emptyPassword = parseCypressScript([
  'cy.visit("/login");',
  'cy.get("#password").clear();',
  'cy.get("#sign-in").click();',
  'cy.get("#password").should("match", ":invalid");',
].join('\n'), loginRegistry);
assert.deepStrictEqual(emptyPassword.assertions.map(item => item.operation), ['ASSERT_INVALID']);
const locationCheck = parseCypressScript([
  'cy.visit("/login");',
  'cy.get("#email").click();',
  'cy.location("pathname").should("eq", "/login");',
].join('\n'), loginRegistry);
assert.strictEqual(locationCheck.assertions[0].operation,'ASSERT_PATH_EQUALS');

assert.throws(
  () => parseCypressScript('NAVIGATE /login\nTYPE #email invalid-email\nASSERT_INVALID #email', loginRegistry),
  /Cypress cy\.\*/,
);
assert.throws(
  () => parseCypressScript('cy.visit("/login");\ncy.get("#invented").click();\ncy.get("#email").should("be.visible");', loginRegistry),
  /not a discovered control/,
);
assert.throws(
  () => parseCypressScript('cy.visit("/login");\ncy.get("#email").then(($x) => {});', loginRegistry),
  /Nested expressions|quoted string literal|Unsupported Cypress/,
);
assert.throws(
  () => parseCypressScript('cy.visit("/login");\ncy.get("#sign-in").click();', loginRegistry),
  /assertion is required/,
);

const { contractReviewHash, isConfirmedCurrentReview } = require('../server/services/reviewContract');
const runtimeCredentialScript = parseCypressScript([
  'cy.visit("/login");',
  'cy.get("#password").type(Cypress.env("password"));',
  'cy.get("#email").should("match", ":invalid");',
].join('\n'), loginRegistry);
assert.strictEqual(runtimeCredentialScript.actions[1].operation, 'TYPE_RUNTIME_CREDENTIAL');
assert.strictEqual(runtimeCredentialScript.actions[1].credential, 'password');
assert.throws(
  () => parseCypressScript('cy.visit("/login");\ncy.get("#password").type(Cypress.env("arbitrary"));\ncy.get("#email").should("match", ":invalid");', loginRegistry),
  /quoted string literal|expressions|Unsupported/,
);

const reviewedCase = {
  canonicalIr: { actions: [{ operation: 'NAVIGATE', path: '/login' }], assertions: [{ operation: 'ASSERT_INVALID', elementRef: email.elementRef }] },
  expectedResults: ['Email is invalid'],
  automationReadiness: {
    automationPlan: { actions: [], assertions: [], registryHash: loginRegistry.registryHash },
    cypressContract: { scriptHash: 'a'.repeat(64) },
  },
};
const reviewedHash = contractReviewHash(reviewedCase);
assert.equal(isConfirmedCurrentReview({ ...reviewedCase, review: {
  status: 'PENDING_REVIEW', revision: 1, contractHash: reviewedHash,
}}), false, 'A validated draft must not be executable before a separate human confirmation.');
assert.equal(isConfirmedCurrentReview({ ...reviewedCase, review: {
  status: 'CONFIRMED', revision: 1, confirmedAt: new Date().toISOString(), contractHash: reviewedHash,
}}), true, 'A confirmed and unchanged canonical contract may proceed to the regular approval seal.');
assert.equal(isConfirmedCurrentReview({
  ...reviewedCase,
  expectedResults: ['Something else'],
  review: { status: 'CONFIRMED', confirmedAt: new Date().toISOString(), contractHash: reviewedHash },
}), false, 'Editing expectations after confirmation must revoke the reviewed contract.');

const persistedRoute = fs.readFileSync(path.resolve(__dirname, '..', 'server', 'routes', 'testCaseRepairWorkbench.js'), 'utf8');
const approvalGuard = fs.readFileSync(path.resolve(__dirname, '..', 'server', 'routes', 'approvalContractGuard.js'), 'utf8');
assert(persistedRoute.includes("persistence.persistReviewedCase(sessionId, session, candidate)"), 'A saved human edit must await persistence before returning success.');
assert(persistedRoute.includes("mode === 'confirm'"), 'The human must have a separate confirm action after validation.');
assert(approvalGuard.includes('isConfirmedCurrentReview(testCase)'), 'Execution must block unconfirmed or changed human-edited contracts.');
assert(repairUi.includes('data-repair-action="confirm"'), 'The repair workbench must expose Confirm Reviewed Contract.');
assert(repairUi.includes('expectedRevision:'), 'The UI must pass revision checks to prevent stale edits.');

(async () => {
  const db = require('../server/db');
  const persistence = require('../server/services/persistenceService');
  const original = { configured: db.isConfigured, withTransaction: db.withTransaction };
  const statements = [];
  try {
    db.isConfigured = () => true;
    db.withTransaction = async (work) => work({
      query: async (sql, params) => { statements.push({ sql, params }); return { rows: [], rowCount: 1 }; },
    });
    const savedCase = {
      ...reviewedCase,
      id: 'TC002', title: 'Negative login validation', type: 'negative', priority: 'medium',
      testCategory: 'FUNCTIONAL', source: 'human-automation-script',
      review: { status: 'PENDING_REVIEW', revision: 1, contractHash: reviewedHash, confirmedAt: null },
    };
    const session = {
      state: 'GENERATED', story: 'Negative login test', targetUrl: 'https://example.test/login',
      targetType: 'WEB', testCases: [savedCase], pageDiscoveries: [], approvedIds: [],
      automationReadiness: { ready: 1, total: 1 }, readinessValidated: true,
      testActors: [], actorCredentials: {},
    };
    assert.equal(await persistence.persistReviewedCase('review-persistence-smoke', session, savedCase), true);
    assert.deepStrictEqual(statements.map((item) =>
      item.sql.includes('insert into test_sessions') ? 'session'
        : item.sql.includes('insert into test_cases') ? 'case'
        : item.sql.includes('insert into canonical_test_ir') ? 'canonical'
        : 'unexpected'
    ), ['session', 'case', 'canonical'], 'DB mode must save review, case and IR in one PostgreSQL transaction.');
    const sessionPayload = JSON.parse(statements[0].params.at(-1));
    const casePayload = JSON.parse(statements[1].params.at(-1));
    assert.equal(sessionPayload.testCases[0].review.status, 'PENDING_REVIEW');
    assert.equal(casePayload.review.revision, 1);
    assert.equal(sessionPayload.actorCredentials, undefined, 'Runtime credentials must never be persisted in session JSON.');
  } finally {
    db.isConfigured = original.configured;
    db.withTransaction = original.withTransaction;
  }
  console.log('repair-workbench-contract-smoke: PASS');
})().catch((err) => { console.error(err); process.exitCode = 1; });


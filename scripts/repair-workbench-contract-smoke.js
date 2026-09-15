const assert = require('assert');
const { buildCanonicalElementRegistry } = require('../server/services/canonicalElementRegistry');
const { normalizeBehavioralIr, normalizeOperationBuckets } = require('../server/services/canonicalBehaviorGrounding');
const { validateCanonicalIr } = require('../server/services/canonicalTestIrV3');

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

console.log('repair-workbench-contract-smoke: PASS');

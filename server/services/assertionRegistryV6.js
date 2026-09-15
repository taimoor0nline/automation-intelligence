const v5 = require('./assertionRegistryV5');

const TAG_ASSERTIONS = Object.freeze({
  ASSERT_SELECTED_TAG_PRESENT: Object.freeze({
    operation: 'ASSERT_SELECTED_TAG_PRESENT',
    category: 'form',
    description: 'The grounded multi-select exposes a semantic remove affordance for the expected selected tag/chip value',
  }),
  ASSERT_SELECTED_TAG_ABSENT: Object.freeze({
    operation: 'ASSERT_SELECTED_TAG_ABSENT',
    category: 'form',
    description: 'The grounded multi-select no longer exposes a semantic remove affordance for the expected selected tag/chip value',
  }),
  ASSERT_NO_SELECTED_TAGS: Object.freeze({
    operation: 'ASSERT_NO_SELECTED_TAGS',
    category: 'form',
    description: 'The grounded multi-select exposes no selected tag/chip remove affordances',
  }),
});

const ASSERTION_REGISTRY = Object.freeze({ ...v5.ASSERTION_REGISTRY, ...TAG_ASSERTIONS });
const ASSERTION_OPERATIONS = Object.freeze(Object.keys(ASSERTION_REGISTRY));
const ASSERTION_OPERATION_SET = new Set(ASSERTION_OPERATIONS);

function assertionCatalog() {
  return ASSERTION_OPERATIONS.map((operation) => ASSERTION_REGISTRY[operation]);
}

module.exports = {
  ...v5,
  ASSERTION_REGISTRY,
  ASSERTION_OPERATIONS,
  ASSERTION_OPERATION_SET,
  assertionCatalog,
  TAG_ASSERTIONS,
};

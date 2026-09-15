const v4 = require('./assertionRegistryV4');

const EXTRA_ASSERTIONS = Object.freeze({
  ASSERT_SELECTED_VALUES_EQUALS: Object.freeze({
    operation: 'ASSERT_SELECTED_VALUES_EQUALS',
    category: 'form',
    description: 'Native multiple select has exactly the expected selected option values in DOM order',
  }),
});

const ASSERTION_REGISTRY = Object.freeze({ ...v4.ASSERTION_REGISTRY, ...EXTRA_ASSERTIONS });
const ASSERTION_OPERATIONS = Object.freeze(Object.keys(ASSERTION_REGISTRY));
const ASSERTION_OPERATION_SET = new Set(ASSERTION_OPERATIONS);

function assertionCatalog() {
  return ASSERTION_OPERATIONS.map((operation) => ASSERTION_REGISTRY[operation]);
}

module.exports = {
  ...v4,
  ASSERTION_REGISTRY,
  ASSERTION_OPERATIONS,
  ASSERTION_OPERATION_SET,
  assertionCatalog,
  EXTRA_ASSERTIONS,
};

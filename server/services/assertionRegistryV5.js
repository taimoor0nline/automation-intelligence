const v4 = require('./assertionRegistryV4');

const EXTRA_ASSERTIONS = Object.freeze({
  ASSERT_SELECTED_VALUES_EQUALS: Object.freeze({
    operation: 'ASSERT_SELECTED_VALUES_EQUALS',
    category: 'form',
    description: 'Native multiple select has exactly the expected selected option values in DOM order',
  }),
  ASSERT_COMBOBOX_EXPANDED: Object.freeze({ operation: 'ASSERT_COMBOBOX_EXPANDED', category: 'form', description: 'Discovered semantic combobox reports aria-expanded=true' }),
  ASSERT_COMBOBOX_COLLAPSED: Object.freeze({ operation: 'ASSERT_COMBOBOX_COLLAPSED', category: 'form', description: 'Discovered semantic combobox reports aria-expanded=false' }),
  ASSERT_SUGGESTION_VISIBLE: Object.freeze({ operation: 'ASSERT_SUGGESTION_VISIBLE', category: 'form', description: 'Associated rendered suggestion list contains the expected visible option' }),
  ASSERT_SUGGESTION_NOT_VISIBLE: Object.freeze({ operation: 'ASSERT_SUGGESTION_NOT_VISIBLE', category: 'form', description: 'Associated rendered suggestion list does not contain the expected visible option' }),
  ASSERT_NO_SUGGESTIONS: Object.freeze({ operation: 'ASSERT_NO_SUGGESTIONS', category: 'form', description: 'Associated rendered suggestion list contains no selectable options' }),
  ASSERT_SUGGESTION_SELECTED: Object.freeze({ operation: 'ASSERT_SUGGESTION_SELECTED', category: 'form', description: 'Expected option in the associated semantic listbox reports aria-selected=true' }),
  ASSERT_SELECTED_SUGGESTIONS_EQUALS: Object.freeze({ operation: 'ASSERT_SELECTED_SUGGESTIONS_EQUALS', category: 'form', description: 'Associated multi-select listbox has exactly the expected aria-selected option labels or values' }),
  ASSERT_SEARCH_SUGGESTIONS_CONTAIN: Object.freeze({ operation: 'ASSERT_SEARCH_SUGGESTIONS_CONTAIN', category: 'form', description: 'Search or autocomplete suggestions contain the expected evidenced suggestion' }),
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

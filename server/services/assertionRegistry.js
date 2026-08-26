const ASSERTION_DEFINITIONS = [
  ["ASSERT_EXISTS", "element", "Element exists in the DOM"],
  ["ASSERT_NOT_EXISTS", "element", "Element does not exist in the DOM"],
  ["ASSERT_VISIBLE", "element", "Element is visible"],
  ["ASSERT_HIDDEN", "element", "Element exists but is not visible"],
  ["ASSERT_HIDDEN_OR_ABSENT", "element", "Element is hidden or absent"],

  ["ASSERT_TEXT_EQUALS", "text", "Element text equals the expected text"],
  ["ASSERT_TEXT_CONTAINS", "text", "Element text contains the expected text"],
  ["ASSERT_TEXT_NOT_CONTAINS", "text", "Element text does not contain the expected text"],
  ["ASSERT_TEXT_EMPTY", "text", "Element text is empty"],
  ["ASSERT_TEXT_NOT_EMPTY", "text", "Element text is not empty"],
  ["ASSERT_HTML_EQUALS", "text", "Element HTML equals the expected HTML"],
  ["ASSERT_HTML_CONTAINS", "text", "Element HTML contains the expected HTML fragment"],

  ["ASSERT_VALUE_EQUALS", "form", "Form control value equals the expected value"],
  ["ASSERT_VALUE_CONTAINS", "form", "Form control value contains the expected value"],
  ["ASSERT_VALUE_EMPTY", "form", "Form control value is empty"],
  ["ASSERT_VALUE_NOT_EMPTY", "form", "Form control value is not empty"],
  ["ASSERT_VALUE_LENGTH_EQUALS", "form", "Form control value length equals the expected length"],
  ["ASSERT_VALUE_LENGTH_AT_MOST", "form", "Form control value length is at most the expected length"],
  ["ASSERT_VALUE_LENGTH_AT_LEAST", "form", "Form control value length is at least the expected length"],
  ["ASSERT_CHECKED", "form", "Checkbox or radio is checked"],
  ["ASSERT_UNCHECKED", "form", "Checkbox or radio is not checked"],
  ["ASSERT_ENABLED", "form", "Control is enabled"],
  ["ASSERT_DISABLED", "form", "Control is disabled"],
  ["ASSERT_FOCUSED", "form", "Control has focus"],
  ["ASSERT_REQUIRED", "form", "Control has the required attribute"],
  ["ASSERT_OPTIONAL", "form", "Control does not have the required attribute"],
  ["ASSERT_VALID", "form", "Control satisfies browser validity rules"],
  ["ASSERT_INVALID", "form", "Control violates browser validity rules"],
  ["ASSERT_SELECTED_VALUE_EQUALS", "form", "Select control has the expected selected value"],

  ["ASSERT_ATTR_EXISTS", "attribute", "Element has an attribute"],
  ["ASSERT_ATTR_NOT_EXISTS", "attribute", "Element does not have an attribute"],
  ["ASSERT_ATTR_EQUALS", "attribute", "Element attribute equals an expected value"],
  ["ASSERT_ATTR_CONTAINS", "attribute", "Element attribute contains an expected value"],
  ["ASSERT_PROP_EQUALS", "attribute", "Element DOM property equals an expected value"],
  ["ASSERT_CLASS_INCLUDES", "attribute", "Element has the expected CSS class"],
  ["ASSERT_CLASS_NOT_INCLUDES", "attribute", "Element does not have the expected CSS class"],
  ["ASSERT_CSS_EQUALS", "attribute", "Computed CSS property equals an expected value"],
  ["ASSERT_PLACEHOLDER_EQUALS", "attribute", "Input placeholder equals the expected text"],
  ["ASSERT_ARIA_EQUALS", "attribute", "ARIA attribute equals an expected value"],

  ["ASSERT_COUNT_EQUALS", "collection", "Selector matches exactly the expected number of elements"],
  ["ASSERT_COUNT_AT_LEAST", "collection", "Selector matches at least the expected number of elements"],
  ["ASSERT_COUNT_AT_MOST", "collection", "Selector matches at most the expected number of elements"],

  ["ASSERT_URL_EQUALS", "location", "Current URL equals the expected URL"],
  ["ASSERT_URL_INCLUDES", "location", "Current URL includes the expected fragment"],
  ["ASSERT_URL_NOT_INCLUDES", "location", "Current URL does not include the expected fragment"],
  ["ASSERT_URL_CONTAINS", "location", "Alias of URL includes for backward compatibility"],
  ["ASSERT_PATH_EQUALS", "location", "Current pathname equals the expected path"],
  ["ASSERT_PATH_INCLUDES", "location", "Current pathname includes the expected fragment"],
  ["ASSERT_QUERY_INCLUDES", "location", "Current query string includes the expected fragment"],
  ["ASSERT_HASH_EQUALS", "location", "Current URL hash equals the expected value"],
  ["ASSERT_TITLE_EQUALS", "document", "Document title equals the expected text"],
  ["ASSERT_TITLE_INCLUDES", "document", "Document title includes the expected text"],

  ["ASSERT_COOKIE_EXISTS", "storage", "Cookie exists"],
  ["ASSERT_COOKIE_EQUALS", "storage", "Cookie value equals the expected value"],
  ["ASSERT_COOKIE_ABSENT", "storage", "Cookie is absent"],
  ["ASSERT_LOCAL_STORAGE_EXISTS", "storage", "Local-storage key exists"],
  ["ASSERT_LOCAL_STORAGE_EQUALS", "storage", "Local-storage value equals the expected value"],
  ["ASSERT_LOCAL_STORAGE_ABSENT", "storage", "Local-storage key is absent"],
  ["ASSERT_SESSION_STORAGE_EXISTS", "storage", "Session-storage key exists"],
  ["ASSERT_SESSION_STORAGE_EQUALS", "storage", "Session-storage value equals the expected value"],
  ["ASSERT_SESSION_STORAGE_ABSENT", "storage", "Session-storage key is absent"],
];

const ASSERTION_REGISTRY = Object.freeze(Object.fromEntries(
  ASSERTION_DEFINITIONS.map(([operation, category, description]) => [operation, Object.freeze({ operation, category, description })])
));

const ASSERTION_OPERATIONS = Object.freeze(Object.keys(ASSERTION_REGISTRY));
const ASSERTION_OPERATION_SET = new Set(ASSERTION_OPERATIONS);

const CAPABILITY_SUGGESTIONS = [
  {
    pattern: /\b(api|http|request|response|status\s*code|payload|header)\b/i,
    capability: "NETWORK_ASSERTIONS",
    proposedOperations: ["ASSERT_REQUEST_SENT", "ASSERT_REQUEST_BODY", "ASSERT_REQUEST_HEADER", "ASSERT_RESPONSE_STATUS", "ASSERT_RESPONSE_BODY", "ASSERT_RESPONSE_HEADER"],
    cypressStrategy: "Use cy.intercept() before the triggering action, alias the route, then cy.wait('@alias') and assert on request/response properties.",
  },
  {
    pattern: /\b(accessibility|a11y|wcag|axe|aria violation)\b/i,
    capability: "ACCESSIBILITY_ASSERTIONS",
    proposedOperations: ["ASSERT_NO_ACCESSIBILITY_VIOLATIONS"],
    cypressStrategy: "Use axe-core through cypress-axe, inject axe after cy.visit(), then run cy.checkA11y() with controlled rules.",
  },
  {
    pattern: /\b(download|downloaded file|file contents?|csv|xlsx|pdf download)\b/i,
    capability: "DOWNLOAD_ASSERTIONS",
    proposedOperations: ["ASSERT_FILE_DOWNLOADED", "ASSERT_FILE_EXISTS", "ASSERT_FILE_CONTENT_CONTAINS"],
    cypressStrategy: "Use Cypress downloadsFolder plus cy.readFile()/cy.task() with an allow-listed path and file type.",
  },
  {
    pattern: /\b(performance|load time|response time|first contentful|lcp|cls|web vital)\b/i,
    capability: "PERFORMANCE_ASSERTIONS",
    proposedOperations: ["ASSERT_PAGE_LOAD_AT_MOST", "ASSERT_WEB_VITAL_AT_MOST"],
    cypressStrategy: "Collect browser Performance API metrics through cy.window() and compare against configured thresholds.",
  },
  {
    pattern: /\b(new tab|new window|popup window|window\.open)\b/i,
    capability: "WINDOW_ASSERTIONS",
    proposedOperations: ["ASSERT_WINDOW_OPEN_CALLED", "ASSERT_NEW_WINDOW_URL"],
    cypressStrategy: "Stub window.open before the triggering action and assert the captured URL instead of controlling a second browser tab.",
  },
  {
    pattern: /\b(console error|console warning|javascript error|uncaught error)\b/i,
    capability: "BROWSER_ERROR_ASSERTIONS",
    proposedOperations: ["ASSERT_NO_CONSOLE_ERRORS", "ASSERT_NO_UNCAUGHT_ERRORS"],
    cypressStrategy: "Attach bounded browser-event listeners before the action and assert against captured error events after execution.",
  },
];

function assertionCatalog() {
  return ASSERTION_OPERATIONS.map((operation) => ASSERTION_REGISTRY[operation]);
}

function capabilitySuggestionFor(text) {
  const source = String(text || "");
  const match = CAPABILITY_SUGGESTIONS.find((item) => item.pattern.test(source));
  if (!match) return null;
  return {
    source: "deterministic-capability-hint",
    capability: match.capability,
    proposedOperations: [...match.proposedOperations],
    cypressStrategy: match.cypressStrategy,
  };
}

module.exports = {
  ASSERTION_REGISTRY,
  ASSERTION_OPERATIONS,
  ASSERTION_OPERATION_SET,
  assertionCatalog,
  capabilitySuggestionFor,
};

const ASSERTION_DEFINITIONS = [
  // DOM / visibility
  ["ASSERT_EXISTS", "element", "Element exists in the DOM"],
  ["ASSERT_NOT_EXISTS", "element", "Element does not exist in the DOM"],
  ["ASSERT_VISIBLE", "element", "Element is visible"],
  ["ASSERT_HIDDEN", "element", "Element exists but is not visible"],
  ["ASSERT_HIDDEN_OR_ABSENT", "element", "Element is hidden or absent"],
  ["ASSERT_ELEMENT_IN_VIEWPORT", "element", "Element intersects the current viewport"],
  ["ASSERT_ELEMENT_NOT_IN_VIEWPORT", "element", "Element does not intersect the current viewport"],
  ["ASSERT_ELEMENT_WIDTH_EQUALS", "element", "Element rendered width equals the expected pixels"],
  ["ASSERT_ELEMENT_WIDTH_AT_LEAST", "element", "Element rendered width is at least the expected pixels"],
  ["ASSERT_ELEMENT_WIDTH_AT_MOST", "element", "Element rendered width is at most the expected pixels"],
  ["ASSERT_ELEMENT_HEIGHT_EQUALS", "element", "Element rendered height equals the expected pixels"],
  ["ASSERT_ELEMENT_HEIGHT_AT_LEAST", "element", "Element rendered height is at least the expected pixels"],
  ["ASSERT_ELEMENT_HEIGHT_AT_MOST", "element", "Element rendered height is at most the expected pixels"],
  ["ASSERT_IMAGE_LOADED", "element", "Image has completed successfully and has natural dimensions"],
  ["ASSERT_IMAGE_ALT_NOT_EMPTY", "element", "Image alt text is non-empty"],

  // Text / HTML
  ["ASSERT_TEXT_EQUALS", "text", "Element text equals the expected text"],
  ["ASSERT_TEXT_CONTAINS", "text", "Element text contains the expected text"],
  ["ASSERT_TEXT_NOT_CONTAINS", "text", "Element text does not contain the expected text"],
  ["ASSERT_TEXT_EMPTY", "text", "Element text is empty"],
  ["ASSERT_TEXT_NOT_EMPTY", "text", "Element text is not empty"],
  ["ASSERT_HTML_EQUALS", "text", "Element HTML equals the expected HTML"],
  ["ASSERT_HTML_CONTAINS", "text", "Element HTML contains the expected HTML fragment"],

  // Forms / controls
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
  ["ASSERT_READONLY", "form", "Control is read-only"],
  ["ASSERT_NOT_READONLY", "form", "Control is not read-only"],
  ["ASSERT_VALID", "form", "Control satisfies browser validity rules"],
  ["ASSERT_INVALID", "form", "Control violates browser validity rules"],
  ["ASSERT_SELECTED_VALUE_EQUALS", "form", "Select control has the expected selected value"],
  ["ASSERT_SELECTED_TEXT_EQUALS", "form", "Select control has the expected selected option text"],
  ["ASSERT_OPTION_COUNT_EQUALS", "form", "Select control contains exactly the expected number of options"],
  ["ASSERT_INPUT_TYPE_EQUALS", "form", "Input type equals the expected type"],
  ["ASSERT_MIN_EQUALS", "form", "Control min attribute equals the expected value"],
  ["ASSERT_MAX_EQUALS", "form", "Control max attribute equals the expected value"],
  ["ASSERT_MINLENGTH_EQUALS", "form", "Control minlength attribute equals the expected value"],
  ["ASSERT_MAXLENGTH_EQUALS", "form", "Control maxlength attribute equals the expected value"],
  ["ASSERT_PATTERN_EQUALS", "form", "Control pattern attribute equals the expected value"],

  // Attributes / presentation
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

  // Collections
  ["ASSERT_COUNT_EQUALS", "collection", "Selector matches exactly the expected number of elements"],
  ["ASSERT_COUNT_AT_LEAST", "collection", "Selector matches at least the expected number of elements"],
  ["ASSERT_COUNT_AT_MOST", "collection", "Selector matches at most the expected number of elements"],

  // URL / document
  ["ASSERT_URL_EQUALS", "location", "Current URL equals the expected URL"],
  ["ASSERT_URL_INCLUDES", "location", "Current URL includes the expected fragment"],
  ["ASSERT_URL_NOT_INCLUDES", "location", "Current URL does not include the expected fragment"],
  ["ASSERT_URL_CONTAINS", "location", "Alias of URL includes for backward compatibility"],
  ["ASSERT_PATH_EQUALS", "location", "Current pathname equals the expected path"],
  ["ASSERT_PATH_INCLUDES", "location", "Current pathname includes the expected fragment"],
  ["ASSERT_QUERY_INCLUDES", "location", "Current query string includes the expected fragment"],
  ["ASSERT_QUERY_PARAM_EQUALS", "location", "Query parameter equals the expected value"],
  ["ASSERT_QUERY_PARAM_ABSENT", "location", "Query parameter is absent"],
  ["ASSERT_HASH_EQUALS", "location", "Current URL hash equals the expected value"],
  ["ASSERT_HASH_INCLUDES", "location", "Current URL hash includes the expected fragment"],
  ["ASSERT_ORIGIN_EQUALS", "location", "Current URL origin equals the expected origin"],
  ["ASSERT_HOST_EQUALS", "location", "Current URL host equals the expected host"],
  ["ASSERT_PROTOCOL_EQUALS", "location", "Current URL protocol equals the expected protocol"],
  ["ASSERT_TITLE_EQUALS", "document", "Document title equals the expected text"],
  ["ASSERT_TITLE_INCLUDES", "document", "Document title includes the expected text"],
  ["ASSERT_DOCUMENT_LANG_EQUALS", "document", "Document language equals the expected language"],
  ["ASSERT_META_CONTENT_EQUALS", "document", "Named meta element content equals the expected value"],
  ["ASSERT_NO_HORIZONTAL_OVERFLOW", "document", "Document has no horizontal page overflow"],

  // Cookies / browser storage
  ["ASSERT_COOKIE_EXISTS", "storage", "Cookie exists"],
  ["ASSERT_COOKIE_EQUALS", "storage", "Cookie value equals the expected value"],
  ["ASSERT_COOKIE_ABSENT", "storage", "Cookie is absent"],
  ["ASSERT_LOCAL_STORAGE_EXISTS", "storage", "Local-storage key exists"],
  ["ASSERT_LOCAL_STORAGE_EQUALS", "storage", "Local-storage value equals the expected value"],
  ["ASSERT_LOCAL_STORAGE_ABSENT", "storage", "Local-storage key is absent"],
  ["ASSERT_SESSION_STORAGE_EXISTS", "storage", "Session-storage key exists"],
  ["ASSERT_SESSION_STORAGE_EQUALS", "storage", "Session-storage value equals the expected value"],
  ["ASSERT_SESSION_STORAGE_ABSENT", "storage", "Session-storage key is absent"],

  // Network / API. These are passive observers installed before browser actions.
  ["ASSERT_REQUEST_SENT", "network", "At least one matching HTTP request was sent"],
  ["ASSERT_REQUEST_COUNT_EQUALS", "network", "Exactly the expected number of matching HTTP requests were sent"],
  ["ASSERT_REQUEST_BODY_CONTAINS", "network", "Matching request body contains the expected content"],
  ["ASSERT_REQUEST_HEADER_EQUALS", "network", "Matching request header equals the expected value"],
  ["ASSERT_RESPONSE_STATUS", "network", "Matching HTTP response has the expected status code"],
  ["ASSERT_RESPONSE_BODY_CONTAINS", "network", "Matching response body contains the expected content"],
  ["ASSERT_RESPONSE_HEADER_EQUALS", "network", "Matching response header equals the expected value"],

  // Accessibility
  ["ASSERT_NO_ACCESSIBILITY_VIOLATIONS", "accessibility", "axe-core reports no accessibility violations in the requested context"],

  // Downloads / files
  ["ASSERT_FILE_EXISTS", "download", "Expected downloaded file exists"],
  ["ASSERT_FILE_CONTENT_CONTAINS", "download", "Downloaded text file contains expected content"],
  ["ASSERT_FILE_SIZE_AT_LEAST", "download", "Downloaded file size is at least the expected byte count"],

  // Browser/runtime behavior
  ["ASSERT_NO_CONSOLE_ERRORS", "browser", "No console.error calls were observed"],
  ["ASSERT_NO_UNCAUGHT_ERRORS", "browser", "No uncaught window errors were observed"],
  ["ASSERT_NO_UNHANDLED_REJECTIONS", "browser", "No unhandled promise rejections were observed"],
  ["ASSERT_WINDOW_OPEN_CALLED", "browser", "window.open was called"],
  ["ASSERT_WINDOW_OPEN_NOT_CALLED", "browser", "window.open was not called"],
  ["ASSERT_WINDOW_OPEN_URL_INCLUDES", "browser", "A window.open URL includes the expected fragment"],
  ["ASSERT_WINDOW_OPEN_COUNT_EQUALS", "browser", "window.open call count equals the expected number"],

  // Performance / responsive layout
  ["ASSERT_PAGE_LOAD_AT_MOST", "performance", "Navigation duration is at most the expected milliseconds"],
  ["ASSERT_DOM_CONTENT_LOADED_AT_MOST", "performance", "DOMContentLoaded timing is at most the expected milliseconds"],
  ["ASSERT_RESOURCE_COUNT_AT_MOST", "performance", "Loaded resource count is at most the expected number"],
  ["ASSERT_VIEWPORT_WIDTH_EQUALS", "viewport", "Viewport width equals the expected pixels"],
  ["ASSERT_VIEWPORT_HEIGHT_EQUALS", "viewport", "Viewport height equals the expected pixels"],
];

const ASSERTION_REGISTRY = Object.freeze(Object.fromEntries(
  ASSERTION_DEFINITIONS.map(([operation, category, description]) => [operation, Object.freeze({ operation, category, description })])
));
const ASSERTION_OPERATIONS = Object.freeze(Object.keys(ASSERTION_REGISTRY));
const ASSERTION_OPERATION_SET = new Set(ASSERTION_OPERATIONS);

const CAPABILITY_SUGGESTIONS = [
  {
    pattern: /\b(visual regression|pixel diff|screenshot comparison|baseline image)\b/i,
    capability: "VISUAL_REGRESSION",
    proposedOperations: ["ASSERT_VISUAL_MATCH"],
    cypressStrategy: "Add a reviewed visual-regression plugin and store approved baselines outside generated code.",
  },
  {
    pattern: /\b(web vital|largest contentful|\blcp\b|cumulative layout|\bcls\b|interaction to next paint|\binp\b)\b/i,
    capability: "WEB_VITALS",
    proposedOperations: ["ASSERT_WEB_VITAL_AT_MOST"],
    cypressStrategy: "Instrument Web Vitals before page load and compare captured metrics against configured thresholds.",
  },
  {
    pattern: /\b(email received|sms received|text message received|inbox message)\b/i,
    capability: "EXTERNAL_MESSAGE_ASSERTIONS",
    proposedOperations: ["ASSERT_EMAIL_RECEIVED", "ASSERT_SMS_RECEIVED"],
    cypressStrategy: "Use an explicit test mailbox/SMS-provider adapter; do not embed service credentials in generated specs.",
  },
  {
    pattern: /\b(database|sql row|record in database|db value)\b/i,
    capability: "DATABASE_ASSERTIONS",
    proposedOperations: ["ASSERT_DATABASE_RECORD"],
    cypressStrategy: "Use a server-side cy.task() adapter with allow-listed read-only queries; never generate raw SQL from model output.",
  },
  {
    pattern: /\b(captcha|recaptcha|hcaptcha|biometric|fingerprint|face id|touch id)\b/i,
    capability: "MANUAL_SECURITY_CHALLENGE",
    proposedOperations: [],
    cypressStrategy: "Keep the real security challenge manual or use a vendor-supported non-production bypass in a controlled test environment.",
  },
  {
    pattern: /\b(native os dialog|native file dialog|browser extension|native mobile|android app|ios app)\b/i,
    capability: "NON_WEB_AUTOMATION",
    proposedOperations: [],
    cypressStrategy: "Use a purpose-built native/mobile/extension automation adapter; Cypress remains the web runner for this branch.",
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

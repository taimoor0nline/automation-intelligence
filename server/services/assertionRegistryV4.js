const v3 = require('./assertionRegistryV3');

const ADVANCED_ASSERTION_DEFINITIONS = [
  ['ASSERT_VISUAL_MATCH', 'visual', 'Rendered element or viewport matches an approved PNG baseline within the configured pixel-diff threshold'],
  ['ASSERT_WEB_VITAL_AT_MOST', 'performance', 'Observed LCP, CLS or INP is at most the approved threshold'],
  ['ASSERT_EXTERNAL_MESSAGE_RECEIVED', 'external_message', 'Configured mailbox/SMS adapter confirms an expected email, SMS or OTP message'],
  ['ASSERT_DATABASE_VALUE_EQUALS', 'database', 'Named allow-listed read-only database query returns the expected field value'],
  ['ASSERT_DATABASE_ROW_COUNT_EQUALS', 'database', 'Named allow-listed read-only database query returns the expected row count'],
  ['ASSERT_STREAM_MESSAGE_CONTAINS', 'stream', 'Observed application WebSocket or EventSource/SSE message contains expected content'],
  ['ASSERT_CLIPBOARD_EQUALS', 'clipboard', 'Observed clipboard write equals expected text'],
  ['ASSERT_CLIPBOARD_CONTAINS', 'clipboard', 'Observed clipboard write contains expected text'],
  ['ASSERT_DOWNLOADED_DOCUMENT_CONTAINS', 'download', 'Downloaded TXT/CSV/JSON/XML/HTML/PDF/DOCX/XLS/XLSX/PPTX semantic content contains expected text'],
  ['ASSERT_BROWSER_PERMISSION_EQUALS', 'browser_permission', 'Browser permission state equals the expected granted, denied or prompt state'],
  ['ASSERT_EXTERNAL_ADAPTER', 'external_adapter', 'Configured external automation adapter confirms a capability-specific assertion'],
];

const ADVANCED_ASSERTION_REGISTRY = Object.freeze(Object.fromEntries(
  ADVANCED_ASSERTION_DEFINITIONS.map(([operation, category, description]) => [operation, Object.freeze({ operation, category, description })])
));

const ASSERTION_REGISTRY = Object.freeze({ ...v3.ASSERTION_REGISTRY, ...ADVANCED_ASSERTION_REGISTRY });
const ASSERTION_OPERATIONS = Object.freeze(Object.keys(ASSERTION_REGISTRY));
const ASSERTION_OPERATION_SET = new Set(ASSERTION_OPERATIONS);

function assertionCatalog() {
  return ASSERTION_OPERATIONS.map((operation) => ASSERTION_REGISTRY[operation]);
}

module.exports = {
  ...v3,
  ASSERTION_REGISTRY,
  ASSERTION_OPERATIONS,
  ASSERTION_OPERATION_SET,
  assertionCatalog,
  ADVANCED_ASSERTION_DEFINITIONS,
};

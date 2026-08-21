/**
 * Mock "Qwen Stage 3 – Failure Analyst"
 * Turns a raw Cypress failure into a business-readable explanation.
 * Classification values match the PDF spec exactly.
 */
function mockAnalyzeFailure({ testCase, expected, actual }) {
  const id = testCase.id;

  const KNOWN = {
    TC009: {
      summary: "Age of 17 was accepted even though the minimum allowed age is 18.",
      classification: "APPLICATION_DEFECT",
      probableCause: "The age validation boundary check appears to allow 17 instead of enforcing the 18 minimum.",
      severity: "high",
      confidence: 0.93,
    },
    TC014: {
      summary: "The website field accepted 'abc', which is not a valid URL.",
      classification: "APPLICATION_DEFECT",
      probableCause: "URL validation appears to be skipped for values that don't resemble a domain (e.g. contain no dot).",
      severity: "medium",
      confidence: 0.88,
    },
  };

  if (KNOWN[id]) {
    return {
      summary: KNOWN[id].summary,
      classification: KNOWN[id].classification,
      expected,
      actual,
      probableCause: KNOWN[id].probableCause,
      severity: KNOWN[id].severity,
      confidence: KNOWN[id].confidence,
    };
  }

  return {
    summary: `${testCase.title} did not behave as expected.`,
    classification: "UNKNOWN",
    expected,
    actual,
    probableCause: "Insufficient information to determine root cause automatically — recommend manual review.",
    severity: "medium",
    confidence: 0.4,
  };
}

module.exports = { mockAnalyzeFailure };

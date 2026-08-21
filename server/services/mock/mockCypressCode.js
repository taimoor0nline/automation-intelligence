/**
 * Mock "Qwen Stage 2 – Automation Engineer"
 * Deterministic stand-in for the real Qwen call. Produces genuine, runnable
 * Cypress code (not pseudo-code) for each approved test case, using the
 * data-testid selectors surfaced by Page Discovery — mirroring exactly what
 * the real Qwen call is instructed to do under SYSTEM_PROMPTS.PLAYWRIGHT_GENERATOR_V1.
 */

const VALID = {
  fullName: "Ahmed Khan",
  email: "ahmed@example.com",
  age: 35,
  website: "https://example.com",
  category: "service",
  contactMethod: "email",
  products: ["web"],
  rating: 8,
  subject: "Great support experience",
  feedback: "The support team resolved my issue quickly and professionally.",
};

function fillValidForm(overrides = {}, opts = {}) {
  const d = { ...VALID, ...overrides };
  const lines = [];
  const skip = opts.skip || [];

  if (!skip.includes("fullName")) lines.push(`  cy.get('[data-testid="full-name"]').type(${JSON.stringify(d.fullName)});`);
  if (!skip.includes("email")) lines.push(`  cy.get('[data-testid="email"]').type(${JSON.stringify(d.email)});`);
  if (!skip.includes("age")) lines.push(`  cy.get('[data-testid="age"]').type(${JSON.stringify(String(d.age))});`);
  if (!skip.includes("website") && d.website !== undefined) lines.push(`  cy.get('[data-testid="website"]').type(${JSON.stringify(d.website)});`);
  if (!skip.includes("category")) lines.push(`  cy.get('[data-testid="feedback-category"]').select(${JSON.stringify(d.category)});`);
  if (!skip.includes("contactMethod")) lines.push(`  cy.get('input[name="contactMethod"][value="${d.contactMethod}"]').check();`);
  if (!skip.includes("products")) (d.products || []).forEach((p) => lines.push(`  cy.get('input[name="products"][value="${p}"]').check();`));
  if (!skip.includes("rating")) lines.push(`  cy.get('[data-testid="rating"]').type(${JSON.stringify(String(d.rating))});`);
  if (!skip.includes("subject")) lines.push(`  cy.get('[data-testid="subject"]').type(${JSON.stringify(d.subject)});`);
  if (!skip.includes("feedback")) lines.push(`  cy.get('[data-testid="feedback-message"]').type(${JSON.stringify(d.feedback)});`);
  if (!skip.includes("consent")) lines.push(`  cy.get('[data-testid="consent"]').check();`);
  return lines.join("\n");
}

const SUBMIT = `  cy.get('[data-testid="submit-feedback"]').click();`;

function expectError(testId, message) {
  return `  cy.get('[data-testid="${testId}"]').should('contain.text', ${JSON.stringify(message)});`;
}
function expectNoError(testId) {
  return `  cy.get('[data-testid="${testId}"]').should('have.text', '');`;
}
function expectSuccess() {
  return [
    `  cy.get('[data-testid="success-panel"]').should('be.visible');`,
    `  cy.contains('Thank you for your feedback.').should('be.visible');`,
    `  cy.get('[data-testid="feedback-reference"]').should('contain.text', 'Feedback Reference: FB-');`,
  ].join("\n");
}

// Builds the body of one `it(...)` block for a given approved test case.
function buildTestBody(tc) {
  const nav = `  cy.visit('/feedback');`;

  switch (tc.id) {
    case "TC001":
      return [nav, fillValidForm(), SUBMIT, expectSuccess()].join("\n");
    case "TC002":
      return [nav, SUBMIT,
        expectError("full-name-error", "Full name is required."),
        expectError("email-error", "Email address is required."),
      ].join("\n");
    case "TC003":
      return [nav, fillValidForm({}, { skip: ["fullName"] }), SUBMIT, expectError("full-name-error", "Full name is required.")].join("\n");
    case "TC004":
      return [nav, fillValidForm({ fullName: "A" }), SUBMIT, expectError("full-name-error", "Full name must be between 2 and 80 characters.")].join("\n");
    case "TC005":
      return [nav, fillValidForm({}, { skip: ["email"] }), SUBMIT, expectError("email-error", "Email address is required.")].join("\n");
    case "TC006":
      return [nav, fillValidForm({ email: "abc" }), SUBMIT, expectError("email-error", "Please enter a valid email address.")].join("\n");
    case "TC007":
      return [nav, fillValidForm({ email: "abc.com" }), SUBMIT, expectError("email-error", "Please enter a valid email address.")].join("\n");
    case "TC008":
      return [nav, fillValidForm(), SUBMIT, expectNoError("email-error")].join("\n");
    case "TC009":
      return [nav, fillValidForm({ age: 17 }), SUBMIT, expectError("age-error", "Age must be between 18 and 100.")].join("\n");
    case "TC010":
      return [nav, fillValidForm({ age: 18 }), SUBMIT, expectNoError("age-error")].join("\n");
    case "TC011":
      return [nav, fillValidForm({ age: 100 }), SUBMIT, expectNoError("age-error")].join("\n");
    case "TC012":
      return [nav, fillValidForm({ age: 101 }), SUBMIT, expectError("age-error", "Age must be between 18 and 100.")].join("\n");
    case "TC013":
      return [nav, fillValidForm({}, { skip: ["website"] }), SUBMIT, expectNoError("website-error")].join("\n");
    case "TC014":
      return [nav, fillValidForm({ website: "abc" }), SUBMIT, expectError("website-error", "Please enter a valid website URL.")].join("\n");
    case "TC015":
      return [nav, fillValidForm({ website: "https://example.com" }), SUBMIT, expectNoError("website-error")].join("\n");
    case "TC016":
      return [nav, fillValidForm({}, { skip: ["category"] }), SUBMIT, expectError("category-error", "Feedback category is required.")].join("\n");
    case "TC017":
      return [nav, fillValidForm({}, { skip: ["contactMethod"] }), SUBMIT, expectError("contact-method-error", "Please select a preferred contact method.")].join("\n");
    case "TC018":
      return [nav, fillValidForm({}, { skip: ["products"] }), SUBMIT, expectError("products-error", "Please select at least one product or service.")].join("\n");
    case "TC019":
      return [nav, fillValidForm({ rating: 0 }), SUBMIT, expectError("rating-error", "Rating must be between 1 and 10.")].join("\n");
    case "TC020":
      return [nav, fillValidForm({ rating: 11 }), SUBMIT, expectError("rating-error", "Rating must be between 1 and 10.")].join("\n");
    case "TC021":
      return [nav, fillValidForm({ subject: "Bad" }), SUBMIT, expectError("subject-error", "Subject must be between 5 and 100 characters.")].join("\n");
    case "TC022":
      return [nav, fillValidForm({ feedback: "Too short" }), SUBMIT, expectError("feedback-error", "Feedback must contain at least 10 characters.")].join("\n");
    case "TC023":
      return [nav, fillValidForm({}, { skip: ["consent"] }), SUBMIT, expectError("consent-error", "You must provide consent before submitting feedback.")].join("\n");
    case "TC024":
      return [nav, fillValidForm(), `  cy.get('[data-testid="reset-form"]').click();`,
        `  cy.get('[data-testid="full-name"]').should('have.value', '');`].join("\n");
    default:
      return [nav, `  // No template mapped for ${tc.id} — manual review needed.`].join("\n");
  }
}

function mockGenerateCypressCode({ approvedTestCases, fileName }) {
  const header = `/**
 * AUTO-GENERATED by AI TestPilot (Qwen Stage 2 – Automation Engineer)
 * Feature: Customer Feedback
 * DO NOT edit by hand — regenerate via the chat pipeline instead.
 */
describe('Customer Feedback', () => {`;

  const body = approvedTestCases
    .map((tc) => `  it('${tc.id}: ${tc.title.replace(/'/g, "\\'")}', () => {\n${buildTestBody(tc)}\n  });`)
    .join("\n\n");

  const footer = `});\n`;

  const script = [header, body, footer].join("\n");

  return {
    fileName: fileName || "customer-feedback.cy.js",
    framework: "cypress",
    language: "javascript",
    script,
  };
}

module.exports = { mockGenerateCypressCode };

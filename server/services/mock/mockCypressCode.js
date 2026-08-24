/**
 * Mock "Qwen Stage 2 – Automation Engineer"
 *
 * Deterministic stand-in for the real Qwen call.
 * Produces genuine, runnable Cypress code for approved test cases.
 *
 * Login flow:
 *   /login.html
 *      ↓
 *   enter QA credentials
 *      ↓
 *   submit login
 *      ↓
 *   redirect to /feedback
 *      ↓
 *   execute feedback test
 *
 * Two code paths:
 *  - buildTemplateTestBody(): TC001-TC024 demo feedback tests
 *  - buildCustomTestBody(): generic user-added custom test cases
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
  feedback:
    "The support team resolved my issue quickly and professionally.",
};

/*
 * Demo login credentials.
 *
 * These are ONLY for the local demo application.
 * Do not use real production credentials here.
 */
const LOGIN_EMAIL = "qa@testpilot.ai";
const LOGIN_PASSWORD = "testpilot123";

/**
 * Reusable login flow.
 *
 * The generated Cypress test will:
 * 1. Open login page
 * 2. Enter email
 * 3. Enter password
 * 4. Submit login form
 * 5. Confirm that login redirected to /feedback
 */
function loginSteps() {
  return [
    "  cy.visit('/login.html');",
    `  cy.get('#email').type(${JSON.stringify(LOGIN_EMAIL)});`,
    `  cy.get('#password').type(${JSON.stringify(LOGIN_PASSWORD)});`,
    "  cy.get('#loginForm').submit();",
    "  cy.url().should('include', '/feedback');",
  ].join("\n");
}

/**
 * Fill the feedback form with valid data.
 */
function fillValidForm(overrides = {}, opts = {}) {
  const d = { ...VALID, ...overrides };
  const lines = [];
  const skip = opts.skip || [];

  if (!skip.includes("fullName")) {
    lines.push(
      `  cy.get('[data-testid="full-name"]').type(${JSON.stringify(
        d.fullName
      )});`
    );
  }

  if (!skip.includes("email")) {
    lines.push(
      `  cy.get('[data-testid="email"]').type(${JSON.stringify(d.email)});`
    );
  }

  if (!skip.includes("age")) {
    lines.push(
      `  cy.get('[data-testid="age"]').type(${JSON.stringify(
        String(d.age)
      )});`
    );
  }

  if (!skip.includes("website") && d.website !== undefined) {
    lines.push(
      `  cy.get('[data-testid="website"]').type(${JSON.stringify(
        d.website
      )});`
    );
  }

  if (!skip.includes("category")) {
    lines.push(
      `  cy.get('[data-testid="feedback-category"]').select(${JSON.stringify(
        d.category
      )});`
    );
  }

  if (!skip.includes("contactMethod")) {
    lines.push(
      `  cy.get('input[name="contactMethod"][value="${d.contactMethod}"]').check();`
    );
  }

  if (!skip.includes("products")) {
    (d.products || []).forEach((product) => {
      lines.push(
        `  cy.get('input[name="products"][value="${product}"]').check();`
      );
    });
  }

  if (!skip.includes("rating")) {
    lines.push(
      `  cy.get('[data-testid="rating"]').type(${JSON.stringify(
        String(d.rating)
      )});`
    );
  }

  if (!skip.includes("subject")) {
    lines.push(
      `  cy.get('[data-testid="subject"]').type(${JSON.stringify(
        d.subject
      )});`
    );
  }

  if (!skip.includes("feedback")) {
    lines.push(
      `  cy.get('[data-testid="feedback-message"]').type(${JSON.stringify(
        d.feedback
      )});`
    );
  }

  if (!skip.includes("consent")) {
    lines.push(`  cy.get('[data-testid="consent"]').check();`);
  }

  return lines.join("\n");
}

const SUBMIT =
  `  cy.get('[data-testid="submit-feedback"]').click();`;

/**
 * Expected validation error.
 */
function expectError(testId, message) {
  return `  cy.get('[data-testid="${testId}"]').should('contain.text', ${JSON.stringify(
    message
  )});`;
}

/**
 * Confirm no validation error.
 */
function expectNoError(testId) {
  return `  cy.get('[data-testid="${testId}"]').should('have.text', '');`;
}

/**
 * Confirm successful submission.
 */
function expectSuccess() {
  return [
    `  cy.get('[data-testid="success-panel"]').should('be.visible');`,
    `  cy.contains('Thank you for your feedback.').should('be.visible');`,
    `  cy.get('[data-testid="feedback-reference"]').should('contain.text', 'Feedback Reference: FB-');`,
  ].join("\n");
}

/**
 * Builds one hand-authored test case.
 *
 * IMPORTANT:
 * Every test starts with loginSteps().
 */
function buildTemplateTestBody(tc) {
  const nav = loginSteps();

  switch (tc.id) {
    case "TC001":
      return [
        nav,
        fillValidForm(),
        SUBMIT,
        expectSuccess(),
      ].join("\n");

    case "TC002":
      return [
        nav,
        SUBMIT,
        expectError("full-name-error", "Full name is required."),
        expectError("email-error", "Email address is required."),
      ].join("\n");

    case "TC003":
      return [
        nav,
        fillValidForm({}, { skip: ["fullName"] }),
        SUBMIT,
        expectError(
          "full-name-error",
          "Full name is required."
        ),
      ].join("\n");

    case "TC004":
      return [
        nav,
        fillValidForm({ fullName: "A" }),
        SUBMIT,
        expectError(
          "full-name-error",
          "Full name must be between 2 and 80 characters."
        ),
      ].join("\n");

    case "TC005":
      return [
        nav,
        fillValidForm({}, { skip: ["email"] }),
        SUBMIT,
        expectError(
          "email-error",
          "Email address is required."
        ),
      ].join("\n");

    case "TC006":
      return [
        nav,
        fillValidForm({ email: "abc" }),
        SUBMIT,
        expectError(
          "email-error",
          "Please enter a valid email address."
        ),
      ].join("\n");

    case "TC007":
      return [
        nav,
        fillValidForm({ email: "abc.com" }),
        SUBMIT,
        expectError(
          "email-error",
          "Please enter a valid email address."
        ),
      ].join("\n");

    case "TC008":
      return [
        nav,
        fillValidForm(),
        SUBMIT,
        expectNoError("email-error"),
      ].join("\n");

    /*
     * IMPORTANT:
     * This test is intentionally expected to FAIL because
     * the demo server has the age validation defect:
     *
     * age < 17
     *
     * instead of:
     *
     * age < 18
     */
    case "TC009":
      return [
        nav,
        fillValidForm({ age: 17 }),
        SUBMIT,
        expectError(
          "age-error",
          "Age must be between 18 and 100."
        ),
      ].join("\n");

    case "TC010":
      return [
        nav,
        fillValidForm({ age: 18 }),
        SUBMIT,
        expectNoError("age-error"),
      ].join("\n");

    case "TC011":
      return [
        nav,
        fillValidForm({ age: 100 }),
        SUBMIT,
        expectNoError("age-error"),
      ].join("\n");

    case "TC012":
      return [
        nav,
        fillValidForm({ age: 101 }),
        SUBMIT,
        expectError(
          "age-error",
          "Age must be between 18 and 100."
        ),
      ].join("\n");

    case "TC013":
      return [
        nav,
        fillValidForm({}, { skip: ["website"] }),
        SUBMIT,
        expectNoError("website-error"),
      ].join("\n");

    /*
     * IMPORTANT:
     * This test is intentionally expected to FAIL because
     * the demo server skips URL validation when there is no dot.
     */
    case "TC014":
      return [
        nav,
        fillValidForm({ website: "abc" }),
        SUBMIT,
        expectError(
          "website-error",
          "Please enter a valid website URL."
        ),
      ].join("\n");

    case "TC015":
      return [
        nav,
        fillValidForm({
          website: "https://example.com",
        }),
        SUBMIT,
        expectNoError("website-error"),
      ].join("\n");

    case "TC016":
      return [
        nav,
        fillValidForm({}, { skip: ["category"] }),
        SUBMIT,
        expectError(
          "category-error",
          "Feedback category is required."
        ),
      ].join("\n");

    case "TC017":
      return [
        nav,
        fillValidForm({}, { skip: ["contactMethod"] }),
        SUBMIT,
        expectError(
          "contact-method-error",
          "Please select a preferred contact method."
        ),
      ].join("\n");

    case "TC018":
      return [
        nav,
        fillValidForm({}, { skip: ["products"] }),
        SUBMIT,
        expectError(
          "products-error",
          "Please select at least one product or service."
        ),
      ].join("\n");

    case "TC019":
      return [
        nav,
        fillValidForm({ rating: 0 }),
        SUBMIT,
        expectError(
          "rating-error",
          "Rating must be between 1 and 10."
        ),
      ].join("\n");

    case "TC020":
      return [
        nav,
        fillValidForm({ rating: 11 }),
        SUBMIT,
        expectError(
          "rating-error",
          "Rating must be between 1 and 10."
        ),
      ].join("\n");

    case "TC021":
      return [
        nav,
        fillValidForm({ subject: "Bad" }),
        SUBMIT,
        expectError(
          "subject-error",
          "Subject must be between 5 and 100 characters."
        ),
      ].join("\n");

    case "TC022":
      return [
        nav,
        fillValidForm({ feedback: "Too short" }),
        SUBMIT,
        expectError(
          "feedback-error",
          "Feedback must contain at least 10 characters."
        ),
      ].join("\n");

    case "TC023":
      return [
        nav,
        fillValidForm({}, { skip: ["consent"] }),
        SUBMIT,
        expectError(
          "consent-error",
          "You must provide consent before submitting feedback."
        ),
      ].join("\n");

    case "TC024":
      return [
        nav,
        fillValidForm(),
        `  cy.get('[data-testid="reset-form"]').click();`,
        `  cy.get('[data-testid="full-name"]').should('have.value', '');`,
      ].join("\n");

    default:
      return [
        nav,
        `  // No template mapped for ${tc.id} — manual review needed.`,
      ].join("\n");
  }
}

/**
 * Finds a reasonable submit button selector from Page Discovery.
 */
function resolveSubmitSelector(pageDiscovery) {
  const button = (pageDiscovery?.elements || []).find(
    (el) => el.tag === "button"
  );

  if (button?.testId) {
    return `[data-testid="${button.testId}"]`;
  }

  if (button?.text) {
    return `button:contains("${button.text.replace(
      /"/g,
      '\\"'
    )}")`;
  }

  return 'button[type="submit"]';
}

/**
 * Generic generator for custom test cases.
 *
 * Supported action:
 * {
 *   fieldTestId,
 *   fieldName,
 *   type: "type" | "select" | "check" | "uncheck",
 *   value
 * }
 *
 * Supported assertion:
 * {
 *   kind: "errorVisible" | "noError" | "successVisible",
 *   targetTestId,
 *   message
 * }
 */
function buildCustomTestBody(
  tc,
  submitSelector,
  pagePath
) {
  const lines = [];

  /*
   * Login first.
   */
  lines.push(loginSteps());

  /*
   * Login redirects to /feedback.
   *
   * Only visit another path if the custom test specifically
   * targets a different page.
   */
  if (
    pagePath &&
    pagePath !== "/" &&
    pagePath !== "/feedback"
  ) {
    lines.push(
      `  cy.visit(${JSON.stringify(pagePath)});`
    );
  }

  const act = tc.action || {};

  const fieldSelector = act.fieldTestId
    ? `[data-testid="${act.fieldTestId}"]`
    : act.fieldName
    ? `[name="${act.fieldName}"]`
    : null;

  if (!fieldSelector) {
    lines.push(
      "  // No usable selector for this field — skipped. Add a data-testid or name attribute to the target field."
    );

    return lines.join("\n");
  }

  /*
   * Perform requested action.
   */
  if (act.type === "select") {
    lines.push(
      `  cy.get(${JSON.stringify(
        fieldSelector
      )}).select(${JSON.stringify(act.value ?? "")});`
    );
  } else if (act.type === "check") {
    lines.push(
      `  cy.get(${JSON.stringify(
        fieldSelector
      )}).check();`
    );
  } else if (act.type === "uncheck") {
    lines.push(
      `  cy.get(${JSON.stringify(
        fieldSelector
      )}).uncheck();`
    );
  } else {
    lines.push(
      `  cy.get(${JSON.stringify(
        fieldSelector
      )}).clear().type(${JSON.stringify(
        act.value ?? ""
      )});`
    );
  }

  /*
   * Submit.
   */
  lines.push(
    `  cy.get(${JSON.stringify(
      submitSelector
    )}).click();`
  );

  /*
   * Assertion.
   */
  const assertion = tc.assertion || {};

  const targetSelector = assertion.targetTestId
    ? `[data-testid="${assertion.targetTestId}"]`
    : null;

  if (assertion.kind === "errorVisible") {
    if (targetSelector && assertion.message) {
      lines.push(
        `  cy.get(${JSON.stringify(
          targetSelector
        )}).should('contain.text', ${JSON.stringify(
          assertion.message
        )});`
      );
    } else if (targetSelector) {
      lines.push(
        `  cy.get(${JSON.stringify(
          targetSelector
        )}).should('be.visible');`
      );
    } else if (assertion.message) {
      lines.push(
        `  cy.contains(${JSON.stringify(
          assertion.message
        )}).should('be.visible');`
      );
    } else {
      lines.push(
        "  // No assertion target/message provided for this error check."
      );
    }
  } else if (assertion.kind === "noError") {
    if (targetSelector) {
      lines.push(
        `  cy.get(${JSON.stringify(
          targetSelector
        )}).should('have.text', '');`
      );
    } else {
      lines.push(
        "  // No target element provided to confirm absence of an error."
      );
    }
  } else if (assertion.kind === "successVisible") {
    if (assertion.message) {
      lines.push(
        `  cy.contains(${JSON.stringify(
          assertion.message
        )}).should('be.visible');`
      );
    } else if (targetSelector) {
      lines.push(
        `  cy.get(${JSON.stringify(
          targetSelector
        )}).should('be.visible');`
      );
    } else {
      lines.push(
        "  // No success indicator provided to check."
      );
    }
  }

  return lines.join("\n");
}

/**
 * Select template or custom generator.
 */
function buildTestBody(
  tc,
  submitSelector,
  pagePath
) {
  if (tc.custom) {
    return buildCustomTestBody(
      tc,
      submitSelector,
      pagePath
    );
  }

  return buildTemplateTestBody(tc);
}

/**
 * Main mock Qwen Cypress generator.
 */
function mockGenerateCypressCode({
  approvedTestCases,
  pageDiscovery,
  fileName,
}) {
  const submitSelector =
    resolveSubmitSelector(pageDiscovery);

  const pagePath = (() => {
    try {
      return (
        new URL(pageDiscovery?.url).pathname ||
        "/"
      );
    } catch {
      return "/feedback";
    }
  })();

  const header = `/**
 * AUTO-GENERATED by AI TestPilot
 * Qwen Stage 2 – Automation Engineer
 *
 * Feature: Customer Feedback
 *
 * Login:
 *   qa@testpilot.ai
 *
 * This file is generated by the automation pipeline.
 * Do not edit manually.
 */

describe('Customer Feedback', () => {`;

  const body = (approvedTestCases || [])
    .map((tc) => {
      const title = String(
        tc.title || "Generated test"
      ).replace(/'/g, "\\'");

      return [
        `  it('${tc.id}: ${title}', () => {`,
        buildTestBody(
          tc,
          submitSelector,
          pagePath
        ),
        "  });",
      ].join("\n");
    })
    .join("\n\n");

  const footer = "});\n";

  const script = [
    header,
    body,
    footer,
  ].join("\n");

  return {
    fileName:
      fileName ||
      "customer-feedback.cy.js",
    framework: "cypress",
    language: "javascript",
    script,
  };
}

module.exports = {
  mockGenerateCypressCode,
};
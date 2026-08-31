const assert = require('assert');
const { buildCanonicalElementRegistry } = require('../server/services/canonicalElementRegistry');
const { normalizeBehavioralIr } = require('../server/services/canonicalBehaviorGrounding');
const { validateCanonicalIr } = require('../server/services/canonicalTestIrV3');

function element(overrides) {
  return {
    tag: 'input',
    type: 'text',
    required: false,
    disabled: false,
    formId: 'feedbackForm',
    ...overrides,
  };
}

const page = {
  url: 'http://localhost:4000/feedback',
  finalUrl: 'http://localhost:4000/feedback',
  pageTitle: 'Customer Feedback',
  elements: [
    element({ id: 'fullName', testId: 'full-name', name: 'fullName', selector: '[data-testid="full-name"]', label: 'Full Name', required: true, minlength: '2', errorElement: { id: 'fullName-error', testId: 'full-name-error', selector: '[data-testid="full-name-error"]' } }),
    element({ id: 'email', testId: 'email', name: 'email', selector: '[data-testid="email"]', label: 'Email', type: 'email', required: true, errorElement: { id: 'email-error', testId: 'email-error', selector: '[data-testid="email-error"]' } }),
    element({ id: 'age', testId: 'age', name: 'age', selector: '[data-testid="age"]', label: 'Age', type: 'number', required: true, min: '18', max: '100', errorElement: { id: 'age-error', testId: 'age-error', selector: '[data-testid="age-error"]' } }),
    element({ id: 'website', testId: 'website', name: 'website', selector: '[data-testid="website"]', label: 'Website', type: 'url', required: false, errorElement: { id: 'website-error', testId: 'website-error', selector: '[data-testid="website-error"]' } }),
    element({ id: 'category', testId: 'feedback-category', name: 'category', selector: '[data-testid="feedback-category"]', label: 'Category', tag: 'select', type: 'select', required: true, options: [{ value: '', label: 'Select' }, { value: 'product', label: 'Product' }], errorElement: { id: 'category-error', testId: 'category-error', selector: '[data-testid="category-error"]' } }),
    element({ testId: 'contact-method-email', name: 'contactMethod', groupName: 'contactMethod', groupLabel: 'Preferred Contact Method', selector: '[data-testid="contact-method-email"]', type: 'radio', required: true }),
    element({ testId: 'products-web', name: 'products', groupName: 'products', groupLabel: 'Products Used', selector: '[data-testid="products-web"]', type: 'checkbox' }),
    element({ testId: 'products-mobile', name: 'products', groupName: 'products', groupLabel: 'Products Used', selector: '[data-testid="products-mobile"]', type: 'checkbox' }),
    element({ id: 'rating', testId: 'rating', name: 'rating', selector: '[data-testid="rating"]', type: 'number', required: true, min: '1', max: '10', errorElement: { id: 'rating-error', testId: 'rating-error', selector: '[data-testid="rating-error"]' } }),
    element({ id: 'subject', testId: 'subject', name: 'subject', selector: '[data-testid="subject"]', required: true, minlength: '5', errorElement: { id: 'subject-error', testId: 'subject-error', selector: '[data-testid="subject-error"]' } }),
    element({ id: 'feedback', testId: 'feedback-message', name: 'feedback', selector: '[data-testid="feedback-message"]', tag: 'textarea', type: 'textarea', required: true, minlength: '10', errorElement: { id: 'feedback-error', testId: 'feedback-error', selector: '[data-testid="feedback-error"]' } }),
    element({ id: 'consent', testId: 'consent', name: 'consent', selector: '[data-testid="consent"]', type: 'checkbox', required: true, errorElement: { id: 'consent-error', testId: 'consent-error', selector: '[data-testid="consent-error"]' } }),
    { tag: 'button', type: 'submit', id: null, testId: 'submit-feedback', name: null, selector: '[data-testid="submit-feedback"]', text: 'Submit Feedback', formId: 'feedbackForm', disabled: false },
    { tag: 'div', type: 'div', id: 'successPanel', testId: 'success-panel', name: null, selector: '[data-testid="success-panel"]', text: 'Thank you for your feedback.', formId: null },
    { tag: 'p', type: 'p', id: 'referenceText', testId: 'feedback-reference', name: null, selector: '[data-testid="feedback-reference"]', text: '', formId: null },
  ],
  messages: [
    { tag: 'span', id: 'products-error', testId: 'products-error', selector: '[data-testid="products-error"]', text: '', formId: 'feedbackForm' },
    { tag: 'span', id: 'contactMethod-error', testId: 'contact-method-error', selector: '[data-testid="contact-method-error"]', text: '', formId: 'feedbackForm' },
  ],
};

const registry = buildCanonicalElementRegistry([page]);
assert.strictEqual(registry.version, 1, 'Form-aware registry metadata must remain backward-compatible with registry version 1.');
const byTestId = new Map(registry.elements.map((item) => [item.testId, item]));
const ref = (testId) => {
  const item = byTestId.get(testId);
  assert(item, `Missing ${testId} in registry`);
  return item.elementRef;
};

assert(byTestId.get('products-web').errorRef, 'Products group must be linked to its group-level validation error.');
assert.strictEqual(byTestId.get('products-web').errorRef, byTestId.get('products-mobile').errorRef, 'Products checkbox group should share one validation error ref.');

const successIr = {
  version: 1,
  plannedId: 'P003',
  objective: 'Verify complete feedback form submission shows success confirmation panel with reference text',
  actions: [
    { operation: 'TYPE', elementRef: ref('full-name'), value: 'Test Customer' },
    { operation: 'TYPE', elementRef: ref('email'), value: 'test@example.com' },
    { operation: 'TYPE', elementRef: ref('age'), value: '25' },
    { operation: 'SELECT', elementRef: ref('feedback-category'), value: 'product' },
    { operation: 'CHECK', elementRef: ref('contact-method-email') },
    { operation: 'TYPE', elementRef: ref('rating'), value: '5' },
    { operation: 'TYPE', elementRef: ref('subject'), value: 'Test Subject' },
    { operation: 'TYPE', elementRef: ref('feedback-message'), value: 'This is a test feedback message.' },
    { operation: 'CHECK', elementRef: ref('consent') },
    { operation: 'CLICK', elementRef: ref('submit-feedback') },
  ],
  assertions: [
    { operation: 'ASSERT_VISIBLE', elementRef: ref('success-panel') },
    { operation: 'ASSERT_VISIBLE', elementRef: ref('feedback-reference') },
  ],
};

const successGrounding = normalizeBehavioralIr(successIr, {
  registry,
  plannedUnit: { plannedId: 'P003', scenarioType: 'positive', objective: successIr.objective },
  story: 'The customer can submit feedback and sees a confirmation after successful submission.',
});
assert.strictEqual(successGrounding.unresolved.length, 0);
assert(successGrounding.ir.actions.some((item) => item.operation === 'CHECK' && item.elementRef === ref('products-web')), 'Success path must add one Products Used selection.');
assert(!successGrounding.ir.actions.some((item) => item.elementRef === ref('website')), 'Optional URL fields must remain untouched when the scenario does not require them.');
assert(successGrounding.ir.actions.findIndex((item) => item.elementRef === ref('products-web')) < successGrounding.ir.actions.findIndex((item) => item.elementRef === ref('submit-feedback')), 'Completed prerequisites must execute before submit.');

const successValidation = validateCanonicalIr(successGrounding.ir, {
  registry,
  plannedUnit: { plannedId: 'P003', scenarioType: 'positive', objective: successIr.objective },
  story: 'The customer can submit feedback and sees a confirmation after successful submission.',
  hasCredentials: true,
});
assert(successValidation.ok, successValidation.reason);

const emailIr = {
  version: 1,
  plannedId: 'P006',
  objective: 'Verify email input rejects invalid email format with appropriate error message',
  actions: [
    { operation: 'TYPE', elementRef: ref('email'), value: 'invalid-email' },
    { operation: 'BLUR', elementRef: ref('email') },
  ],
  assertions: [
    { operation: 'ASSERT_VISIBLE', elementRef: ref('email-error') },
    { operation: 'ASSERT_INVALID', elementRef: ref('email') },
    { operation: 'ASSERT_TEXT_NOT_EMPTY', elementRef: ref('email-error') },
  ],
};

const emailGrounding = normalizeBehavioralIr(emailIr, {
  registry,
  plannedUnit: { plannedId: 'P006', scenarioType: 'negative', objective: emailIr.objective },
  story: 'The feedback form must validate email format.',
});
assert.strictEqual(emailGrounding.unresolved.length, 0);
assert(emailGrounding.ir.actions.some((item) => item.operation === 'CLICK' && item.elementRef === ref('submit-feedback')), 'Unproven blur-based custom error feedback must fall back to deterministic submit validation.');
assert(emailGrounding.ir.actions.some((item) => item.operation === 'CHECK' && item.elementRef === ref('products-web')), 'Negative email validation must complete unrelated Products Used prerequisites.');
assert(!emailGrounding.ir.actions.some((item) => item.operation === 'TYPE' && item.elementRef === ref('email') && item.value !== 'invalid-email'), 'Behavioral grounding must not overwrite the invalid field under test.');
assert(!emailGrounding.ir.actions.some((item) => item.elementRef === ref('website')), 'Negative field isolation must not populate unrelated optional fields.');

const emailValidation = validateCanonicalIr(emailGrounding.ir, {
  registry,
  plannedUnit: { plannedId: 'P006', scenarioType: 'negative', objective: emailIr.objective },
  story: 'The feedback form must validate email format.',
  hasCredentials: true,
});
assert(emailValidation.ok, emailValidation.reason);

console.log('behavioral-grounding-smoke: PASS');

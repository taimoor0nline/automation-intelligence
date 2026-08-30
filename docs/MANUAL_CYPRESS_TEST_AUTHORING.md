# Manual Cypress Test Authoring

## Purpose

When a tester creates a test case manually in TestNexus, **Steps and Expected Results must be written using the supported Cypress syntax**, not as free-form human-language automation instructions.

This rule applies to manual browser test authoring. Titles, priorities and preconditions remain descriptive metadata.

TestNexus does **not** execute arbitrary pasted JavaScript. The UI parses the supported Cypress subset, verifies selectors and paths against discovery, converts the commands to TestNexus's deterministic automation contract, and then applies Automation Readiness.

## Do not write narrative automation steps

Do not write:

```text
Enter invalid age
Click submit
Validation should appear
```

Write:

```js
cy.get('[data-testid="age"]').clear().type('17')
cy.get('[data-testid="submit-feedback"]').click()
```

And write the expected result as Cypress assertions:

```js
cy.get('[data-testid="age-error"]').should('be.visible')
cy.get('[data-testid="age-error"]').should('contain.text', 'Age must be at least 18')
```

## Authoring rules

1. Use **one Cypress command per line** in Steps.
2. Use **one Cypress assertion per line** in Expected Results.
3. Use exact selectors evidenced by page discovery. Prefer stable `data-testid` selectors when the application provides them.
4. Use discovered paths only.
5. Use literal deterministic values. Do not paste loops, callbacks, arbitrary JavaScript, network scripts or custom Cypress plugins into the manual editor.
6. A manual case is still subject to deterministic grounding and Automation Readiness before execution.
7. If a selector, path or assertion is not supported/evidenced, TestNexus blocks the case rather than guessing.

## Supported navigation commands

```js
cy.visit('/feedback')
cy.reload()
cy.go('back')
cy.go('forward')
cy.viewport(1280, 720)
```

## Supported element actions

```js
cy.get('[data-testid="email"]').clear().type('qa@example.com')
cy.get('[data-testid="age"]').clear()
cy.get('[data-testid="submit-feedback"]').click()
cy.get('[data-testid="button"]').dblclick()
cy.get('[data-testid="button"]').rightclick()
cy.get('[data-testid="category"]').select('product')
cy.get('[data-testid="consent"]').check()
cy.get('[data-testid="consent"]').uncheck()
cy.get('[data-testid="email"]').focus()
cy.get('[data-testid="email"]').blur()
cy.get('[data-testid="feedback-form"]').submit()
cy.get('[data-testid="footer"]').scrollIntoView()
cy.get('[data-testid="search"]').type('{enter}')
```

For hover behavior, the supported form is:

```js
cy.get('[data-testid="menu"]').trigger('mouseover')
```

## Supported DOM and visibility assertions

```js
cy.get('[data-testid="success-panel"]').should('exist')
cy.get('[data-testid="success-panel"]').should('not.exist')
cy.get('[data-testid="success-panel"]').should('be.visible')
cy.get('[data-testid="success-panel"]').should('not.be.visible')
cy.get('[data-testid="submit-feedback"]').should('be.enabled')
cy.get('[data-testid="submit-feedback"]').should('be.disabled')
cy.get('[data-testid="consent"]').should('be.checked')
cy.get('[data-testid="consent"]').should('not.be.checked')
cy.get('[data-testid="email"]').should('be.focused')
```

## Supported value and text assertions

```js
cy.get('[data-testid="age"]').should('have.value', '17')
cy.get('[data-testid="search"]').should('contain.value', 'automation')
cy.get('[data-testid="success-panel"]').should('have.text', 'Thank you for your feedback.')
cy.get('[data-testid="success-panel"]').should('contain.text', 'Thank you')
cy.get('[data-testid="success-panel"]').should('not.contain.text', 'Error')
```

For empty form values, prefer the explicit form:

```js
cy.get('[data-testid="username"]').should('have.value', '')
```

## Supported attribute, class and CSS assertions

```js
cy.get('[data-testid="email"]').should('have.attr', 'required')
cy.get('[data-testid="website"]').should('not.have.attr', 'required')
cy.get('[data-testid="email"]').should('have.attr', 'type', 'email')
cy.get('[data-testid="status"]').should('have.class', 'active')
cy.get('[data-testid="status"]').should('not.have.class', 'disabled')
cy.get('[data-testid="panel"]').should('have.css', 'display', 'block')
cy.get('[data-testid="field"]').should('have.prop', 'disabled', 'false')
```

## Supported collection assertions

```js
cy.get('[data-testid="result-row"]').should('have.length', 3)
```

## Supported URL, path and title assertions

```js
cy.url().should('eq', 'http://localhost:4000/feedback')
cy.url().should('include', '/feedback')
cy.url().should('not.include', '/login')

cy.location('pathname').should('eq', '/feedback')
cy.location('pathname').should('include', '/feedback')

cy.title().should('eq', 'Customer Feedback')
cy.title().should('include', 'Feedback')
```

## Example: valid feedback submission

**Steps**

```js
cy.visit('/feedback')
cy.get('[data-testid="full-name"]').clear().type('Test Customer')
cy.get('[data-testid="email"]').clear().type('customer@example.com')
cy.get('[data-testid="age"]').clear().type('25')
cy.get('[data-testid="category"]').select('product')
cy.get('[data-testid="submit-feedback"]').click()
```

**Expected Results**

```js
cy.get('[data-testid="success-panel"]').should('be.visible')
cy.get('[data-testid="success-panel"]').should('contain.text', 'Thank you for your feedback.')
cy.location('pathname').should('eq', '/feedback')
```

## Example: age below minimum

**Steps**

```js
cy.visit('/feedback')
cy.get('[data-testid="age"]').clear().type('17')
cy.get('[data-testid="submit-feedback"]').click()
```

**Expected Results**

```js
cy.get('[data-testid="age-error"]').should('be.visible')
cy.get('[data-testid="age-error"]').should('contain.text', '18')
cy.get('[data-testid="success-panel"]').should('not.be.visible')
```

The exact validation text must be evidenced by the business requirement or discovered application state. Do not invent message text merely to make an assertion compile.

## What happens after Save

```text
Manual Cypress syntax
        ↓
Cypress subset parser
        ↓
Structured test actions / assertions
        ↓
Discovery grounding
        ↓
Deterministic automation contract
        ↓
Automation Readiness
        ↓
READY or BLOCKED
```

The user's Cypress syntax is authoring input. TestNexus remains responsible for selector/path grounding, assertion capability validation and deterministic execution.

## AI-generated tests

AI-generated browser tests use the Canonical Test IR architecture. Manual Cypress authoring is a user-facing adapter into the same deterministic execution philosophy; it does not replace Canonical IR for AI generation.

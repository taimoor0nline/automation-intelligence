# Deterministic Behavioral Grounding

TestNexus must distinguish **an executable script** from **a behaviorally valid test definition**.

Static discovery can prove that a control, error container or success panel exists. It does not by itself prove when an application populates that state, or which additional server-side validation prerequisites must be satisfied before a form can succeed.

## Generation pipeline

```text
Page discovery
  -> form / fieldset / validation metadata
  -> Canonical Element Registry
  -> coverage planner
  -> AI Canonical IR
  -> deterministic behavioral grounding
  -> deterministic Canonical IR validation
  -> Automation Readiness
  -> Cypress projection / execution
```

Behavioral grounding runs **before Automation Readiness** for newly generated canonical cases.

## Success-path form completion

When a generated case submits a form and expects a success/confirmation result, TestNexus checks the discovered form contract. Validation-bearing controls include:

- HTML-required controls;
- controls linked to discovered validation/error elements;
- named checkbox/radio groups linked to a group-level validation error.

If an unrelated validation-bearing control was omitted by AI, TestNexus adds a deterministic safe value before submit. Examples include a non-empty select option, one checkbox/radio selection, a bounded number, a valid email, or a valid URL.

This prevents a test from blaming the application when the test itself omitted a prerequisite that discovery could identify.

## Negative-field isolation

For a test whose purpose is to invalidate one field, the field under test is protected. TestNexus keeps that target invalid/empty while completing unrelated validation-bearing controls with deterministic valid values. This isolates the intended validation behavior.

## Validation trigger grounding

A discovered error element proves that an error surface exists. It does **not** prove that `blur`, `change`, or typing populates that error.

If the business story/objective explicitly states an interaction timing such as "on blur" or "when the field loses focus", TestNexus respects it.

Otherwise, when a generated case expects custom validation feedback and the discovered form has a submit control, TestNexus uses form submission as the deterministic validation trigger rather than inventing an on-blur behavior.

If neither an explicit timing requirement nor a deterministic submit trigger exists, the behavior is considered ungrounded and the generated case is rejected rather than marked Automation Ready.

## Existing/saved test cases

Behavioral grounding changes the Canonical IR during **fresh AI generation**. Previously reviewed cases keep the Canonical IR that was approved at the time.

After deploying a behavioral-grounding change, regenerate affected AI test cases. Re-running an old saved case does not rewrite its approved steps automatically.

## Regression

Run:

```bash
npm run test:behavioral-grounding
```

The regression covers:

- a success submission that omitted a validation-bearing checkbox group;
- a boundary-success case that requires unrelated valid prerequisites;
- an invalid-email case that incorrectly assumed custom error text was populated on blur;
- preservation of the invalid field under test while unrelated form prerequisites are completed.

The regression is also included in `npm run test:capabilities`.

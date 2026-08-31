# Behavior Rule Registry

TestNexus stores validation/business behavior as reusable rules instead of copying the same value into every generated test case.

## Storage modes

The runtime contract is identical in both modes.

### `DATABASE_ENABLED=false`

Rules are kept in the in-process application knowledge store and the current session. Manual edits and imports immediately relink affected tests and recalculate Automation Readiness. Restarting the Node process clears the in-memory application knowledge store, so use Rules export when long-lived persistence is required without PostgreSQL.

### `DATABASE_ENABLED=true`

The same rules are persisted in PostgreSQL. Run `npm run db:migrate` to apply migrations `012_behavior_rule_registry.sql` and `013_application_behavior_rules.sql`.

PostgreSQL stores:

- current application-level rules;
- rule version history;
- discovery-vs-approved conflicts;
- per-session rule snapshots;
- test-case-to-rule/version links.

## Scope inheritance

Effective rules are resolved from least specific to most specific:

1. Application
2. Page
3. Form
4. Field
5. Test case override

Within the same scope, reviewed/imported rules outrank discovery/observed/AI inference.

## Rule sources

- `DISCOVERED` — explicit DOM/HTML evidence such as `required`, `min`, `max`, `minlength`, `maxlength`, `pattern`, `type=email` and `type=url`.
- `USER_DEFINED` — manually reviewed business/application rule.
- `IMPORTED` — reviewed rule imported from Excel/CSV.
- `RUNTIME_OBSERVED` — runtime observation; never silently outranks an approved user rule.
- `AI_INFERRED` — advisory only and lowest precedence.

## Discovery drift

Discovery-owned rules update automatically when the developer changes explicit DOM constraints.

Example:

`Age min=18` -> developer changes DOM to `min=21` -> discovered `MIN_VALUE` rule becomes version 2 -> linked boundary tests recompile with 21.

Approved `USER_DEFINED` or `IMPORTED` rules are never silently overwritten. If discovery disagrees, TestNexus creates a `REVIEW_REQUIRED` conflict. The tester chooses `KEEP_APPROVED` or `ACCEPT_DISCOVERED`.

This is important when a developer accidentally changes the implementation while the approved business requirement remains unchanged.

## Manual review

After test generation, open **Rules** above the generated test-case list.

The rule screen provides:

- application/session storage mode;
- rule ID and version;
- scope;
- value;
- trigger;
- source;
- affected test cases;
- drift/conflict actions;
- manual rule creation/editing;
- discovery synchronization.

Changing a shared rule recalculates all linked test cases and Automation Readiness.

## Excel / CSV

The Rules screen can export an `.xlsx` Rules workbook. The workbook contains stable rule IDs and versions rather than Cypress code.

Columns:

- Rule ID
- Version
- Scope Type
- Scope Ref
- Page Ref
- Form Ref
- Element Ref
- Rule Type
- Value
- Trigger
- Expected State
- Error Element Ref
- Source
- Approved
- Enabled
- Notes

Importing edited rules marks them `IMPORTED`, relinks all affected tests and recalculates readiness. CSV is also supported as a simple bulk-edit fallback.

## Canonical compilation

Rules are not merely documentation. Before Canonical IR is behaviorally grounded and compiled, TestNexus applies the test's effective rules.

Currently deterministic shared-rule projection covers numeric minimum/maximum boundary tests, minimum/maximum length boundary tests and corresponding canonical metadata assertions. Rule triggers and behavioral prerequisites continue through the behavioral-grounding layer.

The automation plan records the effective rule set and applied rule references so a historical run can be traced to the rule versions used at execution time.

## APIs

- `GET /api/test-rules/catalog`
- `GET /api/test-rules/:sessionId`
- `POST /api/test-rules/:sessionId/sync-discovery`
- `POST /api/test-rules/:sessionId`
- `POST /api/test-rules/:sessionId/import`
- `POST /api/test-rules/:sessionId/conflicts/:conflictId/resolve`

## Regression

Run:

```bash
npm run test:behavior-rules
```

The broader suite also includes it:

```bash
npm run test:capabilities
```

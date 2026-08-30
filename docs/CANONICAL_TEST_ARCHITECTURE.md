# TestNexus Canonical Test Architecture

## Purpose

New AI-generated Web UI tests use a canonical intermediate representation instead of treating free-form English steps and expected results as executable truth.

```text
PAGE DISCOVERY
      |
      v
CANONICAL ELEMENT REGISTRY
      |
      v
COVERAGE PLANNER
      |
      v
STRICT PLANNED UNITS (P001, P002, ...)
      |
      v
AI CANONICAL JSON GENERATION
      |
      v
CANONICAL TEST IR
      |
      v
DETERMINISTIC SCHEMA / GROUNDING VALIDATOR
      |
      +---- READY
      |
      +---- BLOCKED (genuine contract/evidence/capability issue)
```

The browser execution engine still receives the existing deterministic automation plan. This preserves the current Cypress execution, headed browser, screenshots, live streaming, process cleanup, failure reporting and on-demand AI analysis workflows.

## 1. Canonical Element Registry

Page discovery remains authoritative for application structure. `canonicalElementRegistry.js` converts the discovery result into stable semantic references such as:

```json
{
  "elementRef": "el_age",
  "selector": "[data-testid=\"age\"]",
  "path": "/feedback",
  "type": "number",
  "label": "Age",
  "min": "18",
  "max": "100",
  "capabilities": ["TYPE", "VALIDITY", "VALUE"]
}
```

The AI model receives `elementRef` plus semantic/discovery evidence. It does **not** receive selector choice as a generation responsibility. TestNexus resolves `elementRef` back to the discovered selector deterministically.

Every registry has a SHA-256 `registryHash`. Canonical IR records which registry it was validated against.

## 2. Strict Coverage Plan

The existing coverage planner still decides the smallest evidence-supported suite. TestNexus assigns every planned unit a stable ID:

```json
{
  "plannedId": "P006",
  "category": "FUNCTIONAL",
  "scenarioType": "negative",
  "objective": "Verify malformed email input is rejected"
}
```

The planned objective is passed directly to canonical generation. A returned case must retain the exact `plannedId`. The deterministic validator also checks that discovered concepts required by the planned objective are represented by the IR. This prevents a planned email-format case from silently becoming a subject-length case.

## 3. Canonical Test IR

The AI returns structured operations, not executable English.

Example:

```json
{
  "version": 1,
  "plannedId": "P006",
  "objective": "Verify malformed email input is rejected",
  "actions": [
    { "operation": "NAVIGATE", "path": "/feedback" },
    { "operation": "TYPE", "elementRef": "el_email", "value": "invalid-email" },
    { "operation": "CLICK", "elementRef": "el_submit-feedback" }
  ],
  "assertions": [
    { "operation": "ASSERT_INVALID", "elementRef": "el_email" },
    { "operation": "ASSERT_VISIBLE", "elementRef": "err_email-error" }
  ]
}
```

Display-oriented `steps` and `expectedResults` are derived from validated IR for human review. They are not parsed back into the execution contract for canonical cases.

## 4. Runtime credentials

The model never receives configured username/password values. A negative login case can request a valid credential without knowing the secret:

```json
{
  "operation": "TYPE_RUNTIME_CREDENTIAL",
  "elementRef": "el_username",
  "credential": "username"
}
```

The deterministic runner resolves this to `TEST_USERNAME` or `TEST_PASSWORD` only at browser execution time and types it with Cypress logging disabled.

## 5. Deterministic validation

Canonical IR is rejected before Automation Readiness when it violates the contract. Examples include:

- unknown `elementRef`;
- raw CSS selector supplied by the AI instead of `elementRef`;
- undiscovered navigation path;
- `TYPE` with an empty value instead of `CLEAR`;
- a select option that was not discovered;
- unsupported action/assertion operation;
- selector/test-id identity used as display text;
- exact visible text not independently evidenced by discovery;
- planned-unit semantic drift;
- missing runtime credentials when a runtime-credential action is required.

A valid canonical IR produces the deterministic `automationPlan` directly with 100% canonical assertion coverage. The legacy English DSL remains available for existing/manual test cases.

## 6. SSE and batching

Canonical IR does not replace progressive generation. The scalable behavior remains:

- maximum configured suite up to 250 cases;
- configurable generation batch size 1-10;
- bounded concurrent AI generation workers;
- independent readiness workers;
- failed multi-case batch splitting;
- partial-suite preservation;
- 2,500-event reconnect history;
- SSE heartbeat.

Existing events remain, including `GENERATION_STARTED`, `GENERATION_PLAN`, `BATCH_STARTED`, `BATCH_COMPLETED`, `BATCH_RETRY`, `BATCH_SPLIT`, `BATCH_FAILED`, `READINESS_STARTED`, `READINESS_COMPLETED`, `READINESS_DRAINING` and `GENERATION_COMPLETED`.

Canonical architecture adds:

- `CANONICAL_REGISTRY_READY`;
- `CANONICAL_PLAN_READY`;
- `CANONICAL_IR_VALIDATED`;
- `PERSISTENCE_WARNING` when optional PostgreSQL persistence is unavailable.

With `AI_GENERATION_BATCH_SIZE=1`, a generated case immediately enters readiness while other AI workers continue generation. For 100-200-case suites, a batch size around 5 reduces provider calls while preserving progressive SSE updates between batches.

## 7. Database-disabled mode

```env
DATABASE_ENABLED=false
```

This is a first-class operating mode. The DB module is hard-gated: PostgreSQL is not loaded, no pool is created and no database network call is made. The following remain in the in-memory session:

- raw page discovery;
- canonical element registry;
- strict canonical generation plan;
- generated Canonical Test IR;
- readiness results;
- execution state/history for the running process.

This mode is appropriate for demos, ephemeral workers and deployments that do not require cross-process persistence.

## 8. PostgreSQL mode

```env
DATABASE_ENABLED=true
DATABASE_URL=postgresql://...
```

Run:

```bash
npm run db:migrate
```

Migration `011_canonical_test_architecture.sql` creates:

- `canonical_element_registries`;
- `canonical_generation_plans`;
- `canonical_test_ir`.

Canonical artifacts are persisted in addition to normal `test_sessions` / `test_cases`. They are rehydrated when a persisted session is loaded. Secrets, runtime credentials and local artifact paths are not stored as canonical artifacts.

When `DATABASE_REQUIRED=false`, a canonical persistence error emits a warning and the active in-memory test flow can continue. When `DATABASE_REQUIRED=true`, persistence failures are treated as required infrastructure failures.

## 9. Rollout compatibility

Canonical generation is enabled by default:

```env
AUTOMATION_CANONICAL_IR_ENABLED=true
```

For emergency rollout fallback only:

```env
AUTOMATION_CANONICAL_IR_ENABLED=false
```

This returns the generation endpoint to the previous scalable English-DSL route. Existing/manual reviewed cases without `canonicalIr` also continue through the legacy V13 compiler, so the migration does not require historical cases to be rewritten immediately.

## 10. Recommended scale profiles

Demo / visibly progressive:

```env
AI_TEST_CASE_COUNT=6
AI_GENERATION_BATCH_SIZE=1
AI_GENERATION_CONCURRENCY=2
READINESS_CONCURRENCY=4
```

Production starting point for a 100-200-case suite:

```env
AI_TEST_CASE_COUNT=200
AI_GENERATION_BATCH_SIZE=5
AI_GENERATION_CONCURRENCY=3
READINESS_CONCURRENCY=6
```

Both profiles use the same canonical contract, SSE endpoint, readiness validator and execution engine.

## 11. Regression command

The network-free architecture smoke test covers element refs, planner semantic drift, raw-selector rejection, empty TYPE rejection, text-identity separation, discovery-grounded text, runtime credential handling and canonical readiness:

```bash
npm run test:canonical-architecture
```

It is also included in `npm run test:capabilities`.

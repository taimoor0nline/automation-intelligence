# REST API testing

AI TestPilot supports REST API-only testing as a parallel target type to the existing web UI mode.

## Supported target setup

### Swagger / OpenAPI URL

QA can supply an OpenAPI/Swagger document URL in JSON or YAML form. The importer stores the API target and discovers operations including:

- HTTP method and path;
- operation id, summary and description;
- path/query/header parameters;
- request content types;
- request schema/example;
- declared response statuses and schemas;
- local `$ref` schema resolution for common OpenAPI/Swagger component definitions.

The base URL is taken from OpenAPI `servers`, Swagger `host/basePath`, or the specification host. A caller may explicitly override the base URL through the API when required.

### Manual REST target

QA can create a REST target with a base URL and add one or more manual operations. This supports quick single-endpoint testing without a Swagger document, while preserving the ability to grow the same target into a multi-endpoint collection.

## Test lifecycle

```text
REST target
  ├─ Swagger/OpenAPI import
  └─ Manual endpoint(s)
          ↓
Select one or many operations
          ↓
Business/API requirement
          ↓
Grounded AI REST test generation
          ↓
Human review/edit
          ↓
Deterministic REST readiness validation
          ↓
Cypress cy.request() execution
          ↓
PASS / FAIL
          ↓
Optional AI failure analysis
          ↓
Optional source-aware developer guidance
          ↓
PostgreSQL persistence
```

REST runs do not require an application page or DOM. Cypress is retained as the execution engine so web and REST testing share run reporting, failure analysis, persistence and the existing operational model.

## Deterministic REST assertions

The first REST contract supports:

- `STATUS_EQUALS`
- `HEADER_EXISTS`
- `HEADER_EQUALS`
- `JSON_PATH_EXISTS`
- `JSON_PATH_EQUALS`
- `JSON_PATH_NOT_NULL`
- `BODY_CONTAINS`
- `RESPONSE_TIME_AT_MOST`

JSON paths use simple dot notation, for example `data.customer.id` or `data.items.0.id`.

## Authentication

Current REST authentication modes:

- `NONE`
- `BEARER`
- `BASIC`
- `API_KEY_HEADER`

Only non-secret authentication configuration, such as an API-key header name, is persisted. Bearer tokens, API keys and passwords remain runtime-only and are deliberately excluded from PostgreSQL session persistence.

Generated/edited test cases are rejected by readiness validation if they attempt to store sensitive headers such as `Authorization` or `X-API-Key` directly in the test definition.

## REST workspace

After signing in as `QA` or `MANAGER`, open the **REST API** workspace from the main TestPilot platform controls, or navigate to:

```text
/rest.html
```

The workspace supports target import/creation, operation selection, source-repository selection, business requirement entry, runtime authentication, AI test generation, human JSON review/edit, deterministic execution, AI failure analysis and analytics-report access.

## Database objects

Migration `server/db/004_rest_api_testing.sql` adds:

- `api_targets`
- `api_operations`
- REST target metadata on `test_sessions`
- REST target metadata on `test_runs`

Run/test/defect facts continue to use the existing normalized `test_runs`, `test_results` and `defect_analyses` tables so future manager reporting can compare web and REST quality without separate reporting stores.

## Validation commands

After installing root dependencies and applying migrations:

```bash
npm install
npm run db:migrate
npm run test:platform
npm run test:rest
```

The REST smoke test validates manual-operation grounding, deterministic `cy.request()` generation, and runtime-secret guardrails. It does not call a live external API.

## Deferred REST capabilities

Not yet included in this phase:

- OAuth 2.0 token acquisition/refresh flows;
- request chaining and extraction of values from one response into another request;
- JSON Schema response validation;
- reusable environment/variable sets;
- pre-request/post-request hooks;
- file/multipart upload helpers;
- WebSocket, GraphQL, SOAP or gRPC execution;
- performance/load testing.

These can be added on top of the current REST target/operation/run model without changing the basic project, role, persistence or source-aware defect architecture.

# TestNexus Test Actor Directory — CSV / Excel Import

TestNexus supports importing multiple test accounts and business roles from **CSV** or **Excel `.xlsx`** files for role-based browser automation.

The actor directory is separate from the small set of actors used by one scenario:

```text
CSV / XLSX
   ↓
Test Actor Directory (up to 500 accounts)
   ↓
Select active actors (up to 12 per scenario)
   ↓
AI receives actorRef + role only
   ↓
Canonical IR uses LOGIN_AS_ACTOR
   ↓
Cypress runtime resolves the credentials privately
```

## Supported file formats

- `.csv`
- `.xlsx`

For Excel workbooks, TestNexus prefers a worksheet named **`Test Actors`**. If that sheet does not exist, the first worksheet is used.

The importer is implemented with TestNexus's own deterministic CSV/XLSX reader and does not require a third-party spreadsheet runtime package.

## Columns

| Column | Required | Purpose |
|---|---:|---|
| `actorRef` | No | Stable actor reference. If blank, TestNexus generates one from the role. |
| `role` | Yes | Business role such as Requester, Manager, Checker, Approver or Compliance. |
| `displayName` | No | Friendly account label shown in the directory. Defaults to the role. |
| `username` | Yes | Runtime login username. Never persisted in the public actor catalog. |
| `password` | Yes | Runtime login password. Never persisted in PostgreSQL/Canonical IR. |
| `description` | No | Human-readable purpose of the account. |
| `enabled` | No | `true/false`, `yes/no`, `1/0`. Defaults to `true`. |
| `active` | No | Suggests that the account should be selected for the current scenario. |

Header matching is case-insensitive and accepts common aliases such as `user`, `login`, `pass`, `notes`, `selected`, and `use`.

## Example CSV

```csv
actorRef,role,displayName,username,password,description,enabled,active
,Requester,Requester,requester.qa,ChangeMe123!,Creates requests,true,true
,Manager,Primary Manager,manager1.qa,ChangeMe123!,Reviews requests,true,true
,Manager,Backup Manager,manager2.qa,ChangeMe123!,Backup manager account,true,false
,Approver,Approver,approver.qa,ChangeMe123!,Approves requests,true,true
```

When `actorRef` is omitted, TestNexus generates stable references in import order:

```text
Requester #1 → actor_requester
Manager #1   → actor_manager
Manager #2   → actor_manager_02
Approver #1  → actor_approver
```

A manually supplied duplicate `actorRef` is rejected rather than silently remapped.

## Import workflow

Open **Test actors / roles** in the Web UI and choose **Import CSV / Excel**.

TestNexus performs a preview before applying the file. The preview shows:

- valid and invalid row counts;
- warnings;
- role/display name;
- generated `actorRef`;
- a masked username only;
- which actors are proposed for the current scenario.

Passwords are never returned in the preview response.

If invalid rows are present, correct the file or choose **Import valid rows only**.

The complete valid directory is imported, while only the checked actors become active for Canonical IR. A maximum of **12 active actors** can be exposed to one scenario, while the directory can contain up to **500 accounts**.

## Multiple accounts for the same role

Roles are not unique. A directory may contain many Manager, Checker, Customer, Agent, or Approver accounts.

Example:

```text
Manager
├── actor_manager
├── actor_manager_02
├── actor_manager_03
└── actor_manager_04
```

The user selects the account(s) relevant to the current workflow. This keeps the AI prompt small and deterministic even when the organization has hundreds of test identities.

## AI / Canonical IR behavior

The AI model never receives actor usernames or passwords.

It receives only the selected public actor catalog, for example:

```json
[
  { "actorRef": "actor_requester", "role": "Requester", "displayName": "Requester" },
  { "actorRef": "actor_manager", "role": "Manager", "displayName": "Primary Manager" },
  { "actorRef": "actor_approver", "role": "Approver", "displayName": "Approver" }
]
```

A generated role handoff uses Canonical IR:

```json
{ "operation": "LOGIN_AS_ACTOR", "actorRef": "actor_manager" }
```

The deterministic Cypress projection becomes:

```js
cy.loginAsTestActor("actor_manager")
```

The actual credentials are resolved only by the trusted Cypress runtime support layer.

## Credential security

TestNexus deliberately separates public actor metadata from credentials.

### Runtime-only

- username;
- password;
- directory credential map;
- active actor credential map.

### Safe to persist

- `actorRef`;
- role;
- display name;
- description;
- enabled flag;
- active actor references;
- source/import row metadata.

With `DATABASE_ENABLED=true`, public actor directory metadata and active selection are stored inside the existing `test_sessions.session_json` JSONB document. **No additional database migration is required.**

After PostgreSQL/session rehydration, the public directory is restored but credentials are intentionally empty. The UI/API will report **Credentials required** until the user re-imports the credential file or re-enters credentials for the active actors.

With `DATABASE_ENABLED=false`, the same directory works in session memory. A short-lived runtime actor store preserves the imported actor directory across the generation session reset.

## Generation-session handoff

The actor directory can be prepared before progressive generation chooses its final run session ID.

The Web UI carries an opaque actor-directory session handle into `/api/generation/start`. The backend copies the runtime actor state into the new generation session before reset/batching begins. Existing SSE generation, batch splitting, concurrency and progressive readiness behavior remain unchanged.

## Validation rules

The importer validates:

- required `role`;
- required `username`;
- required `password`;
- duplicate explicit `actorRef`;
- enabled/active boolean values;
- repeated usernames (warning);
- 500-directory-account limit;
- 12-active-actor limit.

Invalid rows never become runtime actor accounts unless **Import valid rows only** is explicitly selected, in which case only valid rows are imported.

## API endpoints

```text
POST /api/sessions/:sessionId/test-actor-directory/import/preview
POST /api/sessions/:sessionId/test-actor-directory/import/apply
GET  /api/sessions/:sessionId/test-actor-directory
POST /api/sessions/:sessionId/test-actor-directory/activate
GET  /api/sessions/:sessionId/test-actors
POST /api/sessions/:sessionId/test-actors
```

Actor-management writes are restricted to QA/MANAGER when platform authentication is enabled. The same APIs remain available in the supported `AUTH_REQUIRED=false` standalone/demo mode.

## Regression test

Run:

```bash
npm run test:actor-import
```

The regression creates and parses both CSV and a real in-memory XLSX ZIP workbook, verifies multiple accounts per role, checks active selection and generation-session copy behavior, and asserts that usernames/passwords never enter the safe persistence/preview payloads.

The actor-import regression is also included in:

```bash
npm run test:capabilities
```

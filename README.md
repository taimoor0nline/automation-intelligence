# AI TestPilot — Persistent Source-Aware Cypress Automation

AI TestPilot is evolving from a focused demo into a persistent QA platform while retaining the current deterministic **Cypress** execution model.

```text
Business user story
      ↓
Page discovery
      ↓
AI test-case generation
      ↓
Human QA review / approval
      ↓
Deterministic Cypress compile + execution
      ↓
PASS / FAIL + evidence
      ↓
Optional AI failure analysis
      ↓
Optional source-aware repository inspection
      ↓
Developer fix guidance + candidate files/line areas
      ↓
Optional PostgreSQL persistence + defect ownership
```

## Runtime modes

TestNexus supports two deliberate platform runtime modes. PostgreSQL is **strictly opt-in**; a `DATABASE_URL` by itself does not enable database access.

| Mode | Configuration | Core testing workflow | Persistence / rehydration | Platform users/projects/source repositories |
|---|---|---|---|---|
| Session-only / no DB | `DATABASE_ENABLED=false` | READY — rendered discovery, AI generation, human review, readiness, approval, Web/API execution, results, repair workbench, behavior rules and generated reports continue in process memory | No durable restart recovery | Not available; keep `AUTH_REQUIRED=false` |
| PostgreSQL | `DATABASE_ENABLED=true` plus `DATABASE_URL=...` | Same deterministic execution semantics as session-only mode | Sessions, tests, runs, results, canonical artifacts, behavior rules and supported metadata are persisted/rehydrated | Available; production can set `AUTH_REQUIRED=true` |

When `DATABASE_ENABLED=false`, the database module does not load `pg`, create a pool, resolve the configured database host, open a socket, or perform PostgreSQL network activity. The in-memory `sessionStore` is authoritative.

When `DATABASE_ENABLED=true`, active browser/API execution still uses the in-process session object. Persistence adds recoverability and history; it must not change test generation, approval, readiness or execution semantics.

`DATABASE_REQUIRED` only has meaning when `DATABASE_ENABLED=true`. For production, normally use both `DATABASE_ENABLED=true` and `DATABASE_REQUIRED=true`. For local/session-only development, use `DATABASE_ENABLED=false` even if a placeholder `DATABASE_URL` exists.

TestNexus platform authentication, user administration, projects and durable source-repository configuration are PostgreSQL-backed features. They are intentionally not silently emulated in session-only mode. The core testing workflow remains usable without them.

## Platform roles

The first platform roles are:

| Role | Current responsibility |
|---|---|
| `DEV` | Review assigned application defects and source-aware developer guidance; record administrative resolution after a code change. |
| `QA` | Generate/review tests, execute Cypress runs, request failure/source analysis, connect source repositories. |
| `MANAGER` | User/project administration plus QA permissions. Comparative management reporting is intentionally deferred to a later phase. |

For production use set `AUTH_REQUIRED=true` together with PostgreSQL mode. The UI stores the JWT only in browser `sessionStorage`; passwords are bcrypt-hashed in PostgreSQL.

## PostgreSQL persistence

PostgreSQL stores projects, users, memberships, source repositories, test sessions, test cases, runs, results and defect analyses when database mode is enabled. Active browser execution still uses an in-process session object, but persisted sessions can be rehydrated after a backend restart.

Sensitive runtime credentials are deliberately **not** written into `session_json`. Local artifact paths and generated report HTML are also not restored as durable secrets/state.

The schema also captures fields needed later for manager analytics without creating rankings yet:

- defect assignment and resolution ownership;
- developer/commit attribution;
- files changed and lines added/deleted;
- cyclomatic complexity;
- cognitive complexity;
- metadata for future normalized quality metrics.

A future manager comparison should not rank developers by raw bug count alone. Useful comparisons should be normalized by code ownership, delivered change volume, severity, complexity and time period.

## Source-aware failed-test analysis

A project may have one or more GitHub source repositories in PostgreSQL mode. When QA selects a repository for a run, failed `APPLICATION_DEFECT` scenarios can use bounded source evidence during the optional AI analysis stage.

The source analyzer:

1. reads the configured repository/branch server-side;
2. limits inspection to supported source-code extensions;
3. derives search terms from the approved test and observed failure;
4. scores likely source files;
5. reads only bounded candidate files/snippets;
6. supplies those bounded snippets to the AI remediation analyst;
7. stores the resulting source context with the defect analysis.

The AI output distinguishes:

- `BLACK_BOX` — no source-grounded file evidence;
- `SOURCE_SUGGESTED` — repository candidate files were found but evidence is not strong enough to call the location verified;
- `SOURCE_VERIFIED` — the named candidate/line area came from supplied repository snippets relevant to the failure.

`SOURCE_VERIFIED` still does **not** mean an AI patch has been applied or proven. The developer reviews the suggestion, changes the application, and QA re-runs the original approved test.

Private repositories require a server-side `GITHUB_SOURCE_TOKEN`. The token is never exposed to the browser. Repository code snippets used for source-aware analysis are intentionally sent to the configured AI provider, so enable this mode only for repositories whose code is permitted to be processed by that provider.

## Configuration

Copy `.env.example` to `.env`.

### Session-only / no database

This is the default development mode:

```env
DATABASE_ENABLED=false
# DATABASE_URL may be absent or may contain a placeholder; it is ignored while disabled.
DATABASE_REQUIRED=false
AUTH_REQUIRED=false
```

Start normally:

```bash
npm install
npm start
```

No database migration is required for this mode.

### PostgreSQL mode

Create a PostgreSQL database and configure:

```env
DATABASE_ENABLED=true
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ai_testpilot
DATABASE_REQUIRED=true
DATABASE_SSL=false
AUTH_REQUIRED=true
JWT_SECRET=replace-with-a-long-random-production-secret
GITHUB_SOURCE_TOKEN=
```

Then install dependencies and migrate:

```bash
npm install
npm run db:migrate
```

Install/verify the dedicated Cypress runtime as well:

```bash
cd automation-system
npm install
npm run engine:verify
cd ..
```

Start the platform and demo target:

```bash
npm start
```

```text
Demo target app: http://localhost:4000
AI TestPilot:    http://localhost:5000
```

On a fresh PostgreSQL database, enter the intended first manager email/password in the platform sign-in card and choose **Bootstrap first manager**. Bootstrap is disabled once the first user exists.

The manager can then create `DEV`, `QA`, or additional `MANAGER` users. The manager can also create a project and attach a GitHub repository from **Platform setup**. QA can select that project/repository before generating a run.

## Persistence-mode regression

Run:

```bash
npm run test:persistence-modes
```

The smoke test verifies that session-only mode remains fully database-disabled even if a `DATABASE_URL` is present, that the in-memory session store remains available, and that PostgreSQL persistence is enabled only when `DATABASE_ENABLED=true` and a connection string is configured. It deliberately does not open a real PostgreSQL connection; database connectivity/migrations remain a separate integration concern.

## Demo application

The demo target contains:

- `/` — login page;
- `/feedback` — customer feedback form.

Demo application credentials:

```text
Username: admin
Password: admin123
```

The target intentionally contains two defects for demonstration:

- age `17` is incorrectly accepted although the discovered minimum is `18`;
- website value `abc` is incorrectly accepted although a supplied website must be a valid URL.

The normal five-case demonstration therefore has three passing checks and two real application-defect detections. Failed tests remain failed until the application is corrected and the original test passes on re-run.

## Suggested business story

```text
As a customer, I should be able to log in with valid credentials and submit feedback.
Username and password are required. The feedback form must validate required fields,
email format, age boundaries, website URL format and show a confirmation after
successful submission.
```

## Deterministic automation contract

AI proposes/revises test cases, but browser execution is deterministic. Approved tests must pass the readiness compiler before execution. The runtime does not ask AI to write arbitrary executable code during the run.

`server/services/scriptValidator.js` blocks unsafe generated/runtime patterns such as `child_process`, `fs`, `eval`, `Function`, raw environment-secret access and unsupported arbitrary network modules.

The current browser runtime remains **Cypress**. Do not migrate this branch to Playwright unless the branch strategy is explicitly changed.

## Evidence and analytics

Failed cases can retain screenshot/video evidence when enabled. The HTML analytics report distinguishes automation readiness from execution outcome and includes optional AI failure analysis, developer fix guidance, and source-evidence level/candidate files when available.

In PostgreSQL mode, run/result/defect records are normalized into PostgreSQL for later reporting. In session-only mode, current-session results and generated reports remain available in memory/artifacts but are not durable across backend restarts.

## Current project layout

```text
automation-intelligence/
├── automation-system/             Cypress runtime + evidence
├── demo-app/                      Demo login/feedback target
├── testpilot-ui/
│   ├── platform-ui.js             Login, role/project/repository setup
│   └── results-analysis.js        AI + source-aware developer guidance
└── server/
    ├── db/
    │   ├── 001_platform.sql
    │   ├── index.js
    │   └── migrate.js
    ├── data/sessionStore.js
    ├── middleware/sessionPersistence.js
    ├── routes/
    │   ├── auth.js
    │   ├── projects.js
    │   ├── sessionContext.js
    │   └── run.js
    └── services/
        ├── authService.js
        ├── persistenceService.js
        ├── sourceAwareService.js
        ├── failureResolutionAiService.js
        └── requestContext.js
```

## Production security notes

For production:

- set `DATABASE_ENABLED=true`, `DATABASE_REQUIRED=true` and `AUTH_REQUIRED=true`;
- use a strong externally managed `JWT_SECRET`;
- put PostgreSQL and API secrets in a secret manager rather than source control;
- use a least-privilege GitHub token with read-only repository-content access;
- use HTTPS;
- restrict target domains / outbound network access;
- define retention/redaction rules for source snippets persisted with defect analysis;
- keep source-aware AI disabled for code that is not approved for the configured AI provider;
- treat AI remediation as advisory: no automatic defect closure or source modification from analysis output.

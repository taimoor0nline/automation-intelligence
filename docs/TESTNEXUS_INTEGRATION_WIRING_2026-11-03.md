# TestNexus — development wiring handoff (2026-11-03)

## Implemented in source
- Project-first workspace, story and task creation, attachments, project-associated teams, case inventory, project audit.
- Task and story launch into existing Cypress-based Test Studio, preserving Generate → Review → Execute.
- Project-team assignment enforcement at the API, project team member management, and global manager membership endpoints.
- Database snapshots for reviewed cases, execution reports, and AI-learning summaries. Execution and AI-learning snapshots are now persisted together in one database transaction.
- Reviewed case revisions allocated under a transaction-level advisory lock.
- Project report viewer with sandboxed HTML, and project-scoped access checks.
- Versioned PostgreSQL migration runner with checksums, locking and an explicit operator-verified baseline option.
- Session context ownership guard and deduplicated story-session association audit.
- Searchable native dropdowns in the workspace; project-origin context survives runner reload.

## Explicitly deferred
- Runtime PostgreSQL migrations, integration tests, Cypress/browser execution, security tests, and release acceptance.
- Report retention controls.
- Full verified repair-learning history and replay integration beyond the currently available session learning metadata.
- Exhaustive keyboard, screen-reader and responsive UI acceptance.

## Important integration limitations
1. The test-run record is persisted separately from its two report snapshots; the two snapshots are atomic with each other, but a failed snapshot transaction can leave a run without snapshots. The execution route logs persistence errors rather than failing a completed browser run.
2. AI-learning report data reflects explicit verified flags available in session state; it is not a full durable repair-validation pipeline.
3. Shared team membership is global. Project managers are prevented from editing membership on teams attached to multiple projects; global managers can administer them.
4. The migration baseline is an operator assertion and **does not prove schema compatibility**. Back up and inspect any existing database before applying.
5. No end-to-end execution was performed in this source-development phase. Do not mark MMP acceptance complete until validation passes.

## Migration usage
Fresh database: `npm run db:migrate`.

For a previously migrated database, identify the exact last SQL migration already applied and inspect the schema first. Only then, as an explicit one-time operation:
```powershell
$env:TESTNEXUS_MIGRATION_BASELINE="018_project_teams_audit.sql"
$env:TESTNEXUS_CONFIRM_BASELINE="I_HAVE_VERIFIED_SCHEMA"
npm run db:migrate
Remove-Item Env:TESTNEXUS_MIGRATION_BASELINE
Remove-Item Env:TESTNEXUS_CONFIRM_BASELINE
```
The filename is an example; do not use it unless migration 018 is truly installed.

## Release classification
Development wiring committed on `live-browser-streaming`. **Not production-certified.**

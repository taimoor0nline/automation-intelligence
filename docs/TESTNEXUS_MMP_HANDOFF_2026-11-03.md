# TestNexus MMP engineering handoff

**Repository:** taimoor0nline/automation-intelligence
**Integration branch:** live-browser-streaming
**Date:** 2026-11-03
**Status:** Feature implementation in progress; **NOT runtime-validated or MMP-accepted**.

## Product flow

1. Sign in and select a project in `/workspace.html`.
2. Manage project profile, environments and attachments; drag and drop documents during or after project creation.
3. Create a project business story. The backend assigns a `ST-XXXXXXXX` reference on submission.
4. Launch Test Studio using the project story, environment, target URL and project scope/rules.
5. Generate test cases, human-review selections and execute with the existing Cypress runner.
6. Inspect project reports, evidence, tasks, retests, and test inventory/audit.

Standalone testing remains supported. No second testing engine was introduced. Credentials are not saved into project story fields or embedded in URLs.

## Implemented components

| Area | Files | Notes |
|---|---|---|
| Project workspace | testpilot-ui/workspace.html, workspace.js | Project-first navigation, profile, documents, stories, task hierarchy, reports |
| Test Studio | testpilot-ui/index.html, platform-ui.js | Project handoff, simplified project-runner settings |
| Core APIs | server/routes/projectWorkspace.js, workManagement.js | Project access, stories, tasks, evidence, task-case links |
| Schema | server/db/014_project_workspace.sql through 018_project_teams_audit.sql | Workspace, evidence, links, teams, audit |
| Reusable teams | server/routes/projectWorkspace.js | Team directory, membership API, project association and project-scoped assignee list |
| Inventory | server/routes/projectWorkspace.js | Project cases, sessions, runs, story generation/execution aggregates |
| Demo data | scripts/seed-demo.js, docs/DEMO_SEED.md | Opt-in local development seed |

## New database migration

`server/db/018_project_teams_audit.sql` creates:
- `teams`, `team_members`, `project_teams`
- `story_test_sessions` for durable story-to-session associations
- `project_audit_events` for project event logging

Existing migrations must be applied in numerical order to an isolated database. **The migration runner currently re-executes migrations**; inspect and back up before rerunning against an existing populated database.

## Outstanding development and acceptance risks

- **Story/session linkage:** Schema and inventory query exist, but the runner's generation persistence must populate `story_test_sessions`. Without that, story generation/execution counts remain zero or incomplete.
- **Task launch:** Parent/child retest exists, but a task-specific Generate → Review → Run handoff must be completed.
- **Audit completeness:** Story creation is logged. Story edits, task creation, case generation, run start/completion and assignment changes are not yet consistently recorded in `project_audit_events`. Work-item history is separate.
- **Team assignment:** API lists eligible project-team members, but UI filtering and validation on all task assignment endpoints require end-to-end verification. Team membership editing UI is not yet complete.
- **Dropdowns:** Workspace search inputs were added; dropdown search behavior requires browser/accessibility testing and extension to other screens.
- **Security:** Confirm manager-only team administration, cross-project isolation, file access and review-only execution.
- **Runtime:** No access to the user's Windows PostgreSQL/Cypress environment; migrations, server boot, full E2E, screenshot/video retention and seed must be tested there.
- **Schema migration:** Verify all foreign keys against the actual deployed schema and migration order. Avoid changing primary-key types of populated tables.
- **Project creation attachments:** Verify drag/drop and upload success/partial failure behavior in the browser.

## Local acceptance sequence (PowerShell)

```powershell
git checkout live-browser-streaming
git pull origin live-browser-streaming
npm install
# Configure DATABASE_URL for an isolated nonproduction PostgreSQL database
npm run db:migrate
npm run test:server-syntax
npm run test:automation-config
npm run test:rendered-discovery
npm run start:server
```

Then verify:
1. Login with a MANAGER, QA, DEVELOPER and VIEWER account.
2. Create project with attachments; verify stored document downloads and project isolation.
3. Create multiple teams, add team members, attach two teams to a project; verify assignee filtering.
4. Create story; verify generated reference is unique and persisted.
5. Generate/review/execute a test from the project; verify session association, run count, evidence and audit.
6. Create parent/child task, link test cases, execute retest; verify task history and role boundaries.
7. Verify project inventory, per-story counts and audit entries.
8. Test keyboard navigation and searchable selects on all pages.

## Release decision

**Do not label MMP complete until the above acceptance criteria pass.** Commits on the integration branch establish code delivery, not a successful deployment or test run. The database schema and new endpoints require a migration before the new UI will work.

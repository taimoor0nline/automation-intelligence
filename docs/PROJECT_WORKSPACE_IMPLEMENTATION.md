# TestNexus Project Workspace – Developer Handoff

**Feature branch:** feature/testnexus-project-workspace-ui-v6  
**Integration target:** live-browser-streaming (merge authorized; PR #5)  
**Repository:** taimoor0nline/automation-intelligence  
**Product:** TestNexus, independent of LearnIQ

## Entry points
- /workspace.html: project workspace, scope, environments, documents, stories, tasks, workflows, team, reports.
- /: existing mature **3 phases**: Generate AI Test Cases → Review/approve → Run approved cases with the existing isolated Cypress runner.
- /live: existing live-browser streaming.
- /reports.html: existing advanced reporting.
- /work.html: legacy project work page (retained for compatibility).

UI: testpilot-ui/workspace.html, workspace.css, workspace.js. Uses Bootstrap CDN, native select chevrons (no duplicate dropdown arrows). This is a real authenticated API UI, **not** a browser-local sample-data prototype.

## Installation and migration
1. Review merged changes and prepare a staging environment before service deployment.
2. Set DATABASE_URL and the current auth/AI/Cypress configuration as documented in .env.example.
3. Back up PostgreSQL and the automation-system/artifacts directory.
4. Run npm install and npm run db:migrate. New migrations 014_project_workspace.sql, 015_story_workflow_link.sql, 016_retained_execution_evidence.sql, and 017_task_test_links.sql add project metadata, story/environment/document data, task lifecycle, workflow policies and retained evidence.
5. Run `npm run test:project-workspace` and the GitHub Actions workflow `TestNexus MMP workspace contracts` (Node route tests, isolated PostgreSQL schema and authenticated HTTP integration, Cypress fixture UI and axe-core). Run actual target-system automation in staging before opening to customers.
6. Start existing server (npm run start:server) and sign in through /. Navigate to /workspace.html using Home / Projects.
7. The new workspace has no dependency on LearnIQ.

## Existing runner preservation
The former index.html and progressive generation, approval, readiness validation, deterministic Cypress generation, isolated per-test execution, live browser, and failure analysis remain authoritative. The workspace uses sessionStorage only to carry the *selected* project, story, environment and page hints to /. This is not a second test case authoring or execution engine.

A saved project story is linked to test_sessions.project_story_id during session-context attachment. Generated cases still belong to test_sessions; test runs and results retain their existing session/run IDs and per-user attribution.

Single- and multi-task retesting uses /api/projects/:id/retest-plan for authorization/readiness then calls the existing /api/test-runs/start with selected approved case IDs. Cross-session batches execute sequentially. Persisted sessions can be restored from PostgreSQL for approved case planning and retesting; cases without a reviewed READY contract or runtime prerequisites remain blocked rather than silently running.

## Workflow policy
GET /api/projects/:id/workflow and PUT /api/projects/:id/workflow.
By default both automated options are **off**, preventing surprise task creation on existing projects. The project manager may turn on:
- Auto-create task after an actual persisted failed test result (deduplicates unresolved tasks for the same project/session/case).
- Optional named default developer (must be an active developer on the project).
- Auto-close a READY_FOR_RETEST task only after that case passes a real persisted rerun.
Task history preserves these system actions. An automated failure task is an **investigation**, not a definitive assertion that application code is defective.

## Task lifecycle and evidence
Tasks retain comments and existing assignment/status endpoints. New endpoints provide ETA, closure metadata, deferral (ON_HOLD + deferred fields), soft delete/restore, parent/subtasks, and authenticated file attachments. Deletion is not physical removal. QA/manager completion is required; developers must mark fixes READY_FOR_RETEST.

Files (project documents and task attachments) are stored in PostgreSQL BYTEA, max 5 MB per attachment, only allowlisted document/image formats. Files are served with Content-Disposition attachment and nosniff. Production deployments should consider antivirus, S3/object storage, upload quotas, lifecycle retention and operational backups.

Cypress captures screenshots and videos through the existing engine. After run persistence, accepted captures are copied to automation-system/artifacts/run-evidence/<db run ID>/, recorded in test_run_evidence and linked from test_results.evidence_json. Screenshots max 12 MB, videos max 300 MB per file. The retention folder must be backed up alongside PostgreSQL. Run artifacts consume disk; configure monitoring and a retention/cleanup policy before high-volume production use. Missing capture files or captures above limits are explicitly skipped and not shown as saved evidence. REST API tests do not inherently capture video.

## Production notes / explicit limitations
- Existing role policy still allows global QA/MANAGER to run tests. Do not enable developer execution with a UI-only toggle; the backend runtime policy must first enforce project permissions across every execution API.
- Persisted sessions can be restored for planning, but runtime secrets intentionally never persist. Runs that require credentials or missing execution prerequisites must be reconfigured in Test Studio before re-execution.
- GitHub Actions now runs isolated PostgreSQL migrations/schema checks, authenticated HTTP integration, Node route regression tests, Cypress/Electron UI contract tests and axe-core audits; inspect the latest PR checks for pass/fail status. These are **CI validation**, not a real customer-target Cypress execution or production deployment signoff.
- File storage and media retention use server disk/DB, not a dedicated object store. Security and storage capacity must be reviewed for live usage.

## Acceptance checklist
1. Log in as MANAGER, create project, set Reference No. and project start/end, save full scope profile.
2. Create multiple environments and select a default; confirm corresponding URL passes into the existing Test Studio.
3. Drag/drop project documents; confirm DB-backed metadata and authorized download; confirm cross-project isolation.
4. Create a story and acceptance criteria; select it and generate with both ordinary and progressive generation; confirm project_story_id, project_id and user attribution.
5. Review/edit generated cases; run only Automation Ready approved IDs in unchanged Cypress phases.
6. Configure project-specific failed-test task workflow; fail a case and confirm exactly one unresolved task even after repeating failure.
7. Assign developer, add comments, upload task documents and create subtasks; set ETA; defer/reopen; close with closed_at/closed_by; soft delete and restore.
8. Change task to READY_FOR_RETEST; execute one test and a batch; verify passing rerun closes task **only if workflow option enabled**.
9. Verify run history and user attribution, and retained screenshot/video evidence preview after a subsequent run; verify project/role access and backups.
10. Verify LearnIQ and unrelated SaaS products are absent from all code paths.
11. Run all existing TestNexus smoke/regression suites before PR merge.

To validate just this work: npm run test:project-workspace

## Automated acceptance
- Workflow: `.github/workflows/testnexus-workspace-contracts.yml` (runs on PR/push).
- Node workspace contracts: `node scripts/project-workspace-smoke.js` and `node --test scripts/testnexus-workspace-routes.test.js`.
- Disposable PostgreSQL: `node server/db/migrate.js`, `node scripts/testnexus-db-schema.test.js`, `node scripts/testnexus-db-integration.test.js`.
- Browser/UI: `automation-system/tests/e2e/system/testnexus-workspace-mmp.cy.js`, Cypress/Electron on static fixture server with mocked API; checks hierarchy navigation, link/unlink, appearance, WCAG axe, and mobile viewport.
- Existing repair safeguard: `.github/workflows/repair-learning.yml`.
- Remaining live acceptance: external application test execution, multi-browser/device matrix, storage monitoring/backup, deployment and user acceptance.

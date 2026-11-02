# TestNexus UI MMP — acceptance matrix (feature branch)

The UI is implemented over the existing Project Workspace and three-phase Test Studio. This document explicitly separates static verification from runtime acceptance.

| Feature | Source location | Acceptance check |
|---|---|---|
| Workspace ↔ Test Studio navigation | workspace.html, platform-ui.js | Go to Run Tests, then Home / Projects; project context remains usable |
| Shared UI tokens | workspace.css, testnexus-shared.css | Buttons, forms, typography and focus rings remain consistent |
| Loading / errors / empty views | workspace.js, workspace.html | Slow/failed requests show loading or error; empty project/task/report views explain next steps |
| Task hierarchy | workspace.js | Parent/child indentation and toggle; clicking either opens details |
| Parent/child retest | workspace.js, projectWorkspace.js | Select parent with descendants, submit only approved cases, preserve existing runner |
| Task-case links | workspace.js, projectWorkspace.js, 017 migration | Add/reload/unlink multiple task-case links, reject cross-project links, confirm task history |
| Project quality dashboard | workspace.js | Metrics match test_runs records, empty runs show no false pass rate |
| Execution timeline | workspace.js | Correct run order, tester/environment, screenshot/video opens retained evidence |
| Responsive UI | workspace.css, testnexus-shared.css | Validate 320, 375, 768, 1024 and 1440px layouts; horizontal scroll only for tables |
| Keyboard accessibility | workspace.js | Tab/Shift+Tab, Enter, Escape, focus return, visible focus on actionable elements |
| Automated accessibility | scripts/project-workspace-smoke.js | Run semantic checks and manual axe-core browser audit (WCAG 2.2 AA target) |
| Preferences | workspace.html/js/css, platform-ui.js | Light/dark/system, compact/comfortable, persistence across Workspace and Test Studio |

## Verification performed
- Repository-side JavaScript syntax and required-control assertions.
- Reviewed consistency of new IDs, API paths and UI selectors.
- Verified the PR references the intended feature branch and production target.

## Still required for production acceptance
1. Run `npm run test:project-workspace` in an actual checkout.
2. Apply database migrations 014–017 in a disposable PostgreSQL environment and verify rollback/recovery.
3. Exercise task-case linking as project manager, QA, developer and viewer and verify permissions.
4. Run existing Cypress workflow end-to-end for project, parent, child, and selected tasks; validate screenshots and videos.
5. Run browser accessibility audits using axe-core plus manual keyboard and screen-reader checks.
6. Test desktop/mobile viewport matrix and actual devices in Chrome, Edge, Firefox, and Safari where supported.
7. Resolve regressions, deploy to staging, obtain acceptance, and only then merge to `live-browser-streaming`.

Static checks do not establish browser accessibility or MMP production readiness.

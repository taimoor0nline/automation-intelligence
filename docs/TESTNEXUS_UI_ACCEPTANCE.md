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

## Verification performed in GitHub Actions
The automated MMP workflow now checks:
- Node workspace syntax and control contracts, plus permission/recovery route regression tests.
- PostgreSQL 16 migrations 001–017 in a disposable CI database, with schema/FK/uniqueness validation.
- Authenticated HTTP API integration against PostgreSQL: project isolation, task children, persistent case links, task history and retest planning.
- Cypress/Electron browser coverage with mocked backend data: parent/child navigation, linked case add/remove, display preferences, mobile width and axe-core checks across workspace views.
- The separate existing repair-learning safeguard workflow.

**The checks must be green on the exact merge head.** A checked source file or an earlier passing commit is not equivalent to current CI.

## Acceptance that remains environment-dependent
1. Stage a deployment against an actual configured TestNexus application and validate a real AI-generated, reviewed Cypress suite end to end.
2. Verify live screenshot/video capture, file delivery, historical case repair and retention after a restart.
3. Verify supported browsers/devices outside CI Electron, including screen readers and keyboard usability.
4. Back up the target PostgreSQL instance and artifacts directory; validate recovery, limits and monitoring.
5. Run user acceptance on realistic project/task datasets before commercial release.

**MMP source integration can be merged to the authorized development branch when all its CI checks pass, but this is not a claim of customer-production acceptance.**

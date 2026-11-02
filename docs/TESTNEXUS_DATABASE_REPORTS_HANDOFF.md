# TestNexus database reports — developer handoff (2026-11-03)

## Delivered
- Migration `019_report_snapshots.sql` introduces `test_report_snapshots` with `REVIEWED_CASE`, `EXECUTION`, and `AI_LEARNING` kinds.
- Saving a reviewed case writes a new revision of its public test contract. This does not store runtime login credentials.
- Completed runs save the execution summary and generated HTML, linked to `test_runs.id`; repeated completion callbacks upsert by run.
- Learning summary snapshots currently record counts/metadata only. **They do not yet persist validated repairs, failure signatures, confidence, provenance or rollback decisions.**
- `GET /api/projects/:projectId/report-snapshots?kind=EXECUTION` lists saved records; `GET /api/projects/:projectId/report-snapshots/:reportId` retrieves JSON; append `?format=html` for the saved HTML (sandboxed).
- Story session context now populates `story_test_sessions` and `project_audit_events` for project-scoped generation tracking.

## Important acceptance risks
1. Migration `018_project_teams_audit.sql` must be applied before `019_report_snapshots.sql`.
2. Run `npm run db:migrate` **only on a backed-up / disposable database** until the migration runner supports version tracking; it currently replays SQL files.
3. Review report payloads and test error messages for secrets before exposing the saved report viewer outside a trusted test environment.
4. Run a real PostgreSQL/Cypress cycle to confirm reviewed-case revisions, run report HTML, retention, project isolation and role permissions.
5. AI learning must be integrated with the existing verified repair-memory service and only store validated outcomes. Do not interpret a summary snapshot as proof of successful learning.
6. Add a UI report browser, report retention policy, and explicit case-review actor attribution; currently the database endpoints are available.

## Verification queries

```sql
SELECT report_kind, count(*) FROM test_report_snapshots GROUP BY report_kind;
SELECT session_id,run_id,report_kind,revision,created_at FROM test_report_snapshots ORDER BY created_at DESC LIMIT 25;
SELECT ps.reference_no,count(DISTINCT sts.session_id) AS sessions,count(DISTINCT tr.id) AS runs
FROM project_stories ps LEFT JOIN story_test_sessions sts ON sts.story_id=ps.id
LEFT JOIN test_runs tr ON tr.session_id=sts.session_id
GROUP BY ps.id,ps.reference_no ORDER BY ps.reference_no;
```

The JavaScript modules were syntax-checked after commit. Runtime migrations and browser acceptance were not executed in this environment.

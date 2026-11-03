# Existing demo database: incremental seed and migration guide

The original `npm run db:seed:demo` is idempotent and may be rerun after the new migrations. It now populates real `teams`, `project_teams`, and `team_members` tables as well as the original users, project, stories and tasks. Demo team names are prefixed with `TN-DEMO-001 /` so they cannot accidentally reuse unrelated global teams.

## Windows PowerShell (from repository root)

1. Back up your existing PostgreSQL database first. Keep your current `.env` with `DATABASE_ENABLED=true` and `DATABASE_URL` pointing to the **same** existing TestNexus database. Do not create a second database.
2. Check whether migration tracking already exists:
   `SELECT filename, applied_at FROM schema_migrations ORDER BY filename;`
   If the table is absent, **do not blindly baseline**. Compare your existing tables and column types with the migrations, then use the documented baseline process only for a verified existing schema.
3. Apply pending migrations (including `020` and `021`):
   ```powershell
   npm run db:migrate
   ```
4. Rerun the existing demo seeder to fill newly added team relationships, without duplicating existing demo stories/tasks:
   ```powershell
   $env:SEED_DEMO_DATA = "true"
   $env:TESTNEXUS_SEED_PASSWORD = "UseYourExistingStrongDemoPassword"
   npm run db:seed:demo
   ```
   Existing user password hashes are not overwritten by this seeder.
5. Optionally add **one unverified learning candidate** linked to the existing `TN-DEMO-001` project and its creator:
   ```powershell
   $env:TESTNEXUS_SEED_DEMO = "YES"
   npm run db:seed:repair-memory
   ```
   This command is safe to rerun. It does not create fake passing runs, verified repairs, or execution evidence.

## Existing project other than TN-DEMO-001

Specify the project and member UUIDs before the optional repair seed:
```powershell
$env:TESTNEXUS_SEED_PROJECT_ID = "existing-project-uuid"
$env:TESTNEXUS_SEED_USER_ID = "existing-active-project-member-uuid"
$env:TESTNEXUS_SEED_DEMO = "YES"
npm run db:seed:repair-memory
```

## Notes

- Never rerun `db:seed:demo` against production: it is blocked when `NODE_ENV=production`.
- Do not use `TESTNEXUS_MIGRATION_BASELINE` for a fresh database or as a workaround for a failing migration.
- Migration `021` adds cross-project foreign keys. Existing repair records with inconsistent links must be corrected before it can apply.
- Do not manually set repair records to `VERIFIED`. Promotion requires an applied event and passing execution results.
- These instructions are for operator execution; no live database was accessed or changed while authoring this guide.

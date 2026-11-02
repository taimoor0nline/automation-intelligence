# TestNexus demo seed (development only)

After migrations have completed successfully against a **dedicated nonproduction database**, seed one demonstration project, 10 sample users, project memberships, four team labels, three stories, an environment, and six sample tasks (including parent-child tasks).

This is **not** a migration: it does not run automatically with `npm run db:migrate`. It never generates completed test runs or fabricated execution evidence.

## Windows PowerShell

```powershell
git pull origin live-browser-streaming
npm install
# Set DATABASE_ENABLED=true and DATABASE_URL in .env first.
npm run db:migrate
$env:SEED_DEMO_DATA = 'true'
$env:TESTNEXUS_SEED_PASSWORD = 'ChooseYourOwnStrongDemoPassword!'
npm run db:seed:demo
Remove-Item Env:TESTNEXUS_SEED_PASSWORD
Remove-Item Env:SEED_DEMO_DATA
```

Use **your own** long temporary demo password rather than the illustrative value above. These accounts are only for development/test environments, not publicly accessible systems.

## Seeded people and memberships

| Team | Name | Email | Platform role | Project role |
| --- | --- | --- | --- | --- |
| Project Management | Muhammad Abdullah | abdullah@testnexus.io | MANAGER | PROJECT_MANAGER |
| Project Management | Ahmed Farooq | ahmed.farooq@testnexus.io | MANAGER | PROJECT_MANAGER |
| Quality Assurance | Omar Khalid | omar.khalid@testnexus.io | QA | QA |
| Quality Assurance | Yusuf Hamza | yusuf.hamza@testnexus.io | QA | QA |
| Quality Assurance | Bilal Hassan | bilal.hassan@testnexus.io | QA | QA |
| Development | Ibrahim Tariq | ibrahim.tariq@testnexus.io | DEV | DEVELOPER |
| Development | Ali Raza | ali.raza@testnexus.io | DEV | DEVELOPER |
| Development | Usman Saeed | usman.saeed@testnexus.io | DEV | DEVELOPER |
| Development | Hassan Nadeem | hassan.nadeem@testnexus.io | DEV | DEVELOPER |
| Observers | Zayd Mahmood | zayd.mahmood@testnexus.io | DEV | VIEWER |

Team labels are recorded in the demo project's `project_metadata.teams` and implemented through existing project memberships; this does not introduce duplicate teams/roles tables. Platform roles are limited to DEV, QA, MANAGER. The demo project reference is `TN-DEMO-001`; environment is Local Demo (`http://localhost:4000`).

**Rerunnable:** existing demo users keep their current password hashes and platform roles; their sample display names and demo-project roles are reconciled. Stories and tasks are keyed by the demo reference/metadata and not duplicated.

**Guardrails:** the script requires `SEED_DEMO_DATA=true`, a password of at least 12 characters, active PostgreSQL configuration, and rejects `NODE_ENV=production`. It uses a database transaction so failures roll back. Never run against customer data.

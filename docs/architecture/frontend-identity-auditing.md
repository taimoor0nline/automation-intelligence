# Frontend, Identity and Auditing Decisions

Status: Accepted for `dotnet-playwright-clean-architecture`.

## Frontend

The Community product frontend target is **Next.js + TypeScript**.

- Next.js is the presentation layer only.
- Business rules, test orchestration, persistence, AI provider logic and Playwright execution remain in the .NET backend.
- The browser app consumes ASP.NET Core REST APIs and SignalR endpoints.
- The inherited `testpilot-ui` static HTML/JavaScript implementation is a legacy/live-demo reference and may be removed after Next.js feature parity is reached.
- Do not introduce a second Node.js backend through Next.js API routes for core application features.

Suggested target layout:

```text
web/
  package.json
  src/
    app/
    components/
    features/
    lib/api/
    lib/signalr/
```

## Identity model

Do not attach a single `WorkspaceId` directly to `UserAccount`, because future hosted users may participate in multiple workspaces.

Use:

```text
UserAccount
   |
   +-- WorkspaceMembership -- Workspace
                    |
                    +-- WorkspaceAdmin
                    +-- TestManager
                    +-- Tester
                    +-- Viewer
```

Community V1 may seed one local administrator and one LOCAL workspace membership. There is no platform/SaaS administrator in this phase.

Future hosted identity providers can map external subject identifiers into `UserAccount` without changing business aggregates.

## Audit fields

Every persisted business entity must carry, at minimum:

- `CreatedAtUtc`
- `CreatedByUserId`
- `UpdatedAtUtc`
- `UpdatedByUserId`

Use UTC only (`DateTimeOffset` in .NET and PostgreSQL `timestamptz`).

Lifecycle-specific timestamps remain separate when they have business meaning, for example:

- `ApprovedAtUtc`, `ApprovedByUserId`
- `StartedAtUtc`
- `CompletedAtUtc`
- `ArchivedAtUtc`, `ArchivedByUserId`
- `LastLoginAtUtc`

Test runs must additionally snapshot execution context that can change later, including the selected environment and starting URL.

## Audit stamping

Audit actors must come from server-side context:

```text
Authenticated request / Community local user
        |
        +-- ICurrentUserContext
        |
        +-- IWorkspaceContext
        |
        +-- Application command/query
        |
        +-- EF Core SaveChanges audit interceptor
```

Clients must not be trusted to submit arbitrary `CreatedByUserId`, `UpdatedByUserId` or `WorkspaceId` values.

For system-created seed/background records, use an explicit seeded SYSTEM user identity rather than an unknown actor where practical.

## Datewise history

Creation/update timestamps alone are not enough for meaningful history. Business workflows should also record immutable activity/audit events for important changes, for example:

- project registered or archived
- environment created/changed
- requirement created/edited
- acceptance criterion generated/approved/rejected
- test case generated/edited/approved
- test run requested/started/completed/cancelled
- AI analysis generated

A future `audit_events` table should include:

- `Id`
- `WorkspaceId`
- `UserId`
- `OccurredAtUtc`
- `EntityType`
- `EntityId`
- `Action`
- `Summary`
- optional structured `Metadata` JSONB

This gives the UI reliable day-by-day activity history without relying on mutable row timestamps.

## Open-source status

The Community branch is licensed under Apache License 2.0 through the repository root `LICENSE` file. Future hosted/enterprise services and proprietary modules can be maintained separately without changing the Community license.

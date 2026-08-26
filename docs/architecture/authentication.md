# Authentication and Workspace Membership

Status: Accepted for `dotnet-playwright-clean-architecture`.

## Community authentication

Use ASP.NET Core Identity in `AITestPilot.Infrastructure` with PostgreSQL persistence.

Do not implement password hashing, password reset tokens, lockout, email confirmation or external-login protocol logic in the Domain project.

The application-facing abstraction is `ICurrentUserContext`.

## User versus workspace membership

Authentication users are global identities. Workspace authorization is modeled separately in the Domain:

```text
ASP.NET Core Identity User
          |
          | UserId
          v
WorkspaceMembership
          |
          +-- WorkspaceId
          +-- WorkspaceRole
```

This allows the same future hosted identity to participate in multiple workspaces without changing the user table or business aggregates.

Community V1 seeds:

- one non-interactive SYSTEM identity for background/seed audit attribution;
- one local Community administrator identity;
- one LOCAL workspace;
- one `WorkspaceAdmin` membership connecting the administrator to the LOCAL workspace.

There is no platform administrator or cross-tenant administration in Community V1.

## Initial workspace roles

- `WorkspaceAdmin`
- `TestManager`
- `Tester`
- `Viewer`

These are workspace roles, not SaaS/platform roles.

## Audit actor rules

For normal API operations:

```text
ASP.NET authentication
    -> ICurrentUserContext.UserId
    -> validate WorkspaceMembership
    -> IWorkspaceContext.WorkspaceId
    -> command/query handler
    -> EF Core audit stamping
```

Business APIs must ignore/reject client attempts to override audit actor or workspace scope.

For background operations, use the initiating user where the action is still attributable to that user. Use the SYSTEM identity only for genuinely system-originated work.

## Timestamps

All application and identity timestamps are UTC. Persist as PostgreSQL `timestamptz` and expose ISO-8601 UTC values from the API. Next.js may render them in the user's selected/local timezone while retaining UTC for filtering and reporting.

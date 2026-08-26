# AI TestPilot Community — .NET + Playwright Architecture

## Status

Accepted for the `dotnet-playwright-clean-architecture` branch.

## Goal

Build the Community edition as an open-source, self-hosted AI test intelligence platform using ASP.NET Core, PostgreSQL and Microsoft Playwright. The architecture must be ready for a future hosted SaaS control plane without implementing SaaS administration, billing or platform-tenant management in this phase.

## Core decisions

- Runtime: .NET 10 / ASP.NET Core
- Database: PostgreSQL via EF Core + Npgsql
- Browser automation: Microsoft.Playwright for .NET
- Frontend: preserve the existing web UI initially; migrate only where useful
- Architecture: Clean Architecture + modular monolith
- Application style: pragmatic CQRS (Commands and Queries separated by use case)
- No event sourcing in Community V1
- No microservices in Community V1
- Background execution: .NET Worker Service
- Real-time execution state: SignalR
- AI providers: provider abstraction; Qwen/OpenAI-compatible first, local providers later
- Test representation: engine-neutral AI Test Definition persisted in PostgreSQL
- Workspace: all business data is workspace scoped from day one
- Community V1: one seeded local workspace; no SaaS/platform administration UI

## Product boundary

Playwright is an execution engine, not the product data model. AI TestPilot owns requirements, acceptance criteria, test cases, execution strategy, evidence, failure classification and reporting.

```text
Requirement
   -> Acceptance Criteria
   -> Test Cases
   -> Approved AI Test Definition
   -> Playwright Execution
   -> Evidence / Results
   -> AI Analysis
```

## Proposed solution structure

```text
AITestPilot.sln

src/
  AITestPilot.Api/
  AITestPilot.Domain/
  AITestPilot.Application/
  AITestPilot.Infrastructure/
  AITestPilot.Playwright/
  AITestPilot.AI/
  AITestPilot.Worker/
  AITestPilot.Contracts/

tests/
  AITestPilot.Domain.Tests/
  AITestPilot.Application.Tests/
  AITestPilot.IntegrationTests/
  AITestPilot.Playwright.Tests/

ui/
  existing UI initially

docs/
  architecture/
```

### Dependency rule

```text
Domain
  ^
  |
Application
  ^
  |
Infrastructure / Playwright / AI
  ^
  |
Api / Worker
```

The Domain project must not depend on EF Core, Playwright, HTTP clients, PostgreSQL or any external provider.

## SOLID rules

### Single Responsibility

- `Project` manages project invariants only.
- `ProjectEnvironment` manages environment configuration only.
- AI providers only generate/interpret AI responses.
- Playwright executor only executes approved test definitions.
- Artifact storage is independent from test execution.

### Open/Closed

Use abstractions for extension points:

- `IAiProvider`
- `ITestExecutionEngine`
- `IArtifactStore`
- `IProjectRepository`
- `ITestRunRepository`
- `IWorkspaceContext`
- `IExecutionQueue`

New AI providers or future hosted execution providers should be added without changing domain behavior.

### Liskov / Interface Segregation

Prefer narrow interfaces per capability instead of large service interfaces.

### Dependency Inversion

Application depends on interfaces; Infrastructure provides implementations.

## CQRS strategy

Use CQRS at the application-use-case level, not as event sourcing.

Examples:

```text
Commands
  RegisterProjectCommand
  UpdateProjectCommand
  AddProjectEnvironmentCommand
  UpdateProjectEnvironmentCommand
  CreateRequirementCommand
  GenerateAcceptanceCriteriaCommand
  ApproveAcceptanceCriteriaCommand
  GenerateTestCasesCommand
  ApproveTestCaseCommand
  StartTestRunCommand
  CancelTestRunCommand

Queries
  GetProjectByIdQuery
  SearchProjectsQuery
  GetProjectEnvironmentsQuery
  GetRequirementDetailsQuery
  GetTestCasesQuery
  GetTestRunDetailsQuery
  GetTestRunHistoryQuery
```

Handlers should be thin application orchestration. Business rules belong in domain entities/value objects where appropriate.

Do not introduce a separate read database in Community V1. Commands and queries can use the same PostgreSQL database with separate application models.

## Workspace strategy

Every business aggregate that belongs to a customer/workspace must carry `WorkspaceId`.

Community V1 seeds one workspace, for example:

```text
WorkspaceId: 00000000-0000-0000-0000-000000000001
Code: LOCAL
Name: Local Community Workspace
```

The UI does not expose platform/tenant administration in Community V1.

All queries and commands receive workspace scope from `IWorkspaceContext`; clients must not be allowed to bypass workspace filtering by simply supplying another WorkspaceId.

Future hosted SaaS can replace the local workspace resolver with authenticated tenant/workspace resolution.

## Domain model

### Workspace

Fields:

- `Id` (UUID)
- `Code`
- `Name`
- `Status`
- `CreatedAtUtc`
- `UpdatedAtUtc`

Community V1 uses only the seeded LOCAL workspace.

### ProjectCategory

Purpose: classify projects/applications under test.

Fields:

- `Id` (UUID)
- `WorkspaceId`
- `Name`
- `Code`
- `Description`
- `IsActive`
- `SortOrder`
- `CreatedAtUtc`
- `UpdatedAtUtc`

Suggested seeded categories:

- Web Application
- API / Backend Service
- Enterprise Portal
- E-Commerce
- Banking / Financial Application
- Internal Business Application
- Public Website
- Other

Categories are workspace-scoped so hosted customers can customize them later.

### Project

Purpose: register one system/application under test.

Fields:

- `Id` (UUID)
- `WorkspaceId`
- `ProjectCategoryId`
- `Name`
- `Code` / `Slug`
- `ShortDescription`
- `DetailedDescription`
- `ApplicationType`
- `TechnologyStack` (optional JSONB metadata)
- `RepositoryUrl` (optional)
- `DefaultBranch` (optional)
- `BusinessOwner` (optional text in Community V1)
- `TechnicalOwner` (optional text in Community V1)
- `Status` (`Draft`, `Active`, `Archived`)
- `CreatedAtUtc`
- `UpdatedAtUtc`

Do not put an environment URL directly on Project. URLs belong to `ProjectEnvironment`.

### ProjectEnvironment

Purpose: define where a project is tested.

Fields:

- `Id` (UUID)
- `WorkspaceId`
- `ProjectId`
- `Name` (Development, QA, SIT, UAT, Staging, Production, Custom)
- `EnvironmentType`
- `StartingUrl`
- `ApiBaseUrl` (optional)
- `HealthCheckUrl` (optional)
- `Description`
- `IsDefault`
- `IsActive`
- `Configuration` (JSONB for non-secret environment metadata)
- `CreatedAtUtc`
- `UpdatedAtUtc`

Rules:

- Starting URL must be absolute HTTP/HTTPS.
- Only one default active environment per project.
- A TestRun must target a specific `ProjectEnvironmentId`.
- Environment configuration must not store plaintext passwords/API keys.

### Requirement

Fields:

- `Id`
- `WorkspaceId`
- `ProjectId`
- `Title`
- `StoryText`
- `SourceType`
- `Status`
- `CreatedAtUtc`
- `UpdatedAtUtc`

### AcceptanceCriterion

Fields:

- `Id`
- `WorkspaceId`
- `RequirementId`
- `Sequence`
- `Text`
- `Priority`
- `Status` (`Generated`, `Edited`, `Approved`, `Rejected`)
- `AiGenerated`
- `ApprovedAtUtc`

### TestCase

Fields:

- `Id`
- `WorkspaceId`
- `ProjectId`
- `RequirementId` (nullable when manually created)
- `TestCaseNumber`
- `Title`
- `Description`
- `Priority`
- `TestType`
- `Status`
- `Definition` (JSONB, engine-neutral)
- `DefinitionVersion`
- `AiGenerated`
- `ApprovedAtUtc`
- `CreatedAtUtc`
- `UpdatedAtUtc`

### TestRun

Fields:

- `Id`
- `WorkspaceId`
- `ProjectId`
- `ProjectEnvironmentId`
- `RunNumber`
- `Status`
- `RequestedBy`
- `ExecutionEngine`
- `StartingUrlSnapshot`
- `StartedAtUtc`
- `CompletedAtUtc`
- `CreatedAtUtc`

`StartingUrlSnapshot` preserves what URL was actually used even if the environment is later edited.

### TestResult

Fields:

- `Id`
- `WorkspaceId`
- `TestRunId`
- `TestCaseId`
- `Status`
- `DurationMs`
- `FailureType`
- `FailureMessage`
- `ObservedResult`
- `AiClassification`
- `AiConfidence`
- `StartedAtUtc`
- `CompletedAtUtc`

### TestArtifact

Fields:

- `Id`
- `WorkspaceId`
- `TestRunId`
- `TestResultId` (nullable for run-level artifact)
- `ArtifactType` (`Screenshot`, `Video`, `Trace`, `Log`, `Network`, `Other`)
- `StorageProvider`
- `StoragePath`
- `ContentType`
- `SizeBytes`
- `CreatedAtUtc`

Local Community implementation uses filesystem storage. Future hosted implementation can use object storage.

## Engine-neutral test definition

AI-generated test cases must be persisted as an internal definition, not only as generated Playwright source code.

Example:

```json
{
  "version": 1,
  "steps": [
    {
      "action": "navigate",
      "target": "/feedback"
    },
    {
      "action": "fill",
      "locator": {
        "strategy": "label",
        "value": "Age"
      },
      "value": "101"
    },
    {
      "action": "click",
      "locator": {
        "strategy": "role",
        "role": "button",
        "name": "Submit"
      }
    }
  ],
  "assertions": [
    {
      "type": "visible",
      "locator": {
        "strategy": "text",
        "value": "Age must be between 18 and 100"
      }
    }
  ]
}
```

This definition is interpreted by the Playwright execution module.

## Playwright execution design

`AITestPilot.Playwright` owns:

- browser lifecycle
- browser-context lifecycle
- locator resolution
- step execution
- assertion execution
- screenshots
- video
- traces
- network evidence
- console evidence
- execution events

The Application layer depends only on `ITestExecutionEngine`.

Suggested interface:

```csharp
public interface ITestExecutionEngine
{
    Task<ExecutionResult> ExecuteAsync(
        ExecutionRequest request,
        CancellationToken cancellationToken);
}
```

## Worker design

Do not execute long-running Playwright tests inside HTTP request threads.

```text
POST /api/test-runs
    -> validate project/environment/tests
    -> create TestRun
    -> enqueue RunId
    -> return 202 Accepted

AITestPilot.Worker
    -> dequeue RunId
    -> execute tests
    -> persist results/artifacts
    -> publish progress events

SignalR
    -> UI receives live run/test/step status
```

Community V1 can use an in-process/channel-backed queue plus a single Worker deployment. The abstraction must allow a future distributed queue.

## Environment selection workflow

A user starts from a registered project:

```text
Project
  -> Select Environment
       Development
       QA
       UAT
       Staging
       Production
  -> Starting URL is resolved from the selected environment
  -> Select approved tests
  -> Start Test Run
```

The selected environment is mandatory for execution.

## API outline

### Project categories

- `GET /api/project-categories`
- `POST /api/project-categories`
- `PUT /api/project-categories/{id}`

### Projects

- `GET /api/projects`
- `GET /api/projects/{id}`
- `POST /api/projects`
- `PUT /api/projects/{id}`
- `POST /api/projects/{id}/archive`

### Environments

- `GET /api/projects/{projectId}/environments`
- `POST /api/projects/{projectId}/environments`
- `PUT /api/projects/{projectId}/environments/{environmentId}`
- `POST /api/projects/{projectId}/environments/{environmentId}/set-default`

### Requirements / testing

- `POST /api/projects/{projectId}/requirements`
- `POST /api/requirements/{id}/generate-acceptance-criteria`
- `POST /api/requirements/{id}/generate-test-cases`
- `POST /api/test-cases/{id}/approve`

### Runs

- `POST /api/projects/{projectId}/test-runs`
- `GET /api/test-runs/{id}`
- `GET /api/projects/{projectId}/test-runs`
- `POST /api/test-runs/{id}/cancel`

## PostgreSQL conventions

- UUID primary keys
- UTC timestamps only
- snake_case database naming
- optimistic concurrency where mutable aggregates need it
- unique constraints scoped by WorkspaceId
- JSONB only for genuinely flexible metadata/definitions
- relational columns for searchable/reportable business fields
- indexes begin with WorkspaceId for workspace-owned high-volume tables where appropriate

Example uniqueness:

```text
UNIQUE (workspace_id, project_code)
UNIQUE (workspace_id, project_category_code)
UNIQUE (workspace_id, project_id, environment_name)
```

## SaaS-ready but not SaaS-built

Build now:

- WorkspaceId on owned data
- `IWorkspaceContext`
- workspace-scoped query filters/repositories
- provider abstractions
- artifact storage abstraction
- execution queue abstraction
- external identity-ready API boundary

Do not build now:

- platform admin portal
- tenant provisioning UI
- billing/subscriptions
- plans/quotas
- cross-tenant administration
- customer onboarding automation
- tenant-specific domains
- distributed cloud runner fleet

## Security baseline

- secrets never stored in plaintext project/environment metadata
- future secret-provider abstraction (`ISecretProvider`)
- authorization checks in application/API layer
- workspace scoping is server-enforced
- prevent arbitrary local file path execution from user input
- validate target URLs before browser execution
- record audit-friendly timestamps and actor identifiers even in Community V1

## Initial implementation milestones

### Milestone 1 — .NET foundation

- create solution/projects
- PostgreSQL connectivity
- EF Core migrations
- LOCAL workspace seed
- project category CRUD
- project CRUD
- project environment CRUD
- OpenAPI

### Milestone 2 — requirement/test model

- requirement CRUD
- acceptance criteria persistence
- test case persistence
- engine-neutral test definition
- approval state

### Milestone 3 — Playwright runner

- `ITestExecutionEngine`
- Chromium first
- headed/headless execution
- screenshots
- traces
- result persistence
- Worker execution
- SignalR progress

### Milestone 4 — AI integration

- `IAiProvider`
- Qwen/OpenAI-compatible provider
- story -> acceptance criteria
- acceptance criteria -> test cases
- test case -> executable definition
- structured response validation

### Milestone 5 — live demo parity

- login flow
- dashboard flow
- feedback form flow
- validations
- live browser view
- pass/fail evidence
- AI failure explanation

### Milestone 6 — Community hardening

- setup documentation
- PostgreSQL local deployment
- configuration validation
- test coverage
- security review
- license/readme/community packaging

## Non-goals for the first branch iteration

- Cypress compatibility
- hosted SaaS
- enterprise RBAC/SSO
- billing
- microservices
- Kafka/RabbitMQ unless proven necessary
- event sourcing
- Kubernetes requirement
- multi-region execution

## Architecture principle

Prefer a simple modular monolith with strong boundaries over distributed complexity. Use CQRS where it improves use-case clarity; do not introduce infrastructure simply because a pattern permits it.

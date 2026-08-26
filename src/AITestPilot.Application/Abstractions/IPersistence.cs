using AITestPilot.Domain.Projects;
using AITestPilot.Domain.Testing;

namespace AITestPilot.Application.Abstractions;

public interface IUnitOfWork
{
    Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);
}

public interface IProjectCategoryRepository
{
    Task<ProjectCategory?> GetByIdAsync(Guid workspaceId, Guid id, CancellationToken cancellationToken);
    Task<IReadOnlyList<ProjectCategory>> ListAsync(Guid workspaceId, CancellationToken cancellationToken);
    Task AddAsync(ProjectCategory category, CancellationToken cancellationToken);
}

public interface IProjectEnvironmentRepository
{
    Task<ProjectEnvironment?> GetByIdAsync(Guid workspaceId, Guid projectId, Guid environmentId, CancellationToken cancellationToken);
    Task<IReadOnlyList<ProjectEnvironment>> ListAsync(Guid workspaceId, Guid projectId, CancellationToken cancellationToken);
    Task<bool> NameExistsAsync(Guid workspaceId, Guid projectId, string name, CancellationToken cancellationToken);
    Task ClearDefaultAsync(Guid workspaceId, Guid projectId, CancellationToken cancellationToken);
    Task AddAsync(ProjectEnvironment environment, CancellationToken cancellationToken);
}

public interface ITestCaseRepository
{
    Task<TestCase?> GetByIdAsync(Guid workspaceId, Guid projectId, Guid testCaseId, CancellationToken cancellationToken);
    Task<IReadOnlyList<TestCase>> GetApprovedByIdsAsync(Guid workspaceId, Guid projectId, IReadOnlyCollection<Guid> ids, CancellationToken cancellationToken);
    Task<IReadOnlyList<TestCase>> ListAsync(Guid workspaceId, Guid projectId, CancellationToken cancellationToken);
    Task AddAsync(TestCase testCase, CancellationToken cancellationToken);
}

public interface ITestRunRepository
{
    Task<TestRun?> GetByIdAsync(Guid workspaceId, Guid testRunId, CancellationToken cancellationToken);
    Task<IReadOnlyList<TestRun>> ListAsync(Guid workspaceId, Guid projectId, CancellationToken cancellationToken);
    Task AddAsync(TestRun testRun, IReadOnlyCollection<TestRunCase> runCases, CancellationToken cancellationToken);
}

public interface ITestRunExecutionStore
{
    Task<TestExecutionRequest?> LoadExecutionRequestAsync(Guid workspaceId, Guid testRunId, CancellationToken cancellationToken);
    Task MarkStartedAsync(Guid workspaceId, Guid testRunId, CancellationToken cancellationToken);
    Task SaveExecutionResultAsync(Guid workspaceId, TestExecutionResult result, CancellationToken cancellationToken);
    Task MarkInfrastructureErrorAsync(Guid workspaceId, Guid testRunId, string error, CancellationToken cancellationToken);
}

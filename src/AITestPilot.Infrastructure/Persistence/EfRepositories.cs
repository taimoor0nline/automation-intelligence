using AITestPilot.Application.Abstractions;
using AITestPilot.Domain.Projects;
using AITestPilot.Domain.Testing;
using Microsoft.EntityFrameworkCore;

namespace AITestPilot.Infrastructure.Persistence;

public sealed class EfUnitOfWork(AITestPilotDbContext dbContext) : IUnitOfWork
{
    public Task<int> SaveChangesAsync(CancellationToken cancellationToken = default) =>
        dbContext.SaveChangesAsync(cancellationToken);
}

public sealed class EfProjectRepository(AITestPilotDbContext dbContext) : IProjectRepository
{
    public Task<Project?> GetByIdAsync(Guid workspaceId, Guid projectId, CancellationToken cancellationToken) =>
        dbContext.Projects.SingleOrDefaultAsync(
            value => value.WorkspaceId == workspaceId && value.Id == projectId,
            cancellationToken);

    public async Task<IReadOnlyList<Project>> ListAsync(Guid workspaceId, CancellationToken cancellationToken) =>
        await dbContext.Projects.AsNoTracking()
            .Where(value => value.WorkspaceId == workspaceId)
            .OrderBy(value => value.Name)
            .ToListAsync(cancellationToken);

    public Task<bool> CodeExistsAsync(Guid workspaceId, string code, CancellationToken cancellationToken)
    {
        var normalized = (code ?? string.Empty).Trim().ToUpperInvariant();
        return dbContext.Projects.AnyAsync(
            value => value.WorkspaceId == workspaceId && value.Code == normalized,
            cancellationToken);
    }

    public async Task AddAsync(Project project, CancellationToken cancellationToken) =>
        await dbContext.Projects.AddAsync(project, cancellationToken);
}

public sealed class EfProjectCategoryRepository(AITestPilotDbContext dbContext) : IProjectCategoryRepository
{
    public Task<ProjectCategory?> GetByIdAsync(Guid workspaceId, Guid id, CancellationToken cancellationToken) =>
        dbContext.ProjectCategories.SingleOrDefaultAsync(
            value => value.WorkspaceId == workspaceId && value.Id == id,
            cancellationToken);

    public async Task<IReadOnlyList<ProjectCategory>> ListAsync(Guid workspaceId, CancellationToken cancellationToken) =>
        await dbContext.ProjectCategories.AsNoTracking()
            .Where(value => value.WorkspaceId == workspaceId && value.IsActive)
            .OrderBy(value => value.SortOrder)
            .ThenBy(value => value.Name)
            .ToListAsync(cancellationToken);

    public async Task AddAsync(ProjectCategory category, CancellationToken cancellationToken) =>
        await dbContext.ProjectCategories.AddAsync(category, cancellationToken);
}

public sealed class EfProjectEnvironmentRepository(AITestPilotDbContext dbContext) : IProjectEnvironmentRepository
{
    public Task<ProjectEnvironment?> GetByIdAsync(
        Guid workspaceId,
        Guid projectId,
        Guid environmentId,
        CancellationToken cancellationToken) =>
        dbContext.ProjectEnvironments.SingleOrDefaultAsync(
            value => value.WorkspaceId == workspaceId && value.ProjectId == projectId && value.Id == environmentId,
            cancellationToken);

    public async Task<IReadOnlyList<ProjectEnvironment>> ListAsync(
        Guid workspaceId,
        Guid projectId,
        CancellationToken cancellationToken) =>
        await dbContext.ProjectEnvironments.AsNoTracking()
            .Where(value => value.WorkspaceId == workspaceId && value.ProjectId == projectId)
            .OrderByDescending(value => value.IsDefault)
            .ThenBy(value => value.Name)
            .ToListAsync(cancellationToken);

    public Task<bool> NameExistsAsync(
        Guid workspaceId,
        Guid projectId,
        string name,
        CancellationToken cancellationToken)
    {
        var normalized = (name ?? string.Empty).Trim();
        return dbContext.ProjectEnvironments.AnyAsync(
            value => value.WorkspaceId == workspaceId && value.ProjectId == projectId && value.Name == normalized,
            cancellationToken);
    }

    public async Task ClearDefaultAsync(Guid workspaceId, Guid projectId, CancellationToken cancellationToken)
    {
        var defaults = await dbContext.ProjectEnvironments
            .Where(value => value.WorkspaceId == workspaceId && value.ProjectId == projectId && value.IsDefault)
            .ToListAsync(cancellationToken);
        foreach (var environment in defaults) environment.SetDefault(false);
    }

    public async Task AddAsync(ProjectEnvironment environment, CancellationToken cancellationToken) =>
        await dbContext.ProjectEnvironments.AddAsync(environment, cancellationToken);
}

public sealed class EfTestCaseRepository(AITestPilotDbContext dbContext) : ITestCaseRepository
{
    public Task<TestCase?> GetByIdAsync(
        Guid workspaceId,
        Guid projectId,
        Guid testCaseId,
        CancellationToken cancellationToken) =>
        dbContext.TestCases.SingleOrDefaultAsync(
            value => value.WorkspaceId == workspaceId && value.ProjectId == projectId && value.Id == testCaseId,
            cancellationToken);

    public async Task<IReadOnlyList<TestCase>> GetApprovedByIdsAsync(
        Guid workspaceId,
        Guid projectId,
        IReadOnlyCollection<Guid> ids,
        CancellationToken cancellationToken)
    {
        var requestedIds = ids.Distinct().ToArray();
        return await dbContext.TestCases
            .Where(value =>
                value.WorkspaceId == workspaceId &&
                value.ProjectId == projectId &&
                value.Status == TestCaseStatus.Approved &&
                requestedIds.Contains(value.Id))
            .OrderBy(value => value.TestCaseNumber)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<TestCase>> ListAsync(Guid workspaceId, Guid projectId, CancellationToken cancellationToken) =>
        await dbContext.TestCases.AsNoTracking()
            .Where(value => value.WorkspaceId == workspaceId && value.ProjectId == projectId)
            .OrderBy(value => value.TestCaseNumber)
            .ToListAsync(cancellationToken);

    public async Task AddAsync(TestCase testCase, CancellationToken cancellationToken) =>
        await dbContext.TestCases.AddAsync(testCase, cancellationToken);
}

public sealed class EfTestRunRepository(AITestPilotDbContext dbContext) : ITestRunRepository
{
    public Task<TestRun?> GetByIdAsync(Guid workspaceId, Guid testRunId, CancellationToken cancellationToken) =>
        dbContext.TestRuns.SingleOrDefaultAsync(
            value => value.WorkspaceId == workspaceId && value.Id == testRunId,
            cancellationToken);

    public async Task<IReadOnlyList<TestRun>> ListAsync(Guid workspaceId, Guid projectId, CancellationToken cancellationToken) =>
        await dbContext.TestRuns.AsNoTracking()
            .Where(value => value.WorkspaceId == workspaceId && value.ProjectId == projectId)
            .OrderByDescending(value => value.RequestedAtUtc)
            .ToListAsync(cancellationToken);

    public async Task AddAsync(
        TestRun testRun,
        IReadOnlyCollection<TestRunCase> runCases,
        CancellationToken cancellationToken)
    {
        await dbContext.TestRuns.AddAsync(testRun, cancellationToken);
        await dbContext.TestRunCases.AddRangeAsync(runCases, cancellationToken);
    }
}

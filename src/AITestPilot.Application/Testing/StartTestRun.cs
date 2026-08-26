using AITestPilot.Application.Abstractions;
using AITestPilot.Application.Abstractions.Identity;
using AITestPilot.Domain.Projects;
using AITestPilot.Domain.Testing;

namespace AITestPilot.Application.Testing;

public sealed record StartTestRunCommand(
    Guid ProjectId,
    Guid ProjectEnvironmentId,
    IReadOnlyCollection<Guid> TestCaseIds,
    string Browser = "chromium",
    bool Headless = false,
    int SlowMoMs = 150,
    bool CaptureTrace = true,
    bool CaptureVideo = true,
    bool CaptureScreenshotOnFailure = true);

public sealed record StartTestRunResult(Guid TestRunId, string RunNumber, TestRunStatus Status);

public sealed class StartTestRunCommandHandler(
    IWorkspaceContext workspaceContext,
    ICurrentUserContext currentUserContext,
    IProjectRepository projectRepository,
    IProjectEnvironmentRepository environmentRepository,
    ITestCaseRepository testCaseRepository,
    ITestRunRepository testRunRepository,
    IUnitOfWork unitOfWork,
    IExecutionQueue executionQueue)
    : ICommandHandler<StartTestRunCommand, StartTestRunResult>
{
    public async Task<StartTestRunResult> HandleAsync(StartTestRunCommand command, CancellationToken cancellationToken)
    {
        if (command.TestCaseIds.Count == 0)
            throw new InvalidOperationException("At least one approved test case must be selected.");

        var workspaceId = workspaceContext.WorkspaceId;
        var project = await projectRepository.GetByIdAsync(workspaceId, command.ProjectId, cancellationToken)
            ?? throw new InvalidOperationException("Project was not found in the current workspace.");
        if (project.Status == ProjectStatus.Archived)
            throw new InvalidOperationException("Archived projects cannot execute tests.");

        var environment = await environmentRepository.GetByIdAsync(
            workspaceId,
            command.ProjectId,
            command.ProjectEnvironmentId,
            cancellationToken)
            ?? throw new InvalidOperationException("Project environment was not found in the current workspace.");
        if (!environment.IsActive)
            throw new InvalidOperationException("The selected project environment is inactive.");

        var requestedIds = command.TestCaseIds.Distinct().ToArray();
        var testCases = await testCaseRepository.GetApprovedByIdsAsync(
            workspaceId,
            command.ProjectId,
            requestedIds,
            cancellationToken);
        if (testCases.Count != requestedIds.Length)
            throw new InvalidOperationException("One or more selected test cases are missing, not approved, or belong to another project/workspace.");

        var now = DateTimeOffset.UtcNow;
        var runNumber = $"RUN-{now:yyyyMMdd-HHmmss}-{Guid.NewGuid():N}"[..28].ToUpperInvariant();
        var requestedBy = currentUserContext.IsAuthenticated && currentUserContext.UserId != Guid.Empty
            ? currentUserContext.UserId
            : (Guid?)null;

        var run = new TestRun(
            workspaceId,
            project.Id,
            environment.Id,
            runNumber,
            environment.StartingUrl,
            requestedBy,
            command.Browser,
            command.Headless,
            command.SlowMoMs,
            command.CaptureTrace,
            command.CaptureVideo,
            command.CaptureScreenshotOnFailure);

        var runCases = testCases
            .Select((testCase, index) => new TestRunCase(workspaceId, run.Id, testCase, index + 1))
            .ToArray();

        await testRunRepository.AddAsync(run, runCases, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        await executionQueue.EnqueueAsync(new QueuedTestRun(workspaceId, run.Id), cancellationToken);

        return new StartTestRunResult(run.Id, run.RunNumber, run.Status);
    }
}

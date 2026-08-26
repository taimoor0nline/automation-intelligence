using AITestPilot.Application.Abstractions;
using AITestPilot.Domain.Testing;
using Microsoft.EntityFrameworkCore;

namespace AITestPilot.Infrastructure.Persistence;

public sealed class EfTestRunExecutionStore(AITestPilotDbContext dbContext) : ITestRunExecutionStore
{
    public async Task<TestExecutionRequest?> LoadExecutionRequestAsync(
        Guid workspaceId,
        Guid testRunId,
        CancellationToken cancellationToken)
    {
        var run = await dbContext.TestRuns.AsNoTracking()
            .SingleOrDefaultAsync(
                value => value.WorkspaceId == workspaceId && value.Id == testRunId,
                cancellationToken);
        if (run is null) return null;
        if (run.Status is not (TestRunStatus.Queued or TestRunStatus.Running))
            throw new InvalidOperationException($"Run {run.RunNumber} is not executable in status {run.Status}.");

        var runCases = await dbContext.TestRunCases.AsNoTracking()
            .Where(value => value.WorkspaceId == workspaceId && value.TestRunId == testRunId)
            .OrderBy(value => value.Sequence)
            .ToListAsync(cancellationToken);
        if (runCases.Count == 0)
            throw new InvalidOperationException($"Run {run.RunNumber} contains no selected test cases.");

        return new TestExecutionRequest(
            workspaceId,
            run.ProjectId,
            run.ProjectEnvironmentId,
            run.Id,
            run.StartingUrlSnapshot,
            runCases.Select(value => new TestExecutionCase(
                value.TestCaseId,
                value.TestCaseNumberSnapshot,
                value.TitleSnapshot,
                value.DefinitionSnapshot)).ToArray(),
            new TestExecutionOptions(
                run.Browser,
                run.Headless,
                run.SlowMoMs,
                run.CaptureTrace,
                run.CaptureVideo,
                run.CaptureScreenshotOnFailure));
    }

    public async Task MarkStartedAsync(
        Guid workspaceId,
        Guid testRunId,
        CancellationToken cancellationToken)
    {
        var run = await RequiredRunAsync(workspaceId, testRunId, cancellationToken);
        run.Start();
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    public async Task SaveExecutionResultAsync(
        Guid workspaceId,
        TestExecutionResult result,
        CancellationToken cancellationToken)
    {
        var run = await RequiredRunAsync(workspaceId, result.TestRunId, cancellationToken);
        if (run.Status != TestRunStatus.Running)
            throw new InvalidOperationException($"Run {run.RunNumber} is not in Running state.");

        var alreadyPersisted = await dbContext.TestResults.AnyAsync(
            value => value.WorkspaceId == workspaceId && value.TestRunId == result.TestRunId,
            cancellationToken);
        if (alreadyPersisted)
            throw new InvalidOperationException($"Results for run {run.RunNumber} have already been persisted.");

        foreach (var test in result.Tests)
        {
            var domainResult = new TestResult(workspaceId, result.TestRunId, test.TestCaseId);
            domainResult.Complete(
                test.Skipped ? TestResultStatus.Skipped : test.Passed ? TestResultStatus.Passed : TestResultStatus.Failed,
                (long)Math.Max(0, test.Duration.TotalMilliseconds),
                test.FailureType,
                test.FailureMessage);
            await dbContext.TestResults.AddAsync(domainResult, cancellationToken);

            foreach (var assertion in test.Assertions)
            {
                await dbContext.TestAssertionResults.AddAsync(
                    new TestAssertionResult(
                        workspaceId,
                        result.TestRunId,
                        domainResult.Id,
                        test.TestCaseId,
                        assertion.Sequence,
                        assertion.Type,
                        assertion.Expected,
                        assertion.Actual,
                        assertion.Passed ? AssertionResultStatus.Passed : AssertionResultStatus.Failed,
                        assertion.FailureMessage,
                        assertion.StartedAtUtc,
                        assertion.CompletedAtUtc),
                    cancellationToken);
            }

            foreach (var browserEvent in test.BrowserEvents)
            {
                await dbContext.TestBrowserEvents.AddAsync(
                    new TestBrowserEvent(
                        workspaceId,
                        result.TestRunId,
                        domainResult.Id,
                        browserEvent.OccurredAtUtc,
                        ParseBrowserEvent(browserEvent.Type),
                        browserEvent.Message,
                        browserEvent.Level,
                        browserEvent.Url),
                    cancellationToken);
            }

            foreach (var networkEvent in test.NetworkEvents)
            {
                await dbContext.TestNetworkEvents.AddAsync(
                    new TestNetworkEvent(
                        workspaceId,
                        result.TestRunId,
                        domainResult.Id,
                        networkEvent.OccurredAtUtc,
                        networkEvent.Url,
                        networkEvent.Method,
                        networkEvent.ResponseStatus,
                        networkEvent.ResourceType,
                        networkEvent.DurationMs,
                        networkEvent.Failed,
                        networkEvent.FailureText),
                    cancellationToken);
            }

            await AddArtifactAsync(workspaceId, result.TestRunId, domainResult.Id, TestArtifactType.Screenshot, test.ScreenshotPath, "image/png", cancellationToken);
            await AddArtifactAsync(workspaceId, result.TestRunId, domainResult.Id, TestArtifactType.Video, test.VideoPath, "video/webm", cancellationToken);
            await AddArtifactAsync(workspaceId, result.TestRunId, domainResult.Id, TestArtifactType.Trace, test.TracePath, "application/zip", cancellationToken);
        }

        run.Complete(result.Failed == 0);
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    public async Task MarkInfrastructureErrorAsync(
        Guid workspaceId,
        Guid testRunId,
        string error,
        CancellationToken cancellationToken)
    {
        var run = await RequiredRunAsync(workspaceId, testRunId, cancellationToken);
        run.FailInfrastructure(error);
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    private async Task<TestRun> RequiredRunAsync(
        Guid workspaceId,
        Guid testRunId,
        CancellationToken cancellationToken) =>
        await dbContext.TestRuns.SingleOrDefaultAsync(
            value => value.WorkspaceId == workspaceId && value.Id == testRunId,
            cancellationToken)
        ?? throw new InvalidOperationException($"TestRun '{testRunId}' was not found in the current workspace.");

    private async Task AddArtifactAsync(
        Guid workspaceId,
        Guid testRunId,
        Guid testResultId,
        TestArtifactType type,
        string? path,
        string contentType,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(path)) return;
        var size = File.Exists(path) ? new FileInfo(path).Length : (long?)null;
        await dbContext.TestArtifacts.AddAsync(
            new TestArtifact(
                workspaceId,
                testRunId,
                testResultId,
                type,
                path,
                "LocalFileSystem",
                contentType,
                size),
            cancellationToken);
    }

    private static BrowserEventType ParseBrowserEvent(string type) =>
        Enum.TryParse<BrowserEventType>(type, true, out var parsed)
            ? parsed
            : BrowserEventType.Console;
}

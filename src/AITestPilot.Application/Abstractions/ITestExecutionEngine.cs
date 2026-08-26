namespace AITestPilot.Application.Abstractions;

public interface ITestExecutionEngine
{
    Task<TestExecutionResult> ExecuteAsync(
        TestExecutionRequest request,
        CancellationToken cancellationToken);
}

public sealed record TestExecutionRequest(
    Guid WorkspaceId,
    Guid ProjectId,
    Guid ProjectEnvironmentId,
    Guid TestRunId,
    string StartingUrl,
    IReadOnlyCollection<Guid> TestCaseIds);

public sealed record TestExecutionResult(
    Guid TestRunId,
    int Total,
    int Passed,
    int Failed,
    int Skipped,
    TimeSpan Duration);

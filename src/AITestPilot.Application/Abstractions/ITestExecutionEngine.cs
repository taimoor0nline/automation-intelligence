using AITestPilot.Domain.Testing;

namespace AITestPilot.Application.Abstractions;

public interface ITestExecutionEngine
{
    Task<TestExecutionResult> ExecuteAsync(
        TestExecutionRequest request,
        CancellationToken cancellationToken);
}

public sealed record TestExecutionCase(
    Guid TestCaseId,
    string TestCaseNumber,
    string Title,
    TestDefinition Definition);

public sealed record TestExecutionOptions(
    string Browser = "chromium",
    bool Headless = true,
    int SlowMoMs = 0,
    bool CaptureTrace = true,
    bool CaptureVideo = true,
    bool CaptureScreenshotOnFailure = true,
    string? ArtifactDirectory = null);

public sealed record TestExecutionRequest(
    Guid WorkspaceId,
    Guid ProjectId,
    Guid ProjectEnvironmentId,
    Guid TestRunId,
    string StartingUrl,
    IReadOnlyCollection<TestExecutionCase> TestCases,
    TestExecutionOptions Options);

public sealed record AssertionExecutionEvidence(
    int Sequence,
    AssertionType Type,
    bool Passed,
    string? Expected,
    string? Actual,
    string? FailureMessage,
    DateTimeOffset StartedAtUtc,
    DateTimeOffset CompletedAtUtc);

public sealed record BrowserExecutionEvidence(
    DateTimeOffset OccurredAtUtc,
    string Type,
    string? Level,
    string Message,
    string? Url);

public sealed record NetworkExecutionEvidence(
    DateTimeOffset OccurredAtUtc,
    string Url,
    string Method,
    int? ResponseStatus,
    string? ResourceType,
    bool Failed,
    string? FailureText,
    long? DurationMs);

public sealed record TestCaseExecutionResult(
    Guid TestCaseId,
    string TestCaseNumber,
    bool Passed,
    bool Skipped,
    TimeSpan Duration,
    string? FailureType,
    string? FailureMessage,
    IReadOnlyCollection<AssertionExecutionEvidence> Assertions,
    IReadOnlyCollection<BrowserExecutionEvidence> BrowserEvents,
    IReadOnlyCollection<NetworkExecutionEvidence> NetworkEvents,
    string? ScreenshotPath,
    string? VideoPath,
    string? TracePath);

public sealed record TestExecutionResult(
    Guid TestRunId,
    int Total,
    int Passed,
    int Failed,
    int Skipped,
    TimeSpan Duration,
    IReadOnlyCollection<TestCaseExecutionResult> Tests);

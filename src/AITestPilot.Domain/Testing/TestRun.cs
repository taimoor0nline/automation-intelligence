using AITestPilot.Domain.Common;

namespace AITestPilot.Domain.Testing;

public enum TestRunStatus { Queued, Running, Passed, Failed, Cancelled, Error }
public enum TestResultStatus { Passed, Failed, Skipped, Error }

public sealed class TestRun : WorkspaceScopedEntity
{
    public Guid ProjectId { get; private set; }
    public Guid ProjectEnvironmentId { get; private set; }
    public string RunNumber { get; private set; } = string.Empty;
    public string ExecutionEngine { get; private set; } = "Playwright";
    public string StartingUrlSnapshot { get; private set; } = string.Empty;
    public TestRunStatus Status { get; private set; } = TestRunStatus.Queued;
    public DateTimeOffset RequestedAtUtc { get; private set; }
    public Guid? RequestedByUserId { get; private set; }
    public DateTimeOffset? StartedAtUtc { get; private set; }
    public DateTimeOffset? CompletedAtUtc { get; private set; }
    public DateTimeOffset? CancelledAtUtc { get; private set; }
    public Guid? CancelledByUserId { get; private set; }

    private TestRun() { }

    public TestRun(Guid workspaceId, Guid projectId, Guid projectEnvironmentId, string runNumber, string startingUrl, Guid? requestedByUserId) : base(workspaceId)
    {
        if (projectId == Guid.Empty) throw new ArgumentException("ProjectId is required.");
        if (projectEnvironmentId == Guid.Empty) throw new ArgumentException("ProjectEnvironmentId is required.");
        if (!Uri.TryCreate(startingUrl, UriKind.Absolute, out var uri) || (uri.Scheme != "http" && uri.Scheme != "https"))
            throw new ArgumentException("Starting URL must be absolute HTTP/HTTPS.");
        ProjectId = projectId;
        ProjectEnvironmentId = projectEnvironmentId;
        RunNumber = runNumber.Trim();
        StartingUrlSnapshot = uri.ToString();
        RequestedAtUtc = DateTimeOffset.UtcNow;
        RequestedByUserId = requestedByUserId;
    }

    public void Start() { Status = TestRunStatus.Running; StartedAtUtc = DateTimeOffset.UtcNow; Touch(); }
    public void Complete(bool passed) { Status = passed ? TestRunStatus.Passed : TestRunStatus.Failed; CompletedAtUtc = DateTimeOffset.UtcNow; Touch(); }
    public void FailInfrastructure() { Status = TestRunStatus.Error; CompletedAtUtc = DateTimeOffset.UtcNow; Touch(); }
    public void Cancel(Guid? userId) { Status = TestRunStatus.Cancelled; CancelledAtUtc = DateTimeOffset.UtcNow; CancelledByUserId = userId; Touch(); }
}

public sealed class TestResult : WorkspaceScopedEntity
{
    public Guid TestRunId { get; private set; }
    public Guid TestCaseId { get; private set; }
    public TestResultStatus Status { get; private set; }
    public long? DurationMs { get; private set; }
    public string? FailureType { get; private set; }
    public string? FailureMessage { get; private set; }
    public string? ObservedResult { get; private set; }
    public DateTimeOffset StartedAtUtc { get; private set; }
    public DateTimeOffset? CompletedAtUtc { get; private set; }

    private TestResult() { }
    public TestResult(Guid workspaceId, Guid testRunId, Guid testCaseId) : base(workspaceId)
    {
        TestRunId = testRunId;
        TestCaseId = testCaseId;
        Status = TestResultStatus.Skipped;
        StartedAtUtc = DateTimeOffset.UtcNow;
    }

    public void Complete(TestResultStatus status, long durationMs, string? failureType = null, string? failureMessage = null, string? observedResult = null)
    {
        Status = status;
        DurationMs = durationMs;
        FailureType = failureType;
        FailureMessage = failureMessage;
        ObservedResult = observedResult;
        CompletedAtUtc = DateTimeOffset.UtcNow;
        Touch();
    }
}

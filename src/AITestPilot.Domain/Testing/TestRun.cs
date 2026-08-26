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
    public string Browser { get; private set; } = "chromium";
    public bool Headless { get; private set; }
    public int SlowMoMs { get; private set; }
    public bool CaptureTrace { get; private set; }
    public bool CaptureVideo { get; private set; }
    public bool CaptureScreenshotOnFailure { get; private set; }
    public TestRunStatus Status { get; private set; } = TestRunStatus.Queued;
    public DateTimeOffset RequestedAtUtc { get; private set; }
    public Guid? RequestedByUserId { get; private set; }
    public DateTimeOffset? StartedAtUtc { get; private set; }
    public DateTimeOffset? CompletedAtUtc { get; private set; }
    public DateTimeOffset? CancelledAtUtc { get; private set; }
    public Guid? CancelledByUserId { get; private set; }
    public string? ErrorMessage { get; private set; }

    private TestRun() { }

    public TestRun(
        Guid workspaceId,
        Guid projectId,
        Guid projectEnvironmentId,
        string runNumber,
        string startingUrl,
        Guid? requestedByUserId,
        string browser = "chromium",
        bool headless = true,
        int slowMoMs = 0,
        bool captureTrace = true,
        bool captureVideo = true,
        bool captureScreenshotOnFailure = true) : base(workspaceId)
    {
        if (projectId == Guid.Empty) throw new ArgumentException("ProjectId is required.", nameof(projectId));
        if (projectEnvironmentId == Guid.Empty) throw new ArgumentException("ProjectEnvironmentId is required.", nameof(projectEnvironmentId));
        if (string.IsNullOrWhiteSpace(runNumber)) throw new ArgumentException("RunNumber is required.", nameof(runNumber));
        if (!Uri.TryCreate(startingUrl, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
        {
            throw new ArgumentException("Starting URL must be absolute HTTP/HTTPS.", nameof(startingUrl));
        }

        var normalizedBrowser = (browser ?? string.Empty).Trim().ToLowerInvariant();
        if (normalizedBrowser is not ("chromium" or "chrome" or "edge" or "firefox" or "webkit"))
            throw new ArgumentException("Browser must be chromium, chrome, edge, firefox, or webkit.", nameof(browser));

        ProjectId = projectId;
        ProjectEnvironmentId = projectEnvironmentId;
        RunNumber = runNumber.Trim().ToUpperInvariant();
        StartingUrlSnapshot = uri.ToString();
        Browser = normalizedBrowser;
        Headless = headless;
        SlowMoMs = Math.Clamp(slowMoMs, 0, 3_000);
        CaptureTrace = captureTrace;
        CaptureVideo = captureVideo;
        CaptureScreenshotOnFailure = captureScreenshotOnFailure;
        RequestedAtUtc = DateTimeOffset.UtcNow;
        RequestedByUserId = requestedByUserId;
    }

    public void Start()
    {
        if (Status != TestRunStatus.Queued) throw new InvalidOperationException("Only queued runs can start.");
        Status = TestRunStatus.Running;
        StartedAtUtc = DateTimeOffset.UtcNow;
        ErrorMessage = null;
        Touch();
    }

    public void Complete(bool passed)
    {
        if (Status != TestRunStatus.Running) throw new InvalidOperationException("Only running runs can complete.");
        Status = passed ? TestRunStatus.Passed : TestRunStatus.Failed;
        CompletedAtUtc = DateTimeOffset.UtcNow;
        ErrorMessage = null;
        Touch();
    }

    public void FailInfrastructure(string? error)
    {
        Status = TestRunStatus.Error;
        ErrorMessage = Truncate(error, 4000);
        CompletedAtUtc = DateTimeOffset.UtcNow;
        Touch();
    }

    public void Cancel(Guid? userId)
    {
        if (Status is TestRunStatus.Passed or TestRunStatus.Failed or TestRunStatus.Error or TestRunStatus.Cancelled)
            throw new InvalidOperationException("A completed run cannot be cancelled.");
        Status = TestRunStatus.Cancelled;
        CancelledAtUtc = DateTimeOffset.UtcNow;
        CancelledByUserId = userId;
        Touch();
    }

    private static string? Truncate(string? value, int maxLength)
    {
        var normalized = value?.Trim();
        if (string.IsNullOrWhiteSpace(normalized)) return null;
        return normalized.Length <= maxLength ? normalized : normalized[..maxLength];
    }
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
        if (testRunId == Guid.Empty) throw new ArgumentException("TestRunId is required.", nameof(testRunId));
        if (testCaseId == Guid.Empty) throw new ArgumentException("TestCaseId is required.", nameof(testCaseId));
        TestRunId = testRunId;
        TestCaseId = testCaseId;
        Status = TestResultStatus.Skipped;
        StartedAtUtc = DateTimeOffset.UtcNow;
    }

    public void Complete(
        TestResultStatus status,
        long durationMs,
        string? failureType = null,
        string? failureMessage = null,
        string? observedResult = null)
    {
        Status = status;
        DurationMs = Math.Max(0, durationMs);
        FailureType = failureType;
        FailureMessage = failureMessage;
        ObservedResult = observedResult;
        CompletedAtUtc = DateTimeOffset.UtcNow;
        Touch();
    }
}

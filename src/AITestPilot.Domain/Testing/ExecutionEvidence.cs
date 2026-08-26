using AITestPilot.Domain.Common;

namespace AITestPilot.Domain.Testing;

public enum AssertionResultStatus { Passed, Failed, Skipped, Error }
public enum BrowserEventType { Console, PageError, Popup, Download }
public enum TestArtifactType { Screenshot, Video, Trace, Log, Network, Other }

public sealed class TestAssertionResult : WorkspaceScopedEntity
{
    public Guid TestRunId { get; private set; }
    public Guid TestResultId { get; private set; }
    public Guid TestCaseId { get; private set; }
    public int Sequence { get; private set; }
    public AssertionType AssertionType { get; private set; }
    public string? ExpectedValue { get; private set; }
    public string? ActualValue { get; private set; }
    public AssertionResultStatus Status { get; private set; }
    public string? FailureMessage { get; private set; }
    public DateTimeOffset StartedAtUtc { get; private set; }
    public DateTimeOffset CompletedAtUtc { get; private set; }
    public long DurationMs { get; private set; }

    private TestAssertionResult() { }

    public TestAssertionResult(
        Guid workspaceId,
        Guid testRunId,
        Guid testResultId,
        Guid testCaseId,
        int sequence,
        AssertionType assertionType,
        string? expectedValue,
        string? actualValue,
        AssertionResultStatus status,
        string? failureMessage,
        DateTimeOffset startedAtUtc,
        DateTimeOffset completedAtUtc) : base(workspaceId)
    {
        TestRunId = testRunId;
        TestResultId = testResultId;
        TestCaseId = testCaseId;
        Sequence = sequence;
        AssertionType = assertionType;
        ExpectedValue = expectedValue;
        ActualValue = actualValue;
        Status = status;
        FailureMessage = failureMessage;
        StartedAtUtc = startedAtUtc.ToUniversalTime();
        CompletedAtUtc = completedAtUtc.ToUniversalTime();
        DurationMs = Math.Max(0, (long)(CompletedAtUtc - StartedAtUtc).TotalMilliseconds);
    }
}

public sealed class TestNetworkEvent : WorkspaceScopedEntity
{
    public Guid TestRunId { get; private set; }
    public Guid? TestResultId { get; private set; }
    public DateTimeOffset OccurredAtUtc { get; private set; }
    public string Url { get; private set; } = string.Empty;
    public string Method { get; private set; } = string.Empty;
    public int? ResponseStatus { get; private set; }
    public string? ResourceType { get; private set; }
    public long? DurationMs { get; private set; }
    public bool Failed { get; private set; }
    public string? FailureText { get; private set; }
    public string? RequestSummaryJson { get; private set; }
    public string? ResponseSummaryJson { get; private set; }

    private TestNetworkEvent() { }

    public TestNetworkEvent(
        Guid workspaceId,
        Guid testRunId,
        Guid? testResultId,
        DateTimeOffset occurredAtUtc,
        string url,
        string method,
        int? responseStatus,
        string? resourceType,
        long? durationMs,
        bool failed,
        string? failureText = null,
        string? requestSummaryJson = null,
        string? responseSummaryJson = null) : base(workspaceId)
    {
        TestRunId = testRunId;
        TestResultId = testResultId;
        OccurredAtUtc = occurredAtUtc.ToUniversalTime();
        Url = Required(url, nameof(url), 4000);
        Method = Required(method, nameof(method), 20).ToUpperInvariant();
        ResponseStatus = responseStatus;
        ResourceType = Optional(resourceType, 100);
        DurationMs = durationMs is null ? null : Math.Max(0, durationMs.Value);
        Failed = failed;
        FailureText = Optional(failureText, 4000);
        RequestSummaryJson = requestSummaryJson;
        ResponseSummaryJson = responseSummaryJson;
    }

    private static string Required(string value, string name, int maxLength)
    {
        var normalized = (value ?? string.Empty).Trim();
        if (normalized.Length == 0) throw new ArgumentException($"{name} is required.", name);
        if (normalized.Length > maxLength) throw new ArgumentOutOfRangeException(name);
        return normalized;
    }

    private static string? Optional(string? value, int maxLength)
    {
        var normalized = value?.Trim();
        if (string.IsNullOrWhiteSpace(normalized)) return null;
        return normalized.Length <= maxLength ? normalized : normalized[..maxLength];
    }
}

public sealed class TestBrowserEvent : WorkspaceScopedEntity
{
    public Guid TestRunId { get; private set; }
    public Guid? TestResultId { get; private set; }
    public DateTimeOffset OccurredAtUtc { get; private set; }
    public BrowserEventType Type { get; private set; }
    public string? Level { get; private set; }
    public string Message { get; private set; } = string.Empty;
    public string? Url { get; private set; }

    private TestBrowserEvent() { }

    public TestBrowserEvent(
        Guid workspaceId,
        Guid testRunId,
        Guid? testResultId,
        DateTimeOffset occurredAtUtc,
        BrowserEventType type,
        string message,
        string? level = null,
        string? url = null) : base(workspaceId)
    {
        TestRunId = testRunId;
        TestResultId = testResultId;
        OccurredAtUtc = occurredAtUtc.ToUniversalTime();
        Type = type;
        Message = string.IsNullOrWhiteSpace(message) ? "(empty)" : message.Trim();
        Level = level?.Trim();
        Url = url?.Trim();
    }
}

public sealed class TestArtifact : WorkspaceScopedEntity
{
    public Guid TestRunId { get; private set; }
    public Guid? TestResultId { get; private set; }
    public TestArtifactType ArtifactType { get; private set; }
    public string StorageProvider { get; private set; } = "LocalFileSystem";
    public string StoragePath { get; private set; } = string.Empty;
    public string? ContentType { get; private set; }
    public long? SizeBytes { get; private set; }

    private TestArtifact() { }

    public TestArtifact(
        Guid workspaceId,
        Guid testRunId,
        Guid? testResultId,
        TestArtifactType artifactType,
        string storagePath,
        string storageProvider = "LocalFileSystem",
        string? contentType = null,
        long? sizeBytes = null) : base(workspaceId)
    {
        if (testRunId == Guid.Empty) throw new ArgumentException("TestRunId is required.", nameof(testRunId));
        if (string.IsNullOrWhiteSpace(storagePath)) throw new ArgumentException("StoragePath is required.", nameof(storagePath));
        TestRunId = testRunId;
        TestResultId = testResultId;
        ArtifactType = artifactType;
        StoragePath = storagePath.Trim();
        StorageProvider = string.IsNullOrWhiteSpace(storageProvider) ? "LocalFileSystem" : storageProvider.Trim();
        ContentType = contentType?.Trim();
        SizeBytes = sizeBytes is null ? null : Math.Max(0, sizeBytes.Value);
    }
}

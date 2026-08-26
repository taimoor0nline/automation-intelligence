using AITestPilot.Domain.Common;

namespace AITestPilot.Domain.Testing;

public enum AssertionResultStatus { Passed, Failed, Skipped, Error }
public enum BrowserEventType { Console, PageError, Popup, Download }

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
    public TestAssertionResult(Guid workspaceId, Guid testRunId, Guid testResultId, Guid testCaseId, int sequence, AssertionType assertionType,
        string? expectedValue, string? actualValue, AssertionResultStatus status, string? failureMessage, DateTimeOffset startedAtUtc, DateTimeOffset completedAtUtc) : base(workspaceId)
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
    public TestNetworkEvent(Guid workspaceId, Guid testRunId, Guid? testResultId, DateTimeOffset occurredAtUtc, string url, string method) : base(workspaceId)
    {
        TestRunId = testRunId;
        TestResultId = testResultId;
        OccurredAtUtc = occurredAtUtc.ToUniversalTime();
        Url = url;
        Method = method;
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
    public TestBrowserEvent(Guid workspaceId, Guid testRunId, Guid? testResultId, BrowserEventType type, string message, string? level = null, string? url = null) : base(workspaceId)
    {
        TestRunId = testRunId;
        TestResultId = testResultId;
        OccurredAtUtc = DateTimeOffset.UtcNow;
        Type = type;
        Message = message;
        Level = level;
        Url = url;
    }
}

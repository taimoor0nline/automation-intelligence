namespace AITestPilot.Application.Abstractions;

public sealed record LiveExecutionFrame(
    Guid WorkspaceId,
    Guid TestRunId,
    Guid TestCaseId,
    DateTimeOffset OccurredAtUtc,
    int ViewportWidth,
    int ViewportHeight,
    ReadOnlyMemory<byte> ImageData);

public interface ILiveExecutionStream
{
    ValueTask PublishFrameAsync(LiveExecutionFrame frame, CancellationToken cancellationToken = default);
}

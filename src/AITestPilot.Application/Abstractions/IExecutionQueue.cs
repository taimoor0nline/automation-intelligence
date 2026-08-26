namespace AITestPilot.Application.Abstractions;

public sealed record QueuedTestRun(Guid WorkspaceId, Guid TestRunId);

public interface IExecutionQueue
{
    ValueTask EnqueueAsync(QueuedTestRun run, CancellationToken cancellationToken = default);
    ValueTask<QueuedTestRun> DequeueAsync(CancellationToken cancellationToken);
}

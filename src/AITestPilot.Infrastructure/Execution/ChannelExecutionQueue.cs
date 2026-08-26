using System.Threading.Channels;
using AITestPilot.Application.Abstractions;

namespace AITestPilot.Infrastructure.Execution;

public sealed class ChannelExecutionQueue : IExecutionQueue
{
    private readonly Channel<QueuedTestRun> _channel = Channel.CreateUnbounded<QueuedTestRun>(
        new UnboundedChannelOptions
        {
            SingleReader = true,
            SingleWriter = false,
            AllowSynchronousContinuations = false
        });

    public ValueTask EnqueueAsync(QueuedTestRun run, CancellationToken cancellationToken = default)
    {
        if (run.WorkspaceId == Guid.Empty) throw new ArgumentException("WorkspaceId is required.", nameof(run));
        if (run.TestRunId == Guid.Empty) throw new ArgumentException("TestRunId is required.", nameof(run));
        return _channel.Writer.WriteAsync(run, cancellationToken);
    }

    public ValueTask<QueuedTestRun> DequeueAsync(CancellationToken cancellationToken) =>
        _channel.Reader.ReadAsync(cancellationToken);
}

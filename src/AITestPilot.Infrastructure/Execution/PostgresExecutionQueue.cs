using System.Data;
using AITestPilot.Application.Abstractions;
using AITestPilot.Domain.Testing;
using AITestPilot.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace AITestPilot.Infrastructure.Execution;

/// <summary>
/// Community execution queue backed by test_runs in PostgreSQL.
/// The run row is the durable queue message. Dequeue atomically claims the oldest queued run
/// using FOR UPDATE SKIP LOCKED and moves it to Running before returning it to a Worker.
/// </summary>
public sealed class PostgresExecutionQueue(AITestPilotDbContext dbContext) : IExecutionQueue
{
    public async ValueTask EnqueueAsync(QueuedTestRun run, CancellationToken cancellationToken = default)
    {
        if (run.WorkspaceId == Guid.Empty) throw new ArgumentException("WorkspaceId is required.", nameof(run));
        if (run.TestRunId == Guid.Empty) throw new ArgumentException("TestRunId is required.", nameof(run));

        var queued = await dbContext.TestRuns.AsNoTracking().AnyAsync(
            value =>
                value.WorkspaceId == run.WorkspaceId &&
                value.Id == run.TestRunId &&
                value.Status == TestRunStatus.Queued,
            cancellationToken);
        if (!queued)
            throw new InvalidOperationException("The TestRun must be persisted in Queued status before enqueueing.");
    }

    public async ValueTask<QueuedTestRun> DequeueAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            await using var transaction = await dbContext.Database.BeginTransactionAsync(
                IsolationLevel.ReadCommitted,
                cancellationToken);

            var run = await dbContext.TestRuns
                .FromSqlInterpolated($$"""
                    SELECT *
                    FROM test_runs
                    WHERE status = {{(int)TestRunStatus.Queued}}
                    ORDER BY requested_at_utc
                    FOR UPDATE SKIP LOCKED
                    LIMIT 1
                    """)
                .SingleOrDefaultAsync(cancellationToken);

            if (run is null)
            {
                await transaction.RollbackAsync(cancellationToken);
                await Task.Delay(TimeSpan.FromMilliseconds(500), cancellationToken);
                continue;
            }

            run.Start();
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return new QueuedTestRun(run.WorkspaceId, run.Id);
        }

        throw new OperationCanceledException(cancellationToken);
    }
}

namespace AITestPilot.Domain.Common;

public abstract class WorkspaceScopedEntity
{
    public Guid Id { get; protected set; }
    public Guid WorkspaceId { get; protected set; }
    public DateTimeOffset CreatedAtUtc { get; protected set; }
    public DateTimeOffset UpdatedAtUtc { get; protected set; }

    protected WorkspaceScopedEntity(Guid workspaceId)
    {
        if (workspaceId == Guid.Empty)
        {
            throw new ArgumentException("WorkspaceId is required.", nameof(workspaceId));
        }

        Id = Guid.NewGuid();
        WorkspaceId = workspaceId;
        CreatedAtUtc = DateTimeOffset.UtcNow;
        UpdatedAtUtc = CreatedAtUtc;
    }

    protected WorkspaceScopedEntity()
    {
    }

    protected void Touch() => UpdatedAtUtc = DateTimeOffset.UtcNow;
}

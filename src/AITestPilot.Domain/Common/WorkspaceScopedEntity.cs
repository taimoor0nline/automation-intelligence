namespace AITestPilot.Domain.Common;

public abstract class WorkspaceScopedEntity : AuditableEntity
{
    public Guid WorkspaceId { get; protected set; }

    protected WorkspaceScopedEntity(Guid workspaceId) : base()
    {
        if (workspaceId == Guid.Empty)
        {
            throw new ArgumentException("WorkspaceId is required.", nameof(workspaceId));
        }

        WorkspaceId = workspaceId;
    }

    protected WorkspaceScopedEntity()
    {
    }
}

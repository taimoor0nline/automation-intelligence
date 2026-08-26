using AITestPilot.Domain.Common;

namespace AITestPilot.Domain.Identity;

public sealed class WorkspaceMembership : WorkspaceScopedEntity
{
    public Guid UserId { get; private set; }
    public WorkspaceRole Role { get; private set; }
    public bool IsActive { get; private set; }

    private WorkspaceMembership()
    {
    }

    public WorkspaceMembership(Guid workspaceId, Guid userId, WorkspaceRole role) : base(workspaceId)
    {
        if (userId == Guid.Empty) throw new ArgumentException("UserId is required.", nameof(userId));

        UserId = userId;
        Role = role;
        IsActive = true;
    }

    public void ChangeRole(WorkspaceRole role)
    {
        Role = role;
        Touch();
    }

    public void Activate()
    {
        IsActive = true;
        Touch();
    }

    public void Deactivate()
    {
        IsActive = false;
        Touch();
    }
}

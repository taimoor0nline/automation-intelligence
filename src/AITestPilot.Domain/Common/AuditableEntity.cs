namespace AITestPilot.Domain.Common;

/// <summary>
/// Base type for persisted domain entities that require UTC audit timestamps and actor attribution.
/// CreatedByUserId/UpdatedByUserId are stamped by the persistence boundary from the authenticated
/// current-user context so domain entities do not depend on HTTP or identity infrastructure.
/// </summary>
public abstract class AuditableEntity
{
    public Guid Id { get; protected set; }
    public DateTimeOffset CreatedAtUtc { get; protected set; }
    public Guid CreatedByUserId { get; protected set; }
    public DateTimeOffset UpdatedAtUtc { get; protected set; }
    public Guid UpdatedByUserId { get; protected set; }

    protected AuditableEntity()
    {
    }

    protected AuditableEntity(Guid? id = null)
    {
        Id = id is null || id == Guid.Empty ? Guid.NewGuid() : id.Value;
        CreatedAtUtc = DateTimeOffset.UtcNow;
        UpdatedAtUtc = CreatedAtUtc;
    }

    protected void Touch() => UpdatedAtUtc = DateTimeOffset.UtcNow;
}

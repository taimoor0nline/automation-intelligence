using AITestPilot.Domain.Common;

namespace AITestPilot.Domain.Auditing;

/// <summary>
/// Immutable business activity entry used for datewise/userwise history.
/// This complements CreatedAtUtc/UpdatedAtUtc on mutable business rows.
/// </summary>
public sealed class AuditEvent : WorkspaceScopedEntity
{
    public Guid UserId { get; private set; }
    public DateTimeOffset OccurredAtUtc { get; private set; }
    public string EntityType { get; private set; } = string.Empty;
    public Guid EntityId { get; private set; }
    public string Action { get; private set; } = string.Empty;
    public string Summary { get; private set; } = string.Empty;
    public string? MetadataJson { get; private set; }

    private AuditEvent()
    {
    }

    public AuditEvent(
        Guid workspaceId,
        Guid userId,
        DateTimeOffset occurredAtUtc,
        string entityType,
        Guid entityId,
        string action,
        string summary,
        string? metadataJson = null) : base(workspaceId)
    {
        if (userId == Guid.Empty) throw new ArgumentException("UserId is required.", nameof(userId));
        if (entityId == Guid.Empty) throw new ArgumentException("EntityId is required.", nameof(entityId));

        UserId = userId;
        OccurredAtUtc = occurredAtUtc.ToUniversalTime();
        EntityType = NormalizeRequired(entityType, nameof(entityType), 150);
        EntityId = entityId;
        Action = NormalizeRequired(action, nameof(action), 100);
        Summary = NormalizeRequired(summary, nameof(summary), 1000);
        MetadataJson = string.IsNullOrWhiteSpace(metadataJson) ? null : metadataJson.Trim();
    }

    private static string NormalizeRequired(string value, string parameterName, int maxLength)
    {
        var normalized = (value ?? string.Empty).Trim();
        if (normalized.Length == 0) throw new ArgumentException($"{parameterName} is required.", parameterName);
        if (normalized.Length > maxLength) throw new ArgumentOutOfRangeException(parameterName, $"{parameterName} cannot exceed {maxLength} characters.");
        return normalized;
    }
}

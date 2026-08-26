using AITestPilot.Domain.Common;

namespace AITestPilot.Domain.Testing;

public enum TestCaseStatus
{
    Draft,
    Generated,
    Approved,
    Rejected,
    Archived
}

public enum TestPriority
{
    Low,
    Medium,
    High,
    Critical
}

public sealed class TestCase : WorkspaceScopedEntity
{
    public Guid ProjectId { get; private set; }
    public Guid? RequirementId { get; private set; }
    public string TestCaseNumber { get; private set; } = string.Empty;
    public string Title { get; private set; } = string.Empty;
    public string? Description { get; private set; }
    public TestPriority Priority { get; private set; }
    public TestCaseStatus Status { get; private set; }
    public TestDefinition Definition { get; private set; } = new(1, [], []);
    public int DefinitionVersion { get; private set; }
    public bool AiGenerated { get; private set; }
    public DateTimeOffset? GeneratedAtUtc { get; private set; }
    public Guid? GeneratedByUserId { get; private set; }
    public DateTimeOffset? ApprovedAtUtc { get; private set; }
    public Guid? ApprovedByUserId { get; private set; }

    private TestCase()
    {
    }

    public TestCase(
        Guid workspaceId,
        Guid projectId,
        string testCaseNumber,
        string title,
        TestDefinition definition,
        TestPriority priority = TestPriority.Medium,
        Guid? requirementId = null,
        string? description = null,
        bool aiGenerated = false) : base(workspaceId)
    {
        if (projectId == Guid.Empty) throw new ArgumentException("ProjectId is required.", nameof(projectId));
        if (definition.Version <= 0) throw new ArgumentOutOfRangeException(nameof(definition));

        ProjectId = projectId;
        RequirementId = requirementId;
        TestCaseNumber = Required(testCaseNumber, 50).ToUpperInvariant();
        Title = Required(title, 300);
        Description = Optional(description, 4000);
        Priority = priority;
        Definition = definition;
        DefinitionVersion = definition.Version;
        AiGenerated = aiGenerated;
        Status = aiGenerated ? TestCaseStatus.Generated : TestCaseStatus.Draft;
        if (aiGenerated) GeneratedAtUtc = DateTimeOffset.UtcNow;
    }

    public void ReplaceDefinition(TestDefinition definition)
    {
        if (definition.Version <= DefinitionVersion)
            throw new InvalidOperationException("Definition version must increase.");
        Definition = definition;
        DefinitionVersion = definition.Version;
        Status = TestCaseStatus.Draft;
        ApprovedAtUtc = null;
        ApprovedByUserId = null;
        Touch();
    }

    public void MarkGenerated(Guid? userId)
    {
        AiGenerated = true;
        Status = TestCaseStatus.Generated;
        GeneratedAtUtc = DateTimeOffset.UtcNow;
        GeneratedByUserId = userId;
        Touch();
    }

    public void Approve(Guid userId)
    {
        if (userId == Guid.Empty) throw new ArgumentException("UserId is required.", nameof(userId));
        Status = TestCaseStatus.Approved;
        ApprovedAtUtc = DateTimeOffset.UtcNow;
        ApprovedByUserId = userId;
        Touch();
    }

    private static string Required(string value, int maxLength)
    {
        var normalized = (value ?? string.Empty).Trim();
        if (normalized.Length == 0) throw new ArgumentException("Value is required.");
        if (normalized.Length > maxLength) throw new ArgumentOutOfRangeException(nameof(value));
        return normalized;
    }

    private static string? Optional(string? value, int maxLength)
    {
        var normalized = value?.Trim();
        if (string.IsNullOrWhiteSpace(normalized)) return null;
        if (normalized.Length > maxLength) throw new ArgumentOutOfRangeException(nameof(value));
        return normalized;
    }
}

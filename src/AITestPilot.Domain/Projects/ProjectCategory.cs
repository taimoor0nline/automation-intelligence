using AITestPilot.Domain.Common;

namespace AITestPilot.Domain.Projects;

public sealed class ProjectCategory : WorkspaceScopedEntity
{
    public string Code { get; private set; } = string.Empty;
    public string Name { get; private set; } = string.Empty;
    public string? Description { get; private set; }
    public bool IsActive { get; private set; }
    public int SortOrder { get; private set; }

    private ProjectCategory()
    {
    }

    public ProjectCategory(
        Guid workspaceId,
        string code,
        string name,
        string? description = null,
        int sortOrder = 0) : base(workspaceId)
    {
        Code = NormalizeRequired(code, nameof(code), 50).ToUpperInvariant();
        Name = NormalizeRequired(name, nameof(name), 150);
        Description = NormalizeOptional(description, 500);
        SortOrder = sortOrder;
        IsActive = true;
    }

    public void Update(string name, string? description, int sortOrder)
    {
        Name = NormalizeRequired(name, nameof(name), 150);
        Description = NormalizeOptional(description, 500);
        SortOrder = sortOrder;
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

    private static string NormalizeRequired(string value, string parameterName, int maxLength)
    {
        var normalized = (value ?? string.Empty).Trim();
        if (normalized.Length == 0) throw new ArgumentException($"{parameterName} is required.", parameterName);
        if (normalized.Length > maxLength) throw new ArgumentOutOfRangeException(parameterName, $"{parameterName} cannot exceed {maxLength} characters.");
        return normalized;
    }

    private static string? NormalizeOptional(string? value, int maxLength)
    {
        var normalized = value?.Trim();
        if (string.IsNullOrWhiteSpace(normalized)) return null;
        if (normalized.Length > maxLength) throw new ArgumentOutOfRangeException(nameof(value), $"Value cannot exceed {maxLength} characters.");
        return normalized;
    }
}

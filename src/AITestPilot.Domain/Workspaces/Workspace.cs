using AITestPilot.Domain.Common;

namespace AITestPilot.Domain.Workspaces;

public sealed class Workspace : AuditableEntity
{
    public string Code { get; private set; } = string.Empty;
    public string Name { get; private set; } = string.Empty;
    public bool IsActive { get; private set; }

    private Workspace()
    {
    }

    public Workspace(Guid id, string code, string name) : base(id)
    {
        if (id == Guid.Empty) throw new ArgumentException("Workspace Id is required.", nameof(id));

        Code = NormalizeRequired(code, nameof(code), 50).ToUpperInvariant();
        Name = NormalizeRequired(name, nameof(name), 200);
        IsActive = true;
    }

    public void Rename(string name)
    {
        Name = NormalizeRequired(name, nameof(name), 200);
        Touch();
    }

    public void Deactivate()
    {
        IsActive = false;
        Touch();
    }

    public void Activate()
    {
        IsActive = true;
        Touch();
    }

    private static string NormalizeRequired(string value, string parameterName, int maxLength)
    {
        var normalized = (value ?? string.Empty).Trim();
        if (normalized.Length == 0) throw new ArgumentException($"{parameterName} is required.", parameterName);
        if (normalized.Length > maxLength) throw new ArgumentOutOfRangeException(parameterName, $"{parameterName} cannot exceed {maxLength} characters.");
        return normalized;
    }
}

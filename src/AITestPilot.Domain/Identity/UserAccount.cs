using AITestPilot.Domain.Common;

namespace AITestPilot.Domain.Identity;

public sealed class UserAccount : AuditableEntity
{
    public string Email { get; private set; } = string.Empty;
    public string DisplayName { get; private set; } = string.Empty;
    public string IdentityProvider { get; private set; } = "Local";
    public string? ExternalSubjectId { get; private set; }
    public bool IsActive { get; private set; }
    public DateTimeOffset? LastLoginAtUtc { get; private set; }

    private UserAccount()
    {
    }

    public UserAccount(
        string email,
        string displayName,
        string identityProvider = "Local",
        string? externalSubjectId = null) : base()
    {
        Email = NormalizeEmail(email);
        DisplayName = NormalizeRequired(displayName, nameof(displayName), 200);
        IdentityProvider = NormalizeRequired(identityProvider, nameof(identityProvider), 100);
        ExternalSubjectId = NormalizeOptional(externalSubjectId, 300);
        IsActive = true;
    }

    public void UpdateProfile(string displayName)
    {
        DisplayName = NormalizeRequired(displayName, nameof(displayName), 200);
        Touch();
    }

    public void RecordLogin(DateTimeOffset occurredAtUtc)
    {
        LastLoginAtUtc = occurredAtUtc.ToUniversalTime();
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

    private static string NormalizeEmail(string value)
    {
        var email = NormalizeRequired(value, nameof(value), 320).ToLowerInvariant();
        if (!email.Contains('@') || email.StartsWith('@') || email.EndsWith('@'))
            throw new ArgumentException("A valid email address is required.", nameof(value));
        return email;
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

using AITestPilot.Domain.Common;

namespace AITestPilot.Domain.Projects;

public sealed class ProjectEnvironment : WorkspaceScopedEntity
{
    public Guid ProjectId { get; private set; }
    public string Name { get; private set; } = string.Empty;
    public EnvironmentType EnvironmentType { get; private set; }
    public string StartingUrl { get; private set; } = string.Empty;
    public string? ApiBaseUrl { get; private set; }
    public string? HealthCheckUrl { get; private set; }
    public string? Description { get; private set; }
    public bool IsDefault { get; private set; }
    public bool IsActive { get; private set; }

    private ProjectEnvironment()
    {
    }

    public ProjectEnvironment(
        Guid workspaceId,
        Guid projectId,
        string name,
        EnvironmentType environmentType,
        string startingUrl,
        string? apiBaseUrl = null,
        string? healthCheckUrl = null,
        string? description = null,
        bool isDefault = false) : base(workspaceId)
    {
        if (projectId == Guid.Empty)
            throw new ArgumentException("ProjectId is required.", nameof(projectId));

        ProjectId = projectId;
        Name = NormalizeRequired(name, nameof(name), 100);
        EnvironmentType = environmentType;
        StartingUrl = NormalizeRequiredHttpUrl(startingUrl, nameof(startingUrl));
        ApiBaseUrl = NormalizeOptionalHttpUrl(apiBaseUrl, nameof(apiBaseUrl));
        HealthCheckUrl = NormalizeOptionalHttpUrl(healthCheckUrl, nameof(healthCheckUrl));
        Description = NormalizeOptional(description, 1000);
        IsDefault = isDefault;
        IsActive = true;
    }

    public void Update(
        string name,
        EnvironmentType environmentType,
        string startingUrl,
        string? apiBaseUrl,
        string? healthCheckUrl,
        string? description)
    {
        Name = NormalizeRequired(name, nameof(name), 100);
        EnvironmentType = environmentType;
        StartingUrl = NormalizeRequiredHttpUrl(startingUrl, nameof(startingUrl));
        ApiBaseUrl = NormalizeOptionalHttpUrl(apiBaseUrl, nameof(apiBaseUrl));
        HealthCheckUrl = NormalizeOptionalHttpUrl(healthCheckUrl, nameof(healthCheckUrl));
        Description = NormalizeOptional(description, 1000);
        Touch();
    }

    public void SetDefault(bool isDefault)
    {
        IsDefault = isDefault;
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
        if (IsDefault) IsDefault = false;
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

    private static string NormalizeRequiredHttpUrl(string value, string parameterName)
        => NormalizeHttpUrl(value, parameterName, required: true)!;

    private static string? NormalizeOptionalHttpUrl(string? value, string parameterName)
        => NormalizeHttpUrl(value, parameterName, required: false);

    private static string? NormalizeHttpUrl(string? value, string parameterName, bool required)
    {
        var normalized = value?.Trim();
        if (string.IsNullOrWhiteSpace(normalized))
        {
            if (required) throw new ArgumentException($"{parameterName} is required.", parameterName);
            return null;
        }

        if (!Uri.TryCreate(normalized, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
        {
            throw new ArgumentException("URL must be an absolute HTTP/HTTPS URL.", parameterName);
        }

        return uri.ToString();
    }
}

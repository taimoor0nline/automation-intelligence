using AITestPilot.Domain.Common;

namespace AITestPilot.Domain.Projects;

public sealed class Project : WorkspaceScopedEntity
{
    public Guid ProjectCategoryId { get; private set; }
    public string Code { get; private set; } = string.Empty;
    public string Name { get; private set; } = string.Empty;
    public string? ShortDescription { get; private set; }
    public string? DetailedDescription { get; private set; }
    public string? ApplicationType { get; private set; }
    public string? TechnologyStack { get; private set; }
    public string? RepositoryUrl { get; private set; }
    public string? DefaultBranch { get; private set; }
    public string? BusinessOwner { get; private set; }
    public string? TechnicalOwner { get; private set; }
    public ProjectStatus Status { get; private set; }

    private Project()
    {
    }

    public Project(
        Guid workspaceId,
        Guid projectCategoryId,
        string code,
        string name,
        string? shortDescription = null,
        string? detailedDescription = null,
        string? applicationType = null,
        string? technologyStack = null,
        string? repositoryUrl = null,
        string? defaultBranch = null,
        string? businessOwner = null,
        string? technicalOwner = null) : base(workspaceId)
    {
        if (projectCategoryId == Guid.Empty)
            throw new ArgumentException("ProjectCategoryId is required.", nameof(projectCategoryId));

        ProjectCategoryId = projectCategoryId;
        Code = NormalizeRequired(code, nameof(code), 50).ToUpperInvariant();
        Name = NormalizeRequired(name, nameof(name), 200);
        ShortDescription = NormalizeOptional(shortDescription, 500);
        DetailedDescription = NormalizeOptional(detailedDescription, 4000);
        ApplicationType = NormalizeOptional(applicationType, 100);
        TechnologyStack = NormalizeOptional(technologyStack, 1000);
        RepositoryUrl = NormalizeOptionalUrl(repositoryUrl, nameof(repositoryUrl));
        DefaultBranch = NormalizeOptional(defaultBranch, 100);
        BusinessOwner = NormalizeOptional(businessOwner, 200);
        TechnicalOwner = NormalizeOptional(technicalOwner, 200);
        Status = ProjectStatus.Draft;
    }

    public void UpdateDetails(
        Guid projectCategoryId,
        string name,
        string? shortDescription,
        string? detailedDescription,
        string? applicationType,
        string? technologyStack,
        string? repositoryUrl,
        string? defaultBranch,
        string? businessOwner,
        string? technicalOwner)
    {
        if (projectCategoryId == Guid.Empty)
            throw new ArgumentException("ProjectCategoryId is required.", nameof(projectCategoryId));

        ProjectCategoryId = projectCategoryId;
        Name = NormalizeRequired(name, nameof(name), 200);
        ShortDescription = NormalizeOptional(shortDescription, 500);
        DetailedDescription = NormalizeOptional(detailedDescription, 4000);
        ApplicationType = NormalizeOptional(applicationType, 100);
        TechnologyStack = NormalizeOptional(technologyStack, 1000);
        RepositoryUrl = NormalizeOptionalUrl(repositoryUrl, nameof(repositoryUrl));
        DefaultBranch = NormalizeOptional(defaultBranch, 100);
        BusinessOwner = NormalizeOptional(businessOwner, 200);
        TechnicalOwner = NormalizeOptional(technicalOwner, 200);
        Touch();
    }

    public void Activate()
    {
        Status = ProjectStatus.Active;
        Touch();
    }

    public void Archive()
    {
        Status = ProjectStatus.Archived;
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

    private static string? NormalizeOptionalUrl(string? value, string parameterName)
    {
        var normalized = value?.Trim();
        if (string.IsNullOrWhiteSpace(normalized)) return null;
        if (!Uri.TryCreate(normalized, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
        {
            throw new ArgumentException("URL must be an absolute HTTP/HTTPS URL.", parameterName);
        }

        return uri.ToString();
    }
}

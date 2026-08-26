namespace AITestPilot.Application.Projects.RegisterProject;

public sealed record RegisterProjectCommand(
    Guid ProjectCategoryId,
    string Code,
    string Name,
    string? ShortDescription,
    string? DetailedDescription,
    string? ApplicationType,
    string? TechnologyStack,
    string? RepositoryUrl,
    string? DefaultBranch,
    string? BusinessOwner,
    string? TechnicalOwner);

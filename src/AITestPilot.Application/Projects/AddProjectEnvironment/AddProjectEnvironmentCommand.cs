using AITestPilot.Domain.Projects;

namespace AITestPilot.Application.Projects.AddProjectEnvironment;

public sealed record AddProjectEnvironmentCommand(
    Guid ProjectId,
    string Name,
    EnvironmentType EnvironmentType,
    string StartingUrl,
    string? ApiBaseUrl,
    string? HealthCheckUrl,
    string? Description,
    bool IsDefault);

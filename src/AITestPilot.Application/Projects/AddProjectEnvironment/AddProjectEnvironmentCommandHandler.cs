using AITestPilot.Application.Abstractions;
using AITestPilot.Domain.Projects;

namespace AITestPilot.Application.Projects.AddProjectEnvironment;

public sealed class AddProjectEnvironmentCommandHandler(
    IWorkspaceContext workspaceContext,
    IProjectRepository projectRepository,
    IProjectEnvironmentRepository environmentRepository,
    IUnitOfWork unitOfWork)
    : ICommandHandler<AddProjectEnvironmentCommand, Guid>
{
    public async Task<Guid> HandleAsync(AddProjectEnvironmentCommand command, CancellationToken cancellationToken)
    {
        var workspaceId = workspaceContext.WorkspaceId;
        var project = await projectRepository.GetByIdAsync(workspaceId, command.ProjectId, cancellationToken)
            ?? throw new InvalidOperationException("Project was not found in the current workspace.");
        if (project.Status == ProjectStatus.Archived)
            throw new InvalidOperationException("Cannot add an environment to an archived project.");

        if (await environmentRepository.NameExistsAsync(workspaceId, command.ProjectId, command.Name, cancellationToken))
            throw new InvalidOperationException($"Environment '{command.Name}' already exists for this project.");

        if (command.IsDefault)
            await environmentRepository.ClearDefaultAsync(workspaceId, command.ProjectId, cancellationToken);

        var environment = new ProjectEnvironment(
            workspaceId,
            command.ProjectId,
            command.Name,
            command.EnvironmentType,
            command.StartingUrl,
            command.ApiBaseUrl,
            command.HealthCheckUrl,
            command.Description,
            command.IsDefault);

        await environmentRepository.AddAsync(environment, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return environment.Id;
    }
}
